/**
 * End-to-end smoke check for the sign-in and people-management flows.
 *
 * Drives a real browser against a running server, so it exercises what unit
 * tests can't: the magic-link round trip, the session cookie, the super-admin
 * gate, and the server action behind each button.
 *
 *   npm run build
 *   PORT=3000 npm start > server.log 2>&1 &
 *   node tools/smoke.mjs
 *
 * The server must run with MAIL_TRANSPORT=console and its output captured to
 * MAIL_LOG (default server.log) — that log is where this script reads sign-in
 * links from, exactly as a person would read them out of an inbox.
 */
import { readFileSync } from "node:fs";
import { chromium } from "playwright";

const BASE = (process.env.BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
const MAIL_LOG = process.env.MAIL_LOG || "server.log";
const EXECUTABLE = process.env.CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const ADMIN = process.env.SEED_SUPER_ADMIN_EMAIL || "you@jrchargersbaseball.com";
const TIMEOUT = 20_000;

let passed = 0;
const failures = [];

function check(name, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${name}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

/** The most recent sign-in link printed for an address. */
function linkFor(email) {
  const log = readFileSync(MAIL_LOG, "utf8");
  for (const block of log.split("── email ─").slice(1).reverse()) {
    if (!block.includes(`to:   ${email}`)) continue;
    const match = block.match(/(http\S*\/auth\/verify\?token=\S+)/);
    if (match) return match[1];
  }
  return null;
}

async function waitForNewLink(email, previous = null, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const link = linkFor(email);
    if (link && link !== previous) return link;
    await new Promise((r) => setTimeout(r, 200));
  }
  return null;
}

const local = (link) => link.replace(/^https?:\/\/[^/]+/, BASE);

/**
 * Clicks something that runs a server action and returns the message it comes
 * back with.
 *
 * Waiting on the URL is no good here: two saves in a row redirect to
 * byte-identical URLs, and the App Router navigates on the client so the
 * document is never replaced. Removing the banner and waiting for it to return
 * is worse — React owns those nodes, and tearing one out leaves the reconciler
 * updating a detached node that never reappears. So: wait for the action's own
 * POST to come back, then for the re-rendered banner.
 */
async function act(page, selector) {
  await Promise.all([
    page.waitForResponse((r) => r.request().method() === "POST", { timeout: TIMEOUT }),
    page.click(selector),
  ]);
  await page.waitForFunction(
    () => Boolean(document.querySelector('[role="status"]')?.textContent?.trim()),
    null,
    { timeout: TIMEOUT },
  );
  await page.waitForTimeout(200); // let the router swap in the new tree
  return (await page.locator('[role="status"]').first().innerText()).trim();
}

const browser = await chromium.launch({ executablePath: EXECUTABLE, args: ["--no-sandbox"] });
const page = await browser.newPage();
page.setDefaultTimeout(TIMEOUT);

try {
  // -- sign in -------------------------------------------------------------
  console.log("\nsign-in");
  await page.goto(`${BASE}/admin/people`, { waitUntil: "domcontentloaded" });
  check("signed-out visitor is bounced to /signin", new URL(page.url()).pathname === "/signin", page.url());

  const previousAdminLink = linkFor(ADMIN);
  await page.fill("#email", ADMIN);
  await page.click('button[type="submit"]');
  await page.waitForURL("**/signin/check-email**");
  check("asking for a link lands on 'check your inbox'", page.url().includes("/signin/check-email"));

  const link = await waitForNewLink(ADMIN, previousAdminLink);
  check("a sign-in link was emailed", Boolean(link));
  if (!link) throw new Error(`no sign-in link found in ${MAIL_LOG}`);

  await page.goto(local(link), { waitUntil: "domcontentloaded" });
  check("following the link signs you in", new URL(page.url()).pathname === "/calendar", page.url());

  // Replay must be checked without the session cookie, or /signin's
  // already-signed-in redirect masks the result.
  const replay = await browser.newContext();
  const replayPage = await replay.newPage();
  await replayPage.goto(local(link), { waitUntil: "domcontentloaded" });
  check("the same link cannot be used twice", replayPage.url().includes("error=used"), replayPage.url());
  await replay.close();

  // -- an address nobody added --------------------------------------------
  console.log("\nunknown address");
  const ghost = await browser.newPage();
  await ghost.goto(`${BASE}/signin`, { waitUntil: "domcontentloaded" });
  await ghost.fill("#email", "stranger@example.com");
  await ghost.click('button[type="submit"]');
  await ghost.waitForURL("**/signin/check-email**");
  check("an unknown address gets the same answer", ghost.url().includes("/signin/check-email"));
  check("…but no link is issued for it", (await waitForNewLink("stranger@example.com", null, 1500)) === null);
  await ghost.close();

  // -- adding people -------------------------------------------------------
  console.log("\npeople and access");
  await page.goto(`${BASE}/admin/people`, { waitUntil: "domcontentloaded" });
  check("a super admin reaches the admin area", new URL(page.url()).pathname === "/admin/people");
  check("the allowlist is on screen", (await page.locator("text=Approved people").count()) > 0);

  const coach = `smoke.coach.${Date.now()}@jrchargersbaseball.com`;
  const teamValue = await page.locator("#teamId option").nth(1).getAttribute("value");
  await page.fill("#emails", coach);
  await page.selectOption("#role", "HEAD_COACH");
  await page.selectOption("#teamId", teamValue);
  await page.click('button:has-text("Send invitations")');
  await page.waitForSelector(`[data-row="${coach}"]`);
  check("a new coach appears on the list", await page.locator(`[data-row="${coach}"]`).isVisible());
  check("the coach was emailed a link", Boolean(await waitForNewLink(coach)));

  const row = `[data-row="${coach}"]`;
  check("the new coach shows as invited", (await page.locator(`${row} >> text=/Invited/`).count()) > 0);

  // -- the rules the screen enforces --------------------------------------
  console.log("\nrules the screen enforces");
  await page.selectOption(`${row} select[name="teamId"]`, "");
  let flash = await act(page, `[data-save="${coach}"]`);
  check("a head coach cannot be left without a team", flash.includes("they need a team"), flash);
  check(
    "…and the team is left as it was",
    (await page.locator(`${row} select[name="teamId"]`).inputValue()) === teamValue,
  );

  await page.selectOption(`${row} select[name="role"]`, "APPROVER");
  await page.selectOption(`${row} select[name="teamId"]`, "");
  flash = await act(page, `[data-save="${coach}"]`);
  check("an approver may have no team", flash.includes("Updated"), flash);

  await page.selectOption(`${row} select[name="role"]`, "HEAD_COACH");
  await page.selectOption(`${row} select[name="teamId"]`, teamValue);
  flash = await act(page, `[data-save="${coach}"]`);
  check("a head coach with a team saves cleanly", flash.includes("Updated"), flash);

  console.log("\nself-protection");
  check("you cannot remove your own access", await page.locator(`[data-remove="${ADMIN}"]`).isDisabled());
  const adminRole = page.locator(`[data-row="${ADMIN}"] select[name="role"]`);
  await adminRole.selectOption("APPROVER");
  flash = await act(page, `[data-save="${ADMIN}"]`);
  check("the last super admin cannot demote themselves", flash.includes("nobody with super admin"), flash);
  check(
    "…and the role is left as it was",
    (await page.locator(`[data-row="${ADMIN}"] select[name="role"]`).inputValue()) === "SUPER_ADMIN",
  );

  // -- removing and restoring ---------------------------------------------
  console.log("\nremoving access");
  const linkBeforeRemoval = linkFor(coach);
  flash = await act(page, `[data-remove="${coach}"]`);
  check("removing access says so", flash.includes("Removed access"), flash);

  const locked = await browser.newContext();
  const lockedPage = await locked.newPage();
  await lockedPage.goto(local(linkBeforeRemoval), { waitUntil: "domcontentloaded" });
  check(
    "a removed person's outstanding link stops working",
    new URL(lockedPage.url()).pathname === "/signin",
    lockedPage.url(),
  );
  await locked.close();

  flash = await act(page, `${row} button:has-text("Restore")`);
  check("restoring says so", flash.includes("Restored"), flash);
  const restoredLink = await waitForNewLink(coach, linkBeforeRemoval);
  check("restoring sends a fresh link", Boolean(restoredLink));

  // -- a coach is not an admin --------------------------------------------
  console.log("\nnon-admin gate");
  const coachContext = await browser.newContext();
  const coachPage = await coachContext.newPage();
  await coachPage.goto(local(restoredLink), { waitUntil: "domcontentloaded" });
  check("the coach can sign in", new URL(coachPage.url()).pathname === "/calendar", coachPage.url());
  await coachPage.goto(`${BASE}/admin/people`, { waitUntil: "domcontentloaded" });
  check("a head coach is kept out of admin", new URL(coachPage.url()).pathname === "/calendar", coachPage.url());
  check("…and sees no Admin link", (await coachPage.locator('nav a:has-text("Admin")').count()) === 0);
  await coachContext.close();

  // -- teams ---------------------------------------------------------------
  console.log("\nteams");
  const teamName = `Smoke ${Date.now() % 100000}`;
  await page.goto(`${BASE}/admin/people`, { waitUntil: "domcontentloaded" });
  await page.fill('input[name="name"]', teamName);
  flash = await act(page, 'form:has(input[name="name"]) button:has-text("Add")');
  check("a new team can be added", flash.includes(teamName), flash);
  flash = await act(page, `button[aria-label="Archive ${teamName}"]`);
  check("an empty team can be archived", flash.includes("Archived"), flash);

  const occupied = await page.locator("#teamId option").nth(1).textContent();
  flash = await act(page, `button[aria-label="Archive ${occupied.trim()}"]`);
  check("a team with people on it cannot be archived", flash.includes("move them first"), flash);
} finally {
  await browser.close();
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(`  · ${f}`);
  process.exit(1);
}
