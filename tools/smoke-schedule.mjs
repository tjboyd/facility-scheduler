/**
 * End-to-end check for assigned schedules, releasing and picking up.
 *
 *   npm run build
 *   PORT=3000 npm start > server.log 2>&1 &
 *   node tools/smoke-schedule.mjs
 *
 * Reads sign-in links out of the server log, the way a person reads them out of
 * an inbox. Cleans up everything it creates.
 */
import { readFileSync } from "node:fs";
import { chromium } from "playwright";

const BASE = (process.env.BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
const MAIL_LOG = process.env.MAIL_LOG || "server.log";
/** Where release notices go while the suite runs. */
const SCHEDULER = `sched.master.${Date.now()}@example.org`;
const EXECUTABLE = process.env.CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const ADMIN = process.env.SEED_SUPER_ADMIN_EMAIL || "you@jrchargersbaseball.com";
const TIMEOUT = 20_000;

const STAMP = Date.now();
const COACH_A = `sched.a.${STAMP}@example.org`; // holds the assigned time
const COACH_B = `sched.b.${STAMP}@example.org`; // picks it up
const TEAM_A = "U9 - White";
const TEAM_B = "U10 - Red";

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

function emailsTo(email) {
  return readFileSync(MAIL_LOG, "utf8")
    .split("── email ─")
    .slice(1)
    .filter((b) => b.includes(`to:   ${email}`));
}

function linkFor(email) {
  const log = readFileSync(MAIL_LOG, "utf8");
  for (const block of log.split("── email ─").slice(1).reverse()) {
    if (!block.includes(`to:   ${email}`)) continue;
    const match = block.match(/(http\S*\/auth\/verify\?token=\S+)/);
    if (match) return match[1];
  }
  return null;
}

/** Polls until fn returns something truthy, or the deadline passes. */
async function waitFor(fn, timeoutMs = 12_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = fn();
    if (value) return value;
    await new Promise((r) => setTimeout(r, 200));
  }
  return null;
}

async function waitForNewLink(email, previous = null, timeoutMs = 12_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const link = linkFor(email);
    if (link && link !== previous) return link;
    await new Promise((r) => setTimeout(r, 200));
  }
  return null;
}

const local = (link) => link.replace(/^https?:\/\/[^/]+/, BASE);

/** Clicks a server action and returns the message it comes back with. */
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
  await page.waitForTimeout(200);
  return (await page.locator('[role="status"]').first().innerText()).trim();
}

/** Signs a fresh browser context in, using the emailed link. */
async function signIn(browser, email) {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(TIMEOUT);
  const before = linkFor(email);
  await page.goto(`${BASE}/signin`, { waitUntil: "domcontentloaded" });
  await page.fill("#email", email);
  await page.click('button[type="submit"]');
  await page.waitForURL("**/check-email**");
  const link = await waitForNewLink(email, before);
  if (!link) throw new Error(`no sign-in link for ${email}`);
  await page.goto(local(link), { waitUntil: "domcontentloaded" });
  return { context, page };
}

