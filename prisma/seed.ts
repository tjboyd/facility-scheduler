/**
 * Sets up a fresh database: the club's teams, the facility defaults, and the
 * one super admin who can invite everybody else.
 *
 *   SEED_SUPER_ADMIN_EMAIL="you@example.org" npm run db:seed
 *
 * The server does this by itself on first boot — see src/instrumentation.ts —
 * so this is for local development, or for setting up against a database the
 * app is not running against yet. Both call the same code, and both only ever
 * touch a database with no people in it.
 */
import { bootstrapIfEmpty, describeBootstrap } from "../src/lib/bootstrap";
import { db } from "../src/lib/db";

async function main() {
  const result = await bootstrapIfEmpty(
    process.env.SEED_SUPER_ADMIN_EMAIL,
    process.env.SEED_SUPER_ADMIN_NAME,
  );
  console.info(describeBootstrap(result));
  if (!result.ran && result.reason !== "already-set-up") process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
