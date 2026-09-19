/**
 * Photographs the running app for the review PDF.
 *
 *   npm run build && PORT=3000 npm start > server.log 2>&1 &
 *   node tools/capture_screens.mjs <out-dir>
 *
 * Seeds a week of believable demo data first — assigned blocks for several
 * teams, one released, one request waiting, one approved and one declined —
 * because empty screens tell you nothing about the flow. Everything it creates
 * is removed again at the end, including on failure.
 *
 * Writes <out-dir>/*.png plus <out-dir>/manifest.json, which build_app_pdf.py
 * reads for the page order and captions.
 */
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";
import { PrismaClient } from "@prisma/client";

const BASE = (process.env.BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
const MAIL_LOG = process.env.MAIL_LOG || "server.log";
const EXECUTABLE = process.env.CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const ADMIN = process.env.SEED_SUPER_ADMIN_EMAIL || "you@jrchargersbaseball.com";
const OUT = process.argv[2] || "/tmp/app-screens";

const DESKTOP = { width: 1440, height: 1000 };
const PHONE = { width: 390, height: 844 };

/** Everything this script creates is prefixed so cleanup can find it. */
const TAG = "demo.";
const COACH = `${TAG}rivera@jrchargersbaseball.com`;
const COACH2 = `${TAG}okafor@jrchargersbaseball.com`;
const APPROVER = `${TAG}scheduler@jrchargersbaseball.com`;

const db = new PrismaClient();
mkdirSync(OUT, { recursive: true });

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
/** The Sunday of the week we photograph. */
const sunday = addDays(today, -new Date(`${today}T00:00:00Z`).getUTCDay());
const at = (h, m = 0) => h * 60 + m;

function linkFor(email) {
  for (const block of readFileSync(MAIL_LOG, "utf8").split("── email ─").slice(1).reverse()) {
    if (!block.includes(`to:   ${email}`)) continue;
    const match = block.match(/(http\S*\/auth\/verify\?token=\S+)/);
    if (match) return match[1].replace(/^https?:\/\/[^/]+/, BASE);
  }
  return null;
}
function decideLinkFor(email) {
  for (const block of readFileSync(MAIL_LOG, "utf8").split("── email ─").slice(1).reverse()) {
    if (!block.includes(`to:   ${email}`)) continue;
    const match = block.match(/(http\S*\/decide\?token=\S+)/);
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

const shots = [];
let browser;

try {
  // ── demo data ──────────────────────────────────────────────────────────
  const team = async (name) => db.team.findFirstOrThrow({ where: { name } });
  const black = await team("U11 - Black");
  const red12 = await team("U12 - Red");
  const white13 = await team("U13 - White");
  const red9 = await team("U9 - Red");

  const coach = await db.user.create({
    data: { email: COACH, name: "Sam Rivera", role: "HEAD_COACH", status: "ACTIVE", teamId: black.id },
  });
  await db.user.create({
    data: { email: COACH2, name: "Dani Okafor", role: "HEAD_COACH", status: "ACTIVE", teamId: red12.id },
  });
  await db.user.create({
    data: { email: APPROVER, name: "Jordan Lee", role: "APPROVER", status: "ACTIVE" },
  });

  const block = (date, start, end, teamId, extra = {}) =>
    db.booking.create({
      data: { date, startMinutes: start, endMinutes: end, teamId, status: "HELD", origin: "ASSIGNED", ...extra },
    });

  // A week that looks like a real one: standing practice slots most evenings.
  await block(addDays(sunday, 6), at(8), at(9, 30), red9.id);
  await block(addDays(sunday, 6), at(9, 30), at(11), black.id);
  await block(addDays(sunday, 6), at(11), at(12, 30), red12.id);
  await block(addDays(sunday, 1), at(17), at(18, 30), white13.id);
  await block(addDays(sunday, 2), at(18), at(19, 30), red12.id);
  await block(addDays(sunday, 3), at(17, 30), at(19), black.id);
  await block(addDays(sunday, 4), at(19), at(20, 30), red9.id);

  // One block a team has given back — this is the "up for grabs" state.
  await db.booking.create({
    data: {
      date: addDays(sunday, 5), startMinutes: at(17), endMinutes: at(18, 30),
      teamId: null, releasedFromTeamId: white13.id, status: "RELEASED", origin: "ASSIGNED",
      releasedAt: new Date(),
    },
  });

  // One request waiting on a decision, one already approved, one declined.
  const pending = await db.booking.create({
    data: {
      date: addDays(sunday, 4), startMinutes: at(17), endMinutes: at(18, 30), teamId: black.id,
      status: "PENDING", origin: "REQUEST", requestedById: coach.id,
      note: "Makeup practice — our field time was rained out on Tuesday.",
    },
  });
  await db.booking.create({
    data: {
      date: addDays(sunday, 2), startMinutes: at(16), endMinutes: at(17), teamId: black.id,
      status: "HELD", origin: "REQUEST", requestedById: coach.id,
      decidedAt: new Date(), decidedVia: "EMAIL",
    },
  });
  await db.booking.create({
    data: {
      date: addDays(sunday, 3), startMinutes: at(20), endMinutes: at(21), teamId: black.id,
      status: "DECLINED", origin: "REQUEST", requestedById: coach.id,
      decidedAt: new Date(), decidedVia: "APP",
      declineReason: "Cage nets are being replaced that evening.",
    },
  });

  browser = await chromium.launch({ executablePath: EXECUTABLE, args: ["--no-sandbox"] });

  const openAs = async (email, viewport = DESKTOP) => {
    const context = await browser.newContext({
      viewport,
      deviceScaleFactor: 2,
      ...(viewport === PHONE ? { isMobile: true, hasTouch: true } : {}),
    });
    const page = await context.newPage();
    await page.goto(`${BASE}/signin`, { waitUntil: "domcontentloaded" });
    await page.fill("#email", email);
    await page.click('button[type="submit"]');
    await page.waitForURL("**/check-email**");
    const link = await waitFor(() => linkFor(email));
    if (!link) throw new Error(`no sign-in link for ${email}`);
    await page.goto(link, { waitUntil: "domcontentloaded" });
    return page;
  };

  const shoot = async (page, name, caption, section, phone = false) => {
    await page.waitForTimeout(250);
    const file = `${name}.png`;
    // A phone is shot at viewport height so the fixed bottom bar lands at the
    // bottom; a full-page shot would float it over the middle of the content.
    await page.screenshot({ path: `${OUT}/${file}`, fullPage: !phone });
    shots.push({ file, caption, section, phone });
    console.log(`  ${name}`);
  };

  // ── 1 · signing in ─────────────────────────────────────────────────────
  console.log("signing in");
  const anon = await (await browser.newContext({ viewport: DESKTOP, deviceScaleFactor: 2 })).newPage();
  await anon.goto(`${BASE}/signin`, { waitUntil: "networkidle" });
  await shoot(anon, "01-signin",
    "There are no passwords. A coach types the address the club added for them and gets a one-time link, good for fifteen minutes and usable once. An address that is not on the approved list cannot get in even with a valid link — that list is the access control.",
    "1 · Getting in");
  await anon.fill("#email", COACH);
  await anon.click('button[type="submit"]');
  await anon.waitForURL("**/check-email**");
  await anon.waitForLoadState("networkidle");
  await shoot(anon, "02-check-email",
    "The same answer whether or not the address is on the list, so this screen cannot be used to find out who is. A coach who is not on it is told to ask the club admin.",
    "1 · Getting in");

  // ── 2 · the coach's week ───────────────────────────────────────────────
  console.log("the coach's week");
  const coachPage = await openAs(COACH);
  await coachPage.goto(`${BASE}/calendar?week=${sunday}`, { waitUntil: "networkidle" });
  await shoot(coachPage, "03-calendar",
    "The shared source of truth. Solid crimson is reserved, dashed over stripes is waiting on an approver, dashed outline is time a team has given back. The three read differently in black and white, not by colour alone. Underneath: what this team holds this week, and what is up for grabs.",
    "2 · The coach's week");

  const mineId = await coachPage.locator('[data-block][data-status="HELD"]').first().getAttribute("data-block");
  await coachPage.goto(`${BASE}/booking/${mineId}`, { waitUntil: "networkidle" });
  await shoot(coachPage, "04-release",
    "Most of the facility's time is assigned rather than requested. A team that will not use its slot gives it back here — right up to the start time, because late notice beats an empty building.",
    "2 · The coach's week");

  await coachPage.goto(`${BASE}/calendar?week=${sunday}`, { waitUntil: "networkidle" });
  const freeId = await coachPage.locator('[data-block][data-status="RELEASED"]').first().getAttribute("data-block");
  await coachPage.goto(`${BASE}/booking/${freeId}`, { waitUntil: "networkidle" });
  await shoot(coachPage, "05-pickup",
    "Released time is first come, first served with no approval — it would otherwise go empty. Two coaches tapping at the same moment is a real race, so exactly one wins and the other is told plainly.",
    "2 · The coach's week");

  // ── 3 · asking for time ────────────────────────────────────────────────
  console.log("asking for time");
  const reqDate = addDays(sunday, 9);
  await coachPage.goto(`${BASE}/request?date=${reqDate}`, { waitUntil: "networkidle" });
  const start = await coachPage.locator("[data-start]").first().getAttribute("data-start");
  await coachPage.goto(`${BASE}/request?date=${reqDate}&start=${start}&len=60`, { waitUntil: "networkidle" });
  await shoot(coachPage, "06-request",
    "Only start times that something fits into are offered, and for a chosen start only the lengths that fit before the next booking or closing time. The summary names the exact block before it is sent. The same rules run again on submit — the picker is a convenience, never the enforcement.",
    "3 · Asking for time");

  await coachPage.goto(`${BASE}/requests`, { waitUntil: "networkidle" });
  await shoot(coachPage, "07-my-requests",
    "Everything the team holds or has asked for, and where it stands. A declined request carries the approver's reason, so nobody has to chase why.",
    "3 · Asking for time");

  // ── 4 · deciding ───────────────────────────────────────────────────────
  console.log("deciding");
  const approverPage = await openAs(APPROVER);
  await approverPage.goto(`${BASE}/approvals`, { waitUntil: "networkidle" });
  await shoot(approverPage, "08-approvals",
    "One card per waiting request: the team, when, the coach and their note, and an explicit clash check. Approve is the solid button and Decline the outline — never two reds. Declining asks for a reason the coach will read.",
    "4 · Deciding");

  // ── 5 · on a phone ─────────────────────────────────────────────────────
  console.log("on a phone");
  const phone = await openAs(COACH, PHONE);
  await phone.goto(`${BASE}/calendar?week=${sunday}&day=${addDays(sunday, 6)}`, { waitUntil: "networkidle" });
  await shoot(phone, "10-phone-calendar",
    "Seven columns do not fit on a phone, so a day becomes a list. Free time is merged into runs rather than a column of half-hours, and each run is a tap straight into the request screen with the day and start already filled in.",
    "5 · On a phone", true);
  await phone.goto(`${BASE}/request?date=${reqDate}`, { waitUntil: "networkidle" });
  await shoot(phone, "11-phone-request",
    "The same request screen, stacked. Start time and length are links rather than form controls, so the server knows exactly what is selected — which is also why the whole flow works with JavaScript switched off.",
    "5 · On a phone", true);

  // ── 6 · running the club ───────────────────────────────────────────────
  console.log("running the club");
  const admin = await openAs(ADMIN);
  for (const [name, path, caption] of [
    ["12-people", "/admin/people",
      "The allowlist is the access control. Paste in a list of addresses, set each person's role and team, remove or restore access. The last super admin cannot be demoted or removed — locking everyone out is the one mistake this screen could make that the app could not undo."],
    ["13-schedule", "/admin/schedule",
      "Standing practice time: give a team a repeating block and every date is written out as its own booking, so each can be released or picked up on its own. Only super admins set up anything repeating — coaches release and pick up, they never define a schedule."],
    ["14-hours", "/admin/hours",
      "When coaches may request time, per weekday, with closures for holidays and maintenance. Assigned time may sit outside these hours: the club opens the building when it needs to."],
    ["15-rules", "/admin/rules",
      "Block size and the longest single request, how far ahead and how late coaches can ask, per-team weekly limits, who is emailed about new requests, and the optional address told when a block is released."],
  ]) {
    await admin.goto(BASE + path, { waitUntil: "networkidle" });
    await shoot(admin, name, caption, "6 · Running the club");
  }

  // ── the one-click approval, last ───────────────────────────────────────
  // Shot last because following the link decides the request that the earlier
  // screens show as waiting. The token is minted exactly as the app does:
  // random, stored only as a SHA-256 hash, bound to this one booking.
  console.log("one-click approval");
  const raw = randomBytes(32).toString("base64url");
  await db.decisionToken.create({
    data: {
      tokenHash: createHash("sha256").update(raw).digest("hex"),
      bookingId: pending.id,
      decision: "APPROVE",
      expiresAt: new Date(Date.now() + 86_400_000),
    },
  });
  const oneClick = await (await browser.newContext({ viewport: DESKTOP, deviceScaleFactor: 2 })).newPage();
  await oneClick.goto(`${BASE}/decide?token=${encodeURIComponent(raw)}`, { waitUntil: "networkidle" });
  await shoot(oneClick, "09-one-click",
    "Approving takes one click straight from the emailed link, with no sign-in — the difference between a decision made at the field and one that waits until somebody is at a laptop. The link approves one booking, once, and dies the moment that booking is decided by any route. Declining is deliberately not one-click: it asks for a reason the coach will read.",
    "4 · Deciding");

  shots.sort((a, b) => a.file.localeCompare(b.file));
  writeFileSync(`${OUT}/manifest.json`, JSON.stringify(shots, null, 2));
  console.log(`\n${shots.length} screens → ${OUT}`);
} finally {
  if (browser) await browser.close();
  try {
    const users = await db.user.findMany({ where: { email: { startsWith: TAG } }, select: { id: true } });
    const ids = users.map((u) => u.id);
    await db.decisionToken.deleteMany({ where: { booking: { requestedById: { in: ids } } } });
    await db.booking.deleteMany({
      where: { OR: [{ date: { gte: sunday, lte: addDays(sunday, 20) } }, { requestedById: { in: ids } }] },
    });
    await db.user.deleteMany({ where: { email: { startsWith: TAG } } });
    console.log("cleaned up the demo data");
  } catch (error) {
    console.log(`could not clean up: ${error.message}`);
  }
  await db.$disconnect();
}