// Calendar dates, worked out the same way the app does.
const addDays = (date, days) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const today = new Intl.DateTimeFormat("en-CA", {
  timeZone: process.env.FACILITY_TIMEZONE || "America/Chicago",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());
const firstSaturday = addDays(today, (6 - new Date(`${today}T00:00:00Z`).getUTCDay() + 7) % 7);
const through = addDays(today, 56);

const browser = await chromium.launch({ executablePath: EXECUTABLE, args: ["--no-sandbox"] });

try {
  const { page: admin } = await signIn(browser, ADMIN);

  // -- two coaches on two teams -------------------------------------------
  console.log("\nsetting up two coaches");
  await admin.goto(`${BASE}/admin/people`, { waitUntil: "domcontentloaded" });
  for (const [email, team] of [
    [COACH_A, TEAM_A],
    [COACH_B, TEAM_B],
  ]) {
    await admin.fill("#emails", email);
    await admin.selectOption("#role", "HEAD_COACH");
    await admin.selectOption("#teamId", { label: team });
    await admin.click('button:has-text("Send invitations")');
    await admin.waitForSelector(`[data-row="${email}"]`);
  }
  check("both coaches are on the list", true);

  // -- assign a repeating schedule ----------------------------------------
  console.log("\nassigning a repeating schedule");
  await admin.goto(`${BASE}/admin/schedule`, { waitUntil: "domcontentloaded" });
  await admin.selectOption("#teamId", { label: TEAM_A });
  await admin.selectOption("#weekday", "6");
  await admin.fill("#startTime", "8:00 AM");
  await admin.fill("#endTime", "9:30 AM");
  await admin.fill("#startsOn", today);
  await admin.fill("#endsOn", through);
  let flash = await act(admin, 'button:has-text("Assign the schedule")');
  check(`${TEAM_A} gets Saturdays 8:00–9:30`, flash.includes("Assigned"), flash);
  check("every Saturday in the range is written out", /Assigned (8|9) dates/.test(flash), flash);

  // -- the clash report ----------------------------------------------------
  console.log("\nclashing with time already taken");
  await admin.selectOption("#teamId", { label: "U10 - White" });
  await admin.selectOption("#weekday", "6");
  await admin.fill("#startTime", "9:00 AM");
  await admin.fill("#endTime", "10:00 AM");
  await admin.fill("#startsOn", today);
  await admin.fill("#endsOn", through);
  flash = await act(admin, 'button:has-text("Assign the schedule")');
  check("an overlapping series is refused outright", flash.includes("already booked"), flash);

  console.log("\nback-to-back is not a clash");
  await admin.selectOption("#teamId", { label: "U10 - White" });
  await admin.fill("#startTime", "9:30 AM");
  await admin.fill("#endTime", "10:30 AM");
  await admin.fill("#startsOn", today);
  await admin.fill("#endsOn", through);
  flash = await act(admin, 'button:has-text("Assign the schedule")');
  check("a block starting when another ends is fine", flash.includes("Assigned"), flash);

  // -- the calendar shows it ----------------------------------------------
  console.log("\nthe calendar");
  await admin.goto(`${BASE}/calendar?week=${firstSaturday}`, { waitUntil: "domcontentloaded" });
  const blocks = await admin.locator("[data-block]").count();
  check("assigned blocks appear on the calendar", blocks >= 2, `${blocks} block(s)`);

  // -- a release can tell the club's scheduler ---------------------------
  // The field is type="email", so a browser blocks a typo before it is ever
  // posted — parseOptionalEmail covers the server side in the unit tests.
  console.log("\nthe release notice");
  await admin.goto(`${BASE}/admin/rules`, { waitUntil: "domcontentloaded" });
  await admin.fill("#releaseNotifyEmail", SCHEDULER);
  let rulesFlash = await act(admin, 'button:has-text("Save booking rules")');
  check("a scheduler address can be set", rulesFlash.includes("saved"), rulesFlash);

  // -- the holding team releases one --------------------------------------
  console.log("\nreleasing");
  const { page: coachA } = await signIn(browser, COACH_A);
  await coachA.goto(`${BASE}/calendar?week=${firstSaturday}`, { waitUntil: "domcontentloaded" });
  const blockId = await coachA.locator('[data-block][data-status="HELD"]').first().getAttribute("data-block");
  await coachA.goto(`${BASE}/booking/${blockId}`, { waitUntil: "domcontentloaded" });
  check("the holding team is offered a release", (await coachA.locator(`[data-release="${blockId}"]`).count()) === 1);
  flash = await act(coachA, `[data-release="${blockId}"]`);
  check("releasing says so", flash.includes("Released"), flash);
  check("and it cannot be released twice", (await coachA.locator(`[data-release="${blockId}"]`).count()) === 0);
  check(
    "the scheduler was told",
    Boolean(await waitFor(() => emailsTo(SCHEDULER).length > 0)),
    `${emailsTo(SCHEDULER).length} email(s)`,
  );

  await coachA.goto(`${BASE}/calendar?week=${firstSaturday}`, { waitUntil: "domcontentloaded" });
  check(
    "it shows as available on the calendar",
    (await coachA.locator(`[data-block="${blockId}"][data-status="RELEASED"]`).count()) === 1,
  );
  check(
    "and is listed under 'up for grabs'",
    (await coachA.locator("text=Up for grabs").count()) === 1,
  );

  // -- another team picks it up -------------------------------------------
  console.log("\npicking it up");
  const { page: coachB } = await signIn(browser, COACH_B);
  await coachB.goto(`${BASE}/booking/${blockId}`, { waitUntil: "domcontentloaded" });
  check("another team is offered the pickup", (await coachB.locator(`[data-claim="${blockId}"]`).count()) === 1);
  flash = await act(coachB, `[data-claim="${blockId}"]`);
  check("picking it up names the new team", flash.includes(TEAM_B), flash);

  await coachB.goto(`${BASE}/calendar?week=${firstSaturday}`, { waitUntil: "domcontentloaded" });
  check(
    "it is held again on the calendar",
    (await coachB.locator(`[data-block="${blockId}"][data-status="HELD"]`).count()) === 1,
  );

  // Clearing the address is how you turn these off — the point of the feature
  // is that empty means send nothing.
  console.log("\nturning the release notice off");
  await admin.goto(`${BASE}/admin/rules`, { waitUntil: "domcontentloaded" });
  await admin.fill("#releaseNotifyEmail", "");
  rulesFlash = await act(admin, 'button:has-text("Save booking rules")');
  check("the scheduler address can be cleared", rulesFlash.includes("saved"), rulesFlash);

  const quietBefore = emailsTo(SCHEDULER).length;
  // Next week, because this coach's block in the first one has already been
  // released and picked up. The series repeats weekly for eight weeks.
  const nextSaturday = addDays(firstSaturday, 7);
  await coachA.goto(`${BASE}/calendar?week=${nextSaturday}`, { waitUntil: "domcontentloaded" });
  // The calendar shows every team's blocks, so pick one this coach can actually
  // give back rather than assuming the first held block is theirs.
  const heldIds = await coachA
    .locator('[data-block][data-status="HELD"]')
    .evaluateAll((nodes) => nodes.map((n) => n.getAttribute("data-block")));
  let secondBlock = null;
  for (const id of heldIds) {
    await coachA.goto(`${BASE}/booking/${id}`, { waitUntil: "domcontentloaded" });
    if ((await coachA.locator(`[data-release="${id}"]`).count()) === 1) {
      secondBlock = id;
      break;
    }
  }
  if (secondBlock) {
    const quietFlash = await act(coachA, `[data-release="${secondBlock}"]`);
    // Give a send the same chance to appear as the one we asserted above.
    await coachA.waitForTimeout(1200);
    check(
      "no email goes out once it is empty",
      quietFlash.includes("Released") && emailsTo(SCHEDULER).length === quietBefore,
      `${emailsTo(SCHEDULER).length - quietBefore} new email(s)`,
    );
  } else {
    check("no email goes out once it is empty", false, "no second block left to release");
  }

  // -- first come, first served -------------------------------------------
  console.log("\nfirst come, first served");
  await coachA.goto(`${BASE}/booking/${blockId}`, { waitUntil: "domcontentloaded" });
  check(
    "a second team cannot pick up what is already taken",
    (await coachA.locator(`[data-claim="${blockId}"]`).count()) === 0,
  );
  check(
    "and the original team can no longer release it",
    (await coachA.locator(`[data-release="${blockId}"]`).count()) === 0,
  );

  // -- ending a schedule ---------------------------------------------------
  console.log("\nending a schedule");
  await admin.goto(`${BASE}/admin/schedule`, { waitUntil: "domcontentloaded" });
  const seriesId = await admin.locator("[data-series]").first().getAttribute("data-series");
  flash = await act(admin, `[data-end="${seriesId}"]`);
  check("ending removes the upcoming dates", /Ended .*removed \d+ upcoming/.test(flash), flash);

  await admin.goto(`${BASE}/booking/${blockId}`, { waitUntil: "domcontentloaded" });
  check(
    "but a block another team picked up survives it",
    (await admin.locator(`text=${TEAM_B}`).count()) > 0,
  );
} finally {
  await browser.close();
  await tidyUp();
}

/** Leave the database as we found it. */
async function tidyUp() {
  try {
    const { PrismaClient } = await import("@prisma/client");
    const db = new PrismaClient();
    const series = await db.assignedSeries.findMany({
      where: { team: { name: { in: [TEAM_A, TEAM_B, "U10 - White"] } } },
      select: { id: true },
    });
    const ids = series.map((s) => s.id);
    await db.booking.deleteMany({ where: { OR: [{ seriesId: { in: ids } }, { seriesId: null, origin: "PICKUP" }] } });
    await db.assignedSeries.deleteMany({ where: { id: { in: ids } } });
    await db.booking.deleteMany({ where: { seriesId: { in: ids } } });
    const users = await db.user.deleteMany({ where: { email: { startsWith: "sched." } } });
    await db.$disconnect();
    await db.settings.updateMany({ data: { releaseNotifyEmail: null } });
    console.log(`\ncleaned up ${ids.length} series and ${users.count} test user(s)`);
  } catch (error) {
    console.log(`\ncould not clean up test data: ${error.message}`);
  }
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(`  · ${f}`);
  process.exit(1);
}
