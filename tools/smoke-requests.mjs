/**
 * End-to-end check for requesting time and deciding it.
 *
 *   npm run build
 *   PORT=3000 npm start > server.log 2>&1 &
 *   node tools/smoke-requests.mjs
 *
 * Reads sign-in links and approver emails out of the server log, the way a
 * person reads them out of an inbox. Cleans up everything it creates.
 */
import { readFileSync } from "node:fs";
import { chromium } from "playwright";

const BASE = (process.env.BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
const MAIL_LOG = process.env.MAIL_LOG || "server.log";
const EXECUTABLE = process.env.CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const ADMIN = process.env.SEED_SUPER_ADMIN_EMAIL || "you@jrchargersbaseball.com";
const TIMEOUT = 20_000;

const STAMP = Date.now();
const COACH = `req.coach.${STAMP}@example.org`;
const COACH2 = `req.coach2.${STAMP}@example.org`;
const APPROVER = `req.approver.${STAMP}@example.org`;
/** A second head coach on the *same* team as COACH — a supported setup. */
const COCOACH = `req.coach3.${STAMP}@example.org`;
const TEAM = "U11 - Black";
const TEAM2 = "U13 - Red";

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

const log = () => readFileSync(MAIL_LOG, "utf8");

function linkFor(email) {
  for (const block of log().split("── email ─").slice(1).reverse()) {
    if (!block.includes(`to:   ${email}`)) continue;
    const match = block.match(/(http\S*\/auth\/verify\?token=\S+)/);
    if (match) return match[1];
  }
  return null;
}

/** The newest one-click approval link sent to an address. */
function approveLinkFor(email) {
  for (const block of log().split("── email ─").slice(1).reverse()) {
    if (!block.includes(`to:   ${email}`)) continue;
    const match = block.match(/(http\S*\/decide\?token=\S+)/);
    if (match) return match[1];
  }
  return null;
}

function emailsTo(email) {
  return log().split("── email ─").slice(1).filter((b) => b.includes(`to:   ${email}`));
}

async function waitFor(fn, timeoutMs = 12_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = fn();
    if (value) return value;
    await new Promise((r) => setTimeout(r, 200));
  }
  return null;
}

const local = (link) => link.replace(/^https?:\/\/[^/]+/, BASE);

/** "3:00 PM" — the same shape formatTimeOfDay renders. */
function label(minutes) {
  const hour = Math.floor(minutes / 60);
  const suffix = hour < 12 ? "AM" : "PM";
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return `${twelve}:${String(minutes % 60).padStart(2, "0")} ${suffix}`;
}

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

async function signIn(browser, email) {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(TIMEOUT);
  const before = linkFor(email);
  await page.goto(`${BASE}/signin`, { waitUntil: "domcontentloaded" });
  await page.fill("#email", email);
  await page.click('button[type="submit"]');
  await page.waitForURL("**/check-email**");
  const link = await waitFor(() => {
    const l = linkFor(email);
    return l && l !== before ? l : null;
  });
  if (!link) throw new Error(`no sign-in link for ${email}`);
  await page.goto(local(link), { waitUntil: "domcontentloaded" });
  return page;
}

