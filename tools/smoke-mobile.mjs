/**
 * End-to-end check that the app works at phone width.
 *
 *   npm run build
 *   PORT=3000 npm start > server.log 2>&1 &
 *   node tools/smoke-mobile.mjs
 *
 * Two things matter here and neither shows up in a desktop run: nothing may
 * overflow horizontally (a page you can swipe sideways feels broken), and
 * nothing may hide behind the fixed bottom bar. Both are measured rather than
 * eyeballed. Cleans up everything it creates.
 */
import { readFileSync } from "node:fs";
import { chromium } from "playwright";

const BASE = (process.env.BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
const MAIL_LOG = process.env.MAIL_LOG || "server.log";
const EXECUTABLE = process.env.CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const ADMIN = process.env.SEED_SUPER_ADMIN_EMAIL || "you@jrchargersbaseball.com";
const TIMEOUT = 20_000;

const STAMP = Date.now();
const COACH = `mob.coach.${STAMP}@example.org`;
const TEAM = "U11 - Black";
const OTHER_TEAM = "U12 - Red";
/** iPhone 13 / a common Android, in CSS pixels. */
const PHONE = { width: 390, height: 844 };

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
    if (match) return match[1].replace(/^https?:\/\/[^/]+/, BASE);
  }
  return null;
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

