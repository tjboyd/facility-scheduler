/**
 * Development seed: one super admin (so there is somebody who can sign in and
 * add everyone else) and a starter set of teams.
 *
 * The teams are the sample age groups from the mockups — rename, add to or
 * archive them on Admin → People & access once the real roster is known.
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const SAMPLE_TEAMS = ["8U", "10U", "12U Red", "12U Black", "13U", "14U"];

async function main() {
  const email = (process.env.SEED_SUPER_ADMIN_EMAIL || "you@jrchargersbaseball.com")
    .trim()
    .toLowerCase();
  const name = process.env.SEED_SUPER_ADMIN_NAME?.trim() || null;

  for (const teamName of SAMPLE_TEAMS) {
    await db.team.upsert({
      where: { name: teamName },
      update: {},
      create: { name: teamName },
    });
  }

  const admin = await db.user.upsert({
    where: { email },
    update: { role: "SUPER_ADMIN", status: "ACTIVE" },
    create: { email, name, role: "SUPER_ADMIN", status: "ACTIVE" },
  });

  console.info(`seeded ${SAMPLE_TEAMS.length} teams`);
  console.info(`super admin: ${admin.email}`);
  console.info("sign in at /signin — the link is printed to this server log.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
