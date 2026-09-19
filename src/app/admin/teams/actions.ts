"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { assertSuperAdmin } from "@/lib/guards";

const TEAMS_PATH = "/admin/teams";
/** The invite form there offers the live teams, so it goes stale too. */
const PEOPLE_PATH = "/admin/people";

function backWith(message: string, kind: "ok" | "error" = "ok"): never {
  redirect(`${TEAMS_PATH}?msg=${encodeURIComponent(message)}&kind=${kind}`);
}

function refresh(): void {
  revalidatePath(TEAMS_PATH);
  revalidatePath(PEOPLE_PATH);
}

const teamNameSchema = z
  .string()
  .trim()
  .min(1, "Give the team a name.")
  .max(40, "Team names are capped at 40 characters.");

/** A team already called this, ignoring case and ignoring the team being renamed.
 *  Case-insensitive because "U12 Red" and "u12 red" would both be accepted by the
 *  unique index and then be impossible to tell apart on the calendar. */
async function nameClash(name: string, exceptId?: string) {
  return db.team.findFirst({
    where: {
      name: { equals: name, mode: "insensitive" },
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
  });
}

export async function createTeam(formData: FormData): Promise<void> {
  await assertSuperAdmin();

  const parsed = teamNameSchema.safeParse(String(formData.get("name") ?? ""));
  if (!parsed.success) backWith(parsed.error.issues[0]?.message ?? "Check the name.", "error");

  const name = parsed.data;
  const clash = await nameClash(name);
  if (clash) {
    backWith(
      clash.archivedAt
        ? `${clash.name} already exists — it's archived, so restore it instead.`
        : `There's already a team called ${clash.name}.`,
      "error",
    );
  }

  await db.team.create({ data: { name } });
  refresh();
  backWith(`Added ${name}.`);
}

/** Renaming is by id, so every booking, schedule and coach follows the new name. */
export async function renameTeam(formData: FormData): Promise<void> {
  await assertSuperAdmin();
  const teamId = String(formData.get("teamId") ?? "");

  const parsed = teamNameSchema.safeParse(String(formData.get("name") ?? ""));
  if (!parsed.success) backWith(parsed.error.issues[0]?.message ?? "Check the name.", "error");

  const team = await db.team.findUnique({ where: { id: teamId } });
  if (!team) backWith("That team no longer exists.", "error");

  const name = parsed.data;
  if (name === team.name) backWith(`${team.name} is already called that.`);

  const clash = await nameClash(name, teamId);
  if (clash) backWith(`There's already a team called ${clash.name}.`, "error");

  await db.team.update({ where: { id: teamId }, data: { name } });
  refresh();
  backWith(`${team.name} is now ${name}.`);
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
  refresh();
  backWith(`Archived ${team.name}.`);
}

export async function restoreTeam(formData: FormData): Promise<void> {
  await assertSuperAdmin();
  const teamId = String(formData.get("teamId") ?? "");

  const team = await db.team.findUnique({ where: { id: teamId } });
  if (!team) backWith("That team no longer exists.", "error");

  await db.team.update({ where: { id: teamId }, data: { archivedAt: null } });
  refresh();
  backWith(`Restored ${team.name}.`);
}