async function signIn(browser, email) {
  const context = await browser.newContext({
    viewport: PHONE,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
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
  await page.goto(link, { waitUntil: "domcontentloaded" });
  return page;
}

/** Horizontal overflow in CSS pixels. Anything above zero can be swiped sideways. */
const overflowOf = (page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/**
 * Whether any *visible* content ends up underneath the fixed bottom bar once
 * the page is scrolled to the end. checkVisibility is what makes this reliable:
 * a collapsed <details> still reports a box in Chrome, and counting that would
 * cry wolf on the people screen.
 */
async function hiddenBehindNav(page) {
  for (let i = 0; i < 4; i += 1) {
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(150);
  }
  return page.evaluate(() => {
    const nav = document.querySelector("nav.fixed");
    if (!nav) return "no bottom bar";
    const navTop = nav.getBoundingClientRect().top;
    for (const el of document.querySelectorAll("main *")) {
      if (
        !el.checkVisibility({
          checkOpacity: true,
          checkVisibilityCSS: true,
          contentVisibilityAuto: true,
        })
      ) {
        continue;
      }
      const box = el.getBoundingClientRect();
      if (box.height === 0 || box.width === 0 || !el.textContent?.trim()) continue;
      if (box.bottom > navTop) return `<${el.tagName}> "${el.textContent.trim().slice(0, 30)}"`;
    }
    return null;
  });
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
const day = addDays(today, 4);

const { PrismaClient } = await import("@prisma/client");
const db = new PrismaClient();
const browser = await chromium.launch({ executablePath: EXECUTABLE, args: ["--no-sandbox"] });

try {
  const team = await db.team.findFirstOrThrow({ where: { name: TEAM } });
  const other = await db.team.findFirstOrThrow({ where: { name: OTHER_TEAM } });
  const coachUser = await db.user.create({
    data: { email: COACH, name: "Mobile Coach", role: "HEAD_COACH", status: "ACTIVE", teamId: team.id },
  });
  // Something to look at: one block held by another team, one of our own pending.
  await db.booking.create({
    data: { date: day, startMinutes: 1080, endMinutes: 1170, teamId: other.id, status: "HELD", origin: "ASSIGNED" },
  });
  await db.booking.create({
    data: {
      date: day,
      startMinutes: 1230,
      endMinutes: 1290,
      teamId: team.id,
      status: "PENDING",
      origin: "REQUEST",
      requestedById: coachUser.id,
    },
  });

  const coach = await signIn(browser, COACH);

  console.log("\nthe coach's screens at 390px");
  for (const [name, path] of [
    ["calendar", `/calendar?week=${day}&day=${day}`],
    ["request", `/request?date=${day}`],
    ["my requests", "/requests"],
  ]) {
    await coach.goto(BASE + path, { waitUntil: "networkidle" });
    const overflow = await overflowOf(coach);
    const hidden = await hiddenBehindNav(coach);
    check(`${name} fits the screen`, overflow === 0, `${overflow}px of sideways scroll`);
    check(`${name} clears the bottom bar`, hidden === null, hidden ?? "");
  }

  console.log("\nthe day view");
  await coach.goto(`${BASE}/calendar?week=${day}&day=${day}`, { waitUntil: "networkidle" });
  // The grid is hidden with CSS, so it stays in the DOM — visibility is the
  // thing to assert, not the element count.
  check(
    "the week grid is hidden on a phone",
    !(await coach.locator("[data-block]").first().isVisible().catch(() => false)),
  );
  check("seven days are tappable", (await coach.locator("[data-day]").count()) === 7);
  check(
    "the chosen day's bookings are listed",
    (await coach.locator("[data-slot]").count()) === 2,
    `${await coach.locator("[data-slot]").count()} slots`,
  );
  check(
    "free time is merged into runs rather than half-hours",
    (await coach.locator("[data-free]").count()) === 2,
    `${await coach.locator("[data-free]").count()} free runs`,
  );
  check(
    "and says how long each run is",
    (await coach.locator("text=/Open · /").count()) > 0,
  );

  // Tapping free time carries the day and the start into the request screen.
  const freeStart = await coach.locator("[data-free]").first().getAttribute("data-free");
  await coach.locator("[data-free]").first().click();
  await coach.waitForURL("**/request**");
  check(
    "tapping free time opens the request screen on that slot",
    new URL(coach.url()).searchParams.get("date") === day &&
      new URL(coach.url()).searchParams.get("start") === freeStart,
    coach.url(),
  );

  // Another day, to prove the strip actually switches days.
  await coach.goto(`${BASE}/calendar?week=${day}&day=${addDays(day, 1)}`, {
    waitUntil: "networkidle",
  });
  check(
    "a different day shows its own slots",
    (await coach.locator("[data-slot]").count()) === 0,
  );

  console.log("\nthe bottom bar");
  await coach.goto(`${BASE}/calendar`, { waitUntil: "networkidle" });
  check("a coach gets two tabs", (await coach.locator("nav.fixed a").count()) === 2);
  await coach.locator('nav.fixed a:has-text("Requests")').click();
  await coach.waitForURL("**/requests**");
  check("and they navigate", new URL(coach.url()).pathname === "/requests");

  console.log("\nthe admin's screens at 390px");
  const admin = await signIn(browser, ADMIN);
  check("an admin gets four tabs", (await admin.locator("nav.fixed a").count()) === 4);
  for (const [name, path] of [
    ["approvals", "/approvals"],
    ["people", "/admin/people"],
    ["hours", "/admin/hours"],
    ["booking rules", "/admin/rules"],
    ["assigned schedule", "/admin/schedule"],
  ]) {
    await admin.goto(BASE + path, { waitUntil: "networkidle" });
    const overflow = await overflowOf(admin);
    const hidden = await hiddenBehindNav(admin);
    check(`${name} fits the screen`, overflow === 0, `${overflow}px of sideways scroll`);
    check(`${name} clears the bottom bar`, hidden === null, hidden ?? "");
  }

  console.log("\nthe laptop layout is untouched");
  const wide = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const widePage = await wide.newPage();
  await widePage.goto(`${BASE}/signin`, { waitUntil: "domcontentloaded" });
  await widePage.fill("#email", COACH);
  await widePage.click('button[type="submit"]');
  await widePage.waitForURL("**/check-email**");
  const link = await waitFor(() => linkFor(COACH));
  await widePage.goto(link, { waitUntil: "domcontentloaded" });
  await widePage.goto(`${BASE}/calendar?week=${day}`, { waitUntil: "networkidle" });
  check(
    "the week grid is back at 1440px",
    (await widePage.locator("[data-block]").count()) === 2 &&
      (await widePage.locator("[data-block]").first().isVisible()),
  );
  check(
    "and the bottom bar is gone",
    !(await widePage.locator("nav.fixed").first().isVisible().catch(() => false)),
  );
  check(
    "while the day list is hidden there",
    !(await widePage.locator("[data-slot]").first().isVisible().catch(() => false)),
  );
} finally {
  await browser.close();
  try {
    await db.booking.deleteMany({ where: { date: day } });
    const removed = await db.user.deleteMany({ where: { email: { startsWith: "mob." } } });
    console.log(`\ncleaned up ${removed.count} test user(s) and their bookings`);
  } catch (error) {
    console.log(`\ncould not clean up: ${error.message}`);
  }
  await db.$disconnect();
}

console.log(`\n${passed} passed, ${failures.length} failed`);
for (const failure of failures) console.log(`  · ${failure}`);
process.exitCode = failures.length ? 1 : 0;
