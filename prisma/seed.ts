/**
 * Development seed: one super admin (so there is somebody who can sign in and
 * add everyone else) and the club's teams.
 *
 * The team list mirrors SportsEngine, including its naming ("U12 - Red") so the
 * two systems line up. Teams SportsEngine has as Inactive are seeded archived:
 * they keep their history but cannot be assigned or booked against. Un-archive
 * one on Admin → People & access if a season brings it back.
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

type SeedTeam = { name: string; archived?: boolean };

const TEAMS: SeedTeam[] = [
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

/**
 * The age-group placeholders used before the real roster arrived. Removed only
 * when empty, so nobody's team assignment disappears underneath them.
 */
const PLACEHOLDERS = ["8U", "10U", "12U Red", "12U Black", "13U", "14U"];

async function main() {
  const email = process.env.SEED_SUPER_ADMIN_EMAIL?.trim().toLowerCase();
  if (!email) {
    throw new Error(
      "SEED_SUPER_ADMIN_EMAIL is not set. Put your address in .env — it becomes the\n" +
        "first account that can sign in and add everyone else.",
    );
  }
  const name = process.env.SEED_SUPER_ADMIN_NAME?.trim() || null;

  for (const team of TEAMS) {
    await db.team.upsert({
      where: { name: team.name },
      // Leave an existing team alone: an admin may have archived or restored it
      // deliberately, and a re-run of the seed should not undo that.
      update: {},
      create: { name: team.name, archivedAt: team.archived ? new Date() : null },
    });
  }

  let removed = 0;
  for (const placeholder of PLACEHOLDERS) {
    const team = await db.team.findUnique({
      where: { name: placeholder },
      include: { _count: { select: { members: true } } },
    });
    if (!team) continue;
    if (team._count.members > 0) {
      console.warn(
        `kept placeholder team "${placeholder}" — ${team._count.members} person(s) still assigned`,
      );
      continue;
    }
    await db.team.delete({ where: { id: team.id } });
    removed += 1;
  }

  const admin = await db.user.upsert({
    where: { email },
    update: { role: "SUPER_ADMIN", status: "ACTIVE" },
    create: { email, name, role: "SUPER_ADMIN", status: "ACTIVE" },
  });

  const active = TEAMS.filter((t) => !t.archived).length;
  console.info(`teams: ${active} active, ${TEAMS.length - active} archived`);
  if (removed) console.info(`removed ${removed} placeholder team(s)`);
  console.info(`super admin: ${admin.email}`);
  console.info("sign in at /signin — the link is printed to this server log.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
