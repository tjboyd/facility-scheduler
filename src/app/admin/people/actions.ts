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
import { sendInviteEmail } from "@/lib/mail";
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
    await emailInvite(email, actor);
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

  return {
    status: "ok",
    message:
      fresh.length === 1
        ? `Invited ${fresh[0]}.`
        : `Invited ${fresh.length} people.`,
    invited: fresh,
    alreadyThere: [...existingSet],
    invalid,
  };
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
  await emailInvite(target.email, actor);

  revalidatePath(PEOPLE_PATH);
  backWith(`Restored ${target.email} and sent a fresh sign-in link.`);
}

export async function resendInvite(formData: FormData): Promise<void> {
  const actor = await assertSuperAdmin();
  const userId = String(formData.get("userId") ?? "");

  const target = await db.user.findUnique({ where: { id: userId } });
  if (!target) backWith("That person is no longer on the list.", "error");
  if (target.status === "DISABLED") backWith(`${target.email} doesn't have access.`, "error");

  await emailInvite(target.email, actor);

  revalidatePath(PEOPLE_PATH);
  backWith(`Sent a new sign-in link to ${target.email}.`);
}

// ---------------------------------------------------------------------------
// Teams
// ---------------------------------------------------------------------------

const teamNameSchema = z
  .string()
  .trim()
  .min(1, "Give the team a name.")
  .max(40, "Team names are capped at 40 characters.");

export async function createTeam(formData: FormData): Promise<void> {
  await assertSuperAdmin();

  const parsed = teamNameSchema.safeParse(String(formData.get("name") ?? ""));
  if (!parsed.success) backWith(parsed.error.issues[0]?.message ?? "Check the name.", "error");

  const name = parsed.data;
  const clash = await db.team.findFirst({
    where: { name: { equals: name } },
  });
  if (clash) backWith(`There's already a team called ${clash.name}.`, "error");

  await db.team.create({ data: { name } });
  revalidatePath(PEOPLE_PATH);
  backWith(`Added ${name}.`);
}

export async function archiveTeam(formData: FormData): Promise<void> {
  await assertSuperAdmin();
  const teamId = String(formData.get("teamId") ?? "");

  const team = await db.team.findUnique({
    where: { id: teamId },
    include: { members: { where: { status: { in: ["ACTIVE", "INVITED"] } }, select: { id: true } } },
  });
  if (!team) backWith("That team no longer exists.", "error");
  if (team.members.length > 0) {
    backWith(
      `${team.name} still has ${team.members.length} ${team.members.length === 1 ? "person" : "people"} on it — move them first.`,
      "error",
    );
  }

  await db.team.update({ where: { id: teamId }, data: { archivedAt: new Date() } });
  revalidatePath(PEOPLE_PATH);
  backWith(`Archived ${team.name}.`);
}

export async function restoreTeam(formData: FormData): Promise<void> {
  await assertSuperAdmin();
  const teamId = String(formData.get("teamId") ?? "");

  const team = await db.team.findUnique({ where: { id: teamId } });
  if (!team) backWith("That team no longer exists.", "error");

  await db.team.update({ where: { id: teamId }, data: { archivedAt: null } });
  revalidatePath(PEOPLE_PATH);
  backWith(`Restored ${team.name}.`);
}
