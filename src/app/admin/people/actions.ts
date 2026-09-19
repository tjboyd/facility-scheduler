"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { issueSignInToken, type SessionUser } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  displayName,
  isRole,
  parseEmailList,
  requiresTeam,
  ROLES,
  wouldRemoveLastSuperAdmin,
  type Role,
} from "@/lib/domain";
import { MailError, sendInviteEmail } from "@/lib/mail";
import { assertSuperAdmin, NotAuthorized } from "@/lib/guards";

const PEOPLE_PATH = "/admin/people";

/** Ids of everyone who can still sign in as a super admin. */
async function activeSuperAdminIds(): Promise<string[]> {
  const rows = await db.user.findMany({
    where: { role: "SUPER_ADMIN", status: { in: ["ACTIVE", "INVITED"] } },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

function backWith(message: string, kind: "ok" | "error" = "ok"): never {
  redirect(`${PEOPLE_PATH}?msg=${encodeURIComponent(message)}&kind=${kind}`);
}

/** Sends an invite, returning a readable problem instead of throwing, so the
 *  caller can redirect (which throws by design) outside of a try block. */
async function tryEmailInvite(email: string, actor: SessionUser): Promise<string | null> {
  try {
    await emailInvite(email, actor);
    return null;
  } catch (error) {
    console.error(`[people] invite email failed for ${email}:`, error);
    return describeMailError(error);
  }
}

/** Issues a fresh single-use link and mails it. No-op for a disabled account. */
async function emailInvite(email: string, invitedBy: SessionUser): Promise<void> {
  const issued = await issueSignInToken(email);
  if (!issued) return;
  await sendInviteEmail(email, issued.token, displayName(invitedBy));
}

// ---------------------------------------------------------------------------
// Invite people
// ---------------------------------------------------------------------------

export type InviteState = {
  status: "idle" | "ok" | "error";
  message?: string;
  invited?: string[];
  alreadyThere?: string[];
  invalid?: string[];
  /** Added to the list, but the invite email did not go out. */
  notEmailed?: string[];
  /** Why it did not go out, in words a club admin can act on. */
  mailProblem?: string;
};

const inviteSchema = z.object({
  emails: z.string().min(1, "Enter at least one email address."),
  role: z.enum(ROLES),
  teamId: z.string().optional(),
});

export async function invitePeople(
  _prev: InviteState,
  formData: FormData,
): Promise<InviteState> {
  let actor: SessionUser;
  try {
    actor = await assertSuperAdmin();
  } catch (error) {
    if (error instanceof NotAuthorized) return { status: "error", message: error.message };
    throw error;
  }

  const parsed = inviteSchema.safeParse({
    emails: String(formData.get("emails") ?? ""),
    role: String(formData.get("role") ?? ""),
    teamId: String(formData.get("teamId") ?? ""),
  });
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the form." };
  }

  const role: Role = parsed.data.role;
  const teamId = parsed.data.teamId?.trim() || null;

  if (requiresTeam(role) && !teamId) {
    return { status: "error", message: "Head coaches need a team — pick one, or add the team first." };
  }

  if (teamId) {
    const team = await db.team.findUnique({ where: { id: teamId } });
    if (!team) return { status: "error", message: "That team no longer exists." };
    if (team.archivedAt) return { status: "error", message: `${team.name} is archived.` };
  }

  const { valid, invalid } = parseEmailList(parsed.data.emails);
  if (valid.length === 0) {
    return {
      status: "error",
      message: "None of those looked like email addresses.",
      invalid,
    };
  }

  const existing = await db.user.findMany({
    where: { email: { in: valid } },
    select: { email: true },
  });
  const existingSet = new Set(existing.map((u) => u.email));
  const fresh = valid.filter((email) => !existingSet.has(email));

  for (const email of fresh) {
    await db.user.create({
      data: { email, role, status: "INVITED", teamId: teamId ?? undefined },
    });
  }

  const notEmailed: string[] = [];
  let mailProblem: string | undefined;
  for (const email of fresh) {
    try {
      await emailInvite(email, actor);
    } catch (error) {
      notEmailed.push(email);
      if (!mailProblem) mailProblem = describeMailError(error);
      console.error(`[people] invite email failed for ${email}:`, error);
    }
  }

  revalidatePath(PEOPLE_PATH);

  if (fresh.length === 0) {
    return {
      status: "error",
      message: "Everyone on that list is already here.",
      alreadyThere: [...existingSet],
      invalid,
    };
  }

  const added = fresh.length === 1 ? `Added ${fresh[0]}` : `Added ${fresh.length} people`;

  return {
    status: notEmailed.length > 0 ? "error" : "ok",
    message:
      notEmailed.length === 0
        ? `${added} and sent ${fresh.length === 1 ? "an invite" : "invites"}.`
        : `${added}, but ${notEmailed.length === fresh.length ? "the invite email could not be sent" : `${notEmailed.length} invite emails could not be sent`}. They're on the list — use Resend once it's fixed.`,
    invited: fresh,
    alreadyThere: [...existingSet],
    invalid,
    notEmailed,
    mailProblem,
  };
}

/** A sentence a club admin can act on, without leaking a stack trace. */
function describeMailError(error: unknown): string {
  if (error instanceof MailError) return error.message;
  return "The email service could not be reached.";
}

// ---------------------------------------------------------------------------
// Edit one person
// ---------------------------------------------------------------------------

export async function updatePerson(formData: FormData): Promise<void> {
  await assertSuperAdmin();

  const userId = String(formData.get("userId") ?? "");
  const roleRaw = String(formData.get("role") ?? "");
  const teamId = String(formData.get("teamId") ?? "").trim() || null;

  if (!isRole(roleRaw)) backWith("That isn't a role we recognise.", "error");
  const role: Role = roleRaw;

  const target = await db.user.findUnique({ where: { id: userId } });
  if (!target) backWith("That person is no longer on the list.", "error");

  if (requiresTeam(role) && !teamId) {
    backWith(`${target.email} is a head coach, so they need a team.`, "error");
  }

  if (
    wouldRemoveLastSuperAdmin({
      currentSuperAdminIds: await activeSuperAdminIds(),
      targetId: userId,
      nextRole: role,
    })
  ) {
    backWith("That would leave nobody with super admin access.", "error");
  }

  await db.user.update({
    where: { id: userId },
    data: { role, teamId },
  });

  revalidatePath(PEOPLE_PATH);
  backWith(`Updated ${target.email}.`);
}

// ---------------------------------------------------------------------------
// Access on and off
// ---------------------------------------------------------------------------

export async function removeAccess(formData: FormData): Promise<void> {
  const actor = await assertSuperAdmin();
  const userId = String(formData.get("userId") ?? "");

  if (userId === actor.id) {
    backWith("You can't remove your own access — ask another super admin.", "error");
  }

  const target = await db.user.findUnique({ where: { id: userId } });
  if (!target) backWith("That person is no longer on the list.", "error");

  if (
    wouldRemoveLastSuperAdmin({
      currentSuperAdminIds: await activeSuperAdminIds(),
      targetId: userId,
      nextRole: null,
    })
  ) {
    backWith("That would leave nobody with super admin access.", "error");
  }

  await db.$transaction([
    db.user.update({ where: { id: userId }, data: { status: "DISABLED" } }),
    // Lock them out now rather than whenever their cookie happens to expire.
    db.session.deleteMany({ where: { userId } }),
    db.signInToken.deleteMany({ where: { userId } }),
  ]);

  revalidatePath(PEOPLE_PATH);
  backWith(`Removed access for ${target.email}.`);
}

export async function restoreAccess(formData: FormData): Promise<void> {
  const actor = await assertSuperAdmin();
  const userId = String(formData.get("userId") ?? "");

  const target = await db.user.findUnique({ where: { id: userId } });
  if (!target) backWith("That person is no longer on the list.", "error");

  await db.user.update({
    where: { id: userId },
    data: { status: "INVITED", invitedAt: new Date() },
  });

  const problem = await tryEmailInvite(target.email, actor);
  revalidatePath(PEOPLE_PATH);
  if (problem) backWith(`Restored ${target.email}, but the email didn't send. ${problem}`, "error");
  backWith(`Restored ${target.email} and sent a fresh sign-in link.`);
}

export async function resendInvite(formData: FormData): Promise<void> {
  const actor = await assertSuperAdmin();
  const userId = String(formData.get("userId") ?? "");

  const target = await db.user.findUnique({ where: { id: userId } });
  if (!target) backWith("That person is no longer on the list.", "error");
  if (target.status === "DISABLED") backWith(`${target.email} doesn't have access.`, "error");

  const problem = await tryEmailInvite(target.email, actor);
  revalidatePath(PEOPLE_PATH);
  if (problem) backWith(`Couldn't email ${target.email}. ${problem}`, "error");
  backWith(`Sent a new sign-in link to ${target.email}.`);
}
