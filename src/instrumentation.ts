/**
 * Runs once when the server boots, before it serves anything.
 *
 * All it does is set up a brand-new install: an empty database gets the club's
 * teams, the facility defaults and the first super admin, from
 * SEED_SUPER_ADMIN_EMAIL. On every boot after that it finds people and does
 * nothing.
 *
 * This exists because creating that first account is the one thing that cannot
 * be done from inside the app — you need an account to sign in, and you need to
 * sign in to make accounts. Leaving it as a command to run by hand means a
 * deployment that looks healthy but that nobody can enter.
 */
export async function register() {
  // Only the Node server runs this; the edge runtime has no database.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  try {
    const { bootstrapIfEmpty, describeBootstrap } = await import("@/lib/bootstrap");
    const result = await bootstrapIfEmpty(
      process.env.SEED_SUPER_ADMIN_EMAIL,
      process.env.SEED_SUPER_ADMIN_NAME,
    );
    // Quiet on the ordinary path; every other outcome is worth saying out loud.
    if (!(result.ran === false && result.reason === "already-set-up")) {
      console.info(describeBootstrap(result));
    }
  } catch (error) {
    // Never take the server down over this. A failure here leaves the app
    // running and says so; the seed script is still there to fall back on.
    console.error("[bootstrap] could not set up the first run:", error);
  }
}
