/**
 * First-boot setup: the club's teams, the facility defaults, and the one super
 * admin who can then invite everybody else.
 *
 * Shared by `npm run db:seed` and by the server's startup hook, so there is one
 * implementation rather than two that drift.
 *
 * **It only ever runs against an empty database.** A deployment restarts for
 * all sorts of reasons, and re-running this on a live one would undo real
 * decisions — re-promoting somebody who had been demoted, or resurrecting teams
 * an admin archived on purpose. "No users at all" is the only safe signal that
 * this is a fresh install rather than a running one.
 */
import { db } from "@/lib/db";
import { DEFAULT_HOURS } from "@/lib/facility";
import { isValidEmail, normalizeEmail } from "@/lib/domain";

type SeedTeam = { name: string; archived?: boolean };

/**
 * The club's teams, mirroring SportsEngine including its naming ("U12 - Red")
 * so the two systems line up. Teams SportsEngine has as Inactive start
 * archived: they keep their history but cannot be assigned or booked against.
 */
export const TEAMS: SeedTeam[] = [
  { name: "U7 - Combined" },
  { name: "U7 - Red", archived: true },
  { name: "U7 - White", archived: true },
  { name: "U8 - Combined" },
  { name: "U8 - Red", archived: true },
  { name: "U8 - White", archived: true },
  { name: "U9 - Combined", archived: true },
  { name: "U9 - Red" },
  { name: "U9 - White" },
  { name: "U10 - Red" },
  { name: "U10 - White" },
  { name: "U11 - Black" },
  { name: "U11 - Red" },
  { name: "U11 - White" },
  { name: "U12 - Red" },
  { name: "U12 - White" },
  { name: "U13 - Red" },
  { name: "U13 - White" },
  { name: "U14 - Red" },
  { name: "U14 - White" },
];

export type BootstrapResult =
  | { ran: true; email: string; teams: number }
  | { ran: false; reason: "already-set-up" | "no-admin-address" | "bad-admin-address" };

/**
 * Creates the teams, hours, rules and first super admin — but only if nobody
 * exists yet. Safe to call on every boot.
 */
export async function bootstrapIfEmpty(
  adminEmail: string | undefined,
  adminName: string | undefined,
): Promise<BootstrapResult> {
  // The guard. Anything already here means this is a running install.
  if ((await db.user.count()) > 0) return { ran: false, reason: "already-set-up" };

  const raw = adminEmail?.trim();
  if (!raw) return { ran: false, reason: "no-admin-address" };
  const email = normalizeEmail(raw);
  if (!isValidEmail(email)) return { ran: false, reason: "bad-admin-address" };

  for (const team of TEAMS) {
    await db.team.upsert({
      where: { name: team.name },
      // Leave an existing team alone: an admin may have archived or restored it
      // deliberately, and this should never undo that.
      update: {},
      create: { name: team.name, archivedAt: team.archived ? new Date() : null },
    });
  }

  for (const day of DEFAULT_HOURS) {
    await db.facilityHours.upsert({ where: { weekday: day.weekday }, update: {}, create: day });
  }
  await db.settings.upsert({ where: { id: "singleton" }, update: {}, create: { id: "singleton" } });

  await db.user.create({
    data: {
      email,
      name: adminName?.trim() || null,
      role: "SUPER_ADMIN",
      status: "ACTIVE",
    },
  });

  return { ran: true, email, teams: TEAMS.length };
}

/** What to print about a bootstrap, wherever it was run from. */
export function describeBootstrap(result: BootstrapResult): string {
  if (result.ran) {
    return (
      `[bootstrap] first run: created ${result.teams} teams, the facility defaults, ` +
      `and the super admin ${result.email}. Sign in with that address to invite everyone else.`
    );
  }
  switch (result.reason) {
    case "already-set-up":
      return "[bootstrap] people already exist, so nothing to do.";
    case "no-admin-address":
      return (
        "[bootstrap] the database is empty and SEED_SUPER_ADMIN_EMAIL is not set, so there is " +
        "nobody who can sign in. Set it and restart, or nobody can get in."
      );
    case "bad-admin-address":
      return (
        "[bootstrap] SEED_SUPER_ADMIN_EMAIL is not a valid email address, so no super admin " +
        "was created. Fix it and restart."
      );
  }
}