const addDays = (date, n) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const today = new Intl.DateTimeFormat("en-CA", {
  timeZone: process.env.FACILITY_TIMEZONE || "America/Chicago",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());
/** Comfortably past the 24-hour notice rule. */
const target = addDays(today, 6);

const browser = await chromium.launch({ executablePath: EXECUTABLE, args: ["--no-sandbox"] });

try {
  const admin = await signIn(browser, ADMIN);

  console.log("\nsetting up two coaches");
  await admin.goto(`${BASE}/admin/people`, { waitUntil: "domcontentloaded" });
  for (const [email, team] of [
    [COACH, TEAM],
    [COACH2, TEAM2],
  ]) {
    await admin.fill("#emails", email);
    await admin.selectOption("#role", "HEAD_COACH");
    await admin.selectOption("#teamId", { label: team });
    await admin.click('button:has-text("Send invitations")');
    await admin.waitForSelector(`[data-row="${email}"]`);
  }
  check("two coaches on two teams", true);

  // A second approver, so the "somebody has to stay listening" rule has room
  // to let the first one opt out.
  await admin.fill("#emails", APPROVER);
  await admin.selectOption("#role", "APPROVER");
  await admin.click('button:has-text("Send invitations")');
  await admin.waitForSelector(`[data-row="${APPROVER}"]`);
  check("a second approver exists", true);

  // A second head coach on the same team as COACH. The club has teams run by
  // two coaches, and the app is built for it: every check is on the team.
  await admin.fill("#emails", COCOACH);
  await admin.selectOption("#role", "HEAD_COACH");
  await admin.selectOption("#teamId", { label: TEAM });
  await admin.click('button:has-text("Send invitations")');
  await admin.waitForSelector(`[data-row="${COCOACH}"]`);
  check("two head coaches share one team", true);

  // -- hours ---------------------------------------------------------------
  console.log("\nfacility hours");
  await admin.goto(`${BASE}/admin/hours`, { waitUntil: "domcontentloaded" });
  check("all seven days are listed", (await admin.locator("[data-day]").count()) === 7);
  let flash = await act(admin, 'button:has-text("Save hours")');
  check("hours save", flash.includes("takes requests on"), flash);

  await admin.fill("#startDate", addDays(today, 3));
  await admin.fill("#reason", "Smoke closure");
  flash = await act(admin, 'button:has-text("Add closure")');
  check("a closure can be added", flash.includes("Closed"), flash);

  // -- booking rules -------------------------------------------------------
  console.log("\nbooking rules");
  await admin.goto(`${BASE}/admin/rules`, { waitUntil: "domcontentloaded" });
  flash = await act(admin, 'button:has-text("Save booking rules")');
  check("rules save", flash.includes("saved"), flash);

  // -- a coach requests time ----------------------------------------------
  console.log("\nrequesting");
  const coach = await signIn(browser, COACH);
  await coach.goto(`${BASE}/request?date=${target}`, { waitUntil: "domcontentloaded" });
  const starts = await coach.locator("[data-start]").count();
  check("open start times are offered", starts > 0, `${starts} offered`);

  const firstStart = await coach.locator("[data-start]").first().getAttribute("data-start");
  await coach.goto(`${BASE}/request?date=${target}&start=${firstStart}`, {
    waitUntil: "domcontentloaded",
  });
  // Length is a link, not a radio, so the server knows what is selected and the
  // summary can state a real end time. The longest that fits is the default.
  check(
    "the longest length that fits is picked by default",
    (await coach.locator('[data-length="90"][aria-current="true"]').count()) === 1,
  );
  let summary = await coach.locator("[data-summary]").innerText();
  check(
    "and the summary states the block it would book",
    summary.includes(label(Number(firstStart) + 90)),
    summary.replace(/\n/g, " · "),
  );

  await coach.click('[data-length="30"]');
  await coach.waitForURL("**len=30**", { timeout: TIMEOUT });
  summary = await coach.locator("[data-summary]").innerText();
  check(
    "picking a shorter length re-states the block",
    summary.includes(label(Number(firstStart) + 30)) &&
      !summary.includes(label(Number(firstStart) + 90)),
    summary.replace(/\n/g, " · "),
  );

  await coach.goto(`${BASE}/request?date=${target}&start=${firstStart}`, {
    waitUntil: "domcontentloaded",
  });
  await coach.fill("#note", "Smoke test — makeup practice");
  const approverMailsBefore = emailsTo(ADMIN).length;
  await Promise.all([
    coach.waitForURL("**/requests**", { timeout: TIMEOUT }),
    coach.click('button:has-text("Send request")'),
  ]);
  check("the request lands in My requests", coach.url().includes("/requests"));
  check("and shows as pending", (await coach.locator("text=Pending").count()) > 0);

  const approveLink = await waitFor(() =>
    emailsTo(ADMIN).length > approverMailsBefore ? approveLinkFor(ADMIN) : null,
  );
  check("the approvers were emailed a one-click link", Boolean(approveLink), approveLink ?? "none");

  // -- the closure and the notice rule are enforced ------------------------
  console.log("\nrules the screen enforces");
  await coach.goto(`${BASE}/request?date=${addDays(today, 3)}`, { waitUntil: "domcontentloaded" });
  check(
    "a closure day offers nothing",
    (await coach.locator("[data-start]").count()) === 0 &&
      (await coach.locator("text=Closed").count()) > 0,
  );
  await coach.goto(`${BASE}/request?date=${today}`, { waitUntil: "domcontentloaded" });
  const todayStarts = await coach.locator("[data-start]").count();
  if (todayStarts > 0) {
    const s = await coach.locator("[data-start]").first().getAttribute("data-start");
    await coach.goto(`${BASE}/request?date=${today}&start=${s}`, { waitUntil: "domcontentloaded" });
    await Promise.all([
      coach.waitForURL("**/request**", { timeout: TIMEOUT }),
      coach.click('button:has-text("Send request")'),
    ]);
    check(
      "same-day requests are refused for want of notice",
      (await coach.locator("text=/notice/").count()) > 0,
    );
  } else {
    check("same-day requests are refused for want of notice", true, "no slots left today");
  }

  // -- the approvals screen ------------------------------------------------
  console.log("\nthe approvals screen");
  await admin.goto(`${BASE}/approvals`, { waitUntil: "domcontentloaded" });
  check("the request is queued", (await admin.locator("[data-pending]").count()) >= 1);
  check("a clash check is shown", (await admin.locator("text=No clashes").count()) >= 1);

  // -- one-click approve from the email ------------------------------------
  console.log("\none-click approve from the email");
  const anon = await browser.newContext();
  const anonPage = await anon.newPage();
  await anonPage.goto(local(approveLink), { waitUntil: "domcontentloaded" });
  check(
    "the emailed link approves without signing in",
    (await anonPage.locator("text=Approved").count()) > 0,
    await anonPage.locator("h1").innerText().catch(() => ""),
  );

  await anonPage.goto(local(approveLink), { waitUntil: "domcontentloaded" });
  check(
    "and cannot be used twice",
    (await anonPage.locator("text=already been used").count()) > 0,
    await anonPage.locator("h1").innerText().catch(() => ""),
  );
  await anon.close();

  check("the coach was emailed the decision", Boolean(await waitFor(() => emailsTo(COACH).length > 1)));

  await coach.goto(`${BASE}/requests`, { waitUntil: "domcontentloaded" });
  check("the coach sees it reserved", (await coach.locator("text=Reserved").count()) > 0);

  await admin.goto(`${BASE}/approvals`, { waitUntil: "domcontentloaded" });
  check("the queue is empty again", (await admin.locator("[data-pending]").count()) === 0);

  // -- declining -----------------------------------------------------------
  console.log("\ndeclining");
  const coach2 = await signIn(browser, COACH2);
  await coach2.goto(`${BASE}/request?date=${addDays(today, 7)}`, { waitUntil: "domcontentloaded" });
  const s2 = await coach2.locator("[data-start]").first().getAttribute("data-start");
  await coach2.goto(`${BASE}/request?date=${addDays(today, 7)}&start=${s2}`, {
    waitUntil: "domcontentloaded",
  });
  await Promise.all([
    coach2.waitForURL("**/requests**", { timeout: TIMEOUT }),
    coach2.click('button:has-text("Send request")'),
  ]);

  await admin.goto(`${BASE}/approvals`, { waitUntil: "domcontentloaded" });
  const pendingId = await admin.locator("[data-pending]").first().getAttribute("data-pending");
  flash = await act(admin, `[data-decline="${pendingId}"]`);
  check("declining needs a reason", flash.includes("short reason"), flash);

  await admin.fill(`#reason-${pendingId}`, "Cage nets being replaced");
  flash = await act(admin, `[data-decline="${pendingId}"]`);
  check("declining with a reason works", flash.includes("Declined"), flash);

  await coach2.goto(`${BASE}/requests`, { waitUntil: "domcontentloaded" });
  check(
    "the coach sees the reason",
    (await coach2.locator("text=Cage nets being replaced").count()) > 0,
  );

  // -- withdrawing ---------------------------------------------------------
  console.log("\nwithdrawing");
  await coach2.goto(`${BASE}/request?date=${addDays(today, 8)}`, { waitUntil: "domcontentloaded" });
  const s3 = await coach2.locator("[data-start]").first().getAttribute("data-start");
  await coach2.goto(`${BASE}/request?date=${addDays(today, 8)}&start=${s3}`, {
    waitUntil: "domcontentloaded",
  });
  await Promise.all([
    coach2.waitForURL("**/requests**", { timeout: TIMEOUT }),
    coach2.click('button:has-text("Send request")'),
  ]);
  const withdrawId = await coach2.locator("[data-withdraw]").first().getAttribute("data-withdraw");
  flash = await act(coach2, `[data-withdraw="${withdrawId}"]`);
  check("a coach can withdraw their own request", flash.includes("withdrawn"), flash);

  // -- who gets emailed about new requests ---------------------------------
  console.log("\nemail preferences");
  const approver = await signIn(browser, APPROVER);
  await approver.goto(`${BASE}/approvals`, { waitUntil: "domcontentloaded" });
  check(
    "an approver is emailed by default",
    (await approver.locator("text=Email me when a request comes in").count()) > 0 &&
      (await approver.locator("[data-notify-toggle]").textContent())?.includes("Turn off"),
  );

  const muteFlash = await act(approver, "[data-notify-toggle]");
  check(
    "and can mute themselves",
    muteFlash.includes("won't be emailed") &&
      Boolean((await approver.locator("[data-notify-toggle]").textContent())?.includes("Turn on")),
    muteFlash,
  );

  // A fresh request should now reach the admin but not the muted approver.
  const mutedBefore = emailsTo(APPROVER).length;
  const adminBefore = emailsTo(ADMIN).length;
  const quiet = addDays(today, 9);
  await coach.goto(`${BASE}/request?date=${quiet}`, { waitUntil: "domcontentloaded" });
  const quietStart = await coach.locator("[data-start]").first().getAttribute("data-start");
  await coach.goto(`${BASE}/request?date=${quiet}&start=${quietStart}`, {
    waitUntil: "domcontentloaded",
  });
  await Promise.all([
    coach.waitForURL("**/requests**", { timeout: TIMEOUT }),
    coach.click('button:has-text("Send request")'),
  ]);
  check(
    "a muted approver is not emailed",
    Boolean(await waitFor(() => emailsTo(ADMIN).length > adminBefore)) &&
      emailsTo(APPROVER).length === mutedBefore,
    `admin +${emailsTo(ADMIN).length - adminBefore}, approver +${emailsTo(APPROVER).length - mutedBefore}`,
  );

  // Muting is about email, not access — it is still in their queue.
  await approver.goto(`${BASE}/approvals`, { waitUntil: "domcontentloaded" });
  check("but still sees it in the queue", (await approver.locator("[data-pending]").count()) >= 1);

  // -- two head coaches on one team ---------------------------------------
  // The team holds the time, not the person, so the co-coach can see and act on
  // a request their teammate made.
  console.log("\ntwo coaches on one team");
  const shared = addDays(today, 11);
  await coach.goto(`${BASE}/request?date=${shared}`, { waitUntil: "domcontentloaded" });
  const sharedStart = await coach.locator("[data-start]").first().getAttribute("data-start");
  await coach.goto(`${BASE}/request?date=${shared}&start=${sharedStart}`, {
    waitUntil: "domcontentloaded",
  });
  await Promise.all([
    coach.waitForURL("**/requests**", { timeout: TIMEOUT }),
    coach.click('button:has-text("Send request")'),
  ]);

  const cocoach = await signIn(browser, COCOACH);
  await cocoach.goto(`${BASE}/requests`, { waitUntil: "domcontentloaded" });
  check(
    "a co-coach sees their teammate's request",
    (await cocoach.locator("[data-withdraw]").count()) >= 1,
  );

  const sharedId = await cocoach.locator("[data-withdraw]").first().getAttribute("data-withdraw");
  const sharedFlash = await act(cocoach, `[data-withdraw="${sharedId}"]`);
  check("and can withdraw it", sharedFlash.includes("withdrawn"), sharedFlash);

  // -- a coach is not an approver -----------------------------------------
  console.log("\nthe approver gate");
  await coach.goto(`${BASE}/approvals`, { waitUntil: "domcontentloaded" });
  check(
    "a head coach cannot open approvals",
    new URL(coach.url()).pathname === "/calendar",
    coach.url(),
  );
} finally {
  await browser.close();
  await tidyUp();
}

async function tidyUp() {
  try {
    const { PrismaClient } = await import("@prisma/client");
    const db = new PrismaClient();
    const users = await db.user.findMany({
      where: { email: { startsWith: "req." } },
      select: { id: true, teamId: true },
    });
    const teamIds = users.map((u) => u.teamId).filter(Boolean);
    await db.booking.deleteMany({ where: { teamId: { in: teamIds } } });
    await db.closure.deleteMany({ where: { reason: "Smoke closure" } });
    const removed = await db.user.deleteMany({ where: { email: { startsWith: "req." } } });
    await db.$disconnect();
    console.log(`\ncleaned up ${removed.count} test user(s) and their bookings`);
  } catch (error) {
    console.log(`\ncould not clean up test data: ${error.message}`);
  }
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(`  · ${f}`);
  process.exit(1);
}
