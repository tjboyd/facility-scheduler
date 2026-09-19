import { createHash, randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { APP_URL, FACILITY_TIMEZONE, ORG_NAME } from "@/lib/env";
import { renderEmail } from "@/lib/email";
import { sendMail } from "@/lib/mail";
import { loadClosures, loadHours, loadSettings } from "@/lib/facility";
import { countsTowardWeeklyLimit, OCCUPYING, type RequestContext } from "@/lib/rules";
import {
  addDays,
  formatDateLong,
  formatRange,
  startOfWeek,
  todayInZone,
  weekdayOf,
} from "@/lib/schedule";

/** Minutes from midnight, now, in the facility's timezone. */
export function nowMinutesInZone(now: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: FACILITY_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return (hour % 24) * 60 + minute;
}

/** Everything validateRequest needs, assembled for one team on one date. */
export async function requestContextFor(date: string, teamId: string): Promise<RequestContext> {
  const today = todayInZone(FACILITY_TIMEZONE);
  const [settings, hours, closures] = await Promise.all([
    loadSettings(),
    loadHours(),
    loadClosures(),
  ]);

  const weekStart = startOfWeek(date);
  const weekDatesRange = { gte: weekStart, lte: addDays(weekStart, 6) };

  const [taken, weekBookings, openRequests] = await Promise.all([
    db.booking.findMany({
      where: { date, status: { in: [...OCCUPYING] } },
      select: { startMinutes: true, endMinutes: true },
    }),
    db.booking.findMany({
      where: { date: weekDatesRange, teamId, status: "HELD", origin: "REQUEST" },
      select: { status: true, origin: true },
    }),
    db.booking.count({ where: { teamId, status: "PENDING" } }),
  ]);

  return {
    settings,
    hours: hours[weekdayOf(date)]!,
    closures,
    taken,
    today,
    nowMinutes: nowMinutesInZone(),
    approvedThisWeek: weekBookings.filter(countsTowardWeeklyLimit).length,
    openRequests,
  };
}

// ── one-click approval ─────────────────────────────────────────────────────

const DECISION_TOKEN_DAYS = 30;

function hash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * A link that approves one booking, once, without signing in.
 *
 * Bound to a single booking and to approving it: it cannot decline, cannot
 * touch another booking, and cannot be replayed. It dies the moment the booking
 * is decided by any route. Declining is deliberately not one-click, because it
 * asks for a reason the coach will read.
 */
export async function issueApprovalToken(bookingId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await db.decisionToken.create({
    data: {
      tokenHash: hash(token),
      bookingId,
      decision: "APPROVE",
      expiresAt: new Date(Date.now() + DECISION_TOKEN_DAYS * 86_400_000),
    },
  });
  return token;
}

export type TokenLookup =
  | { ok: true; bookingId: string; tokenId: string }
  | { ok: false; reason: "invalid" | "expired" | "used" };

export async function lookupApprovalToken(token: string): Promise<TokenLookup> {
  const row = await db.decisionToken.findUnique({ where: { tokenHash: hash(token) } });
  if (!row) return { ok: false, reason: "invalid" };
  if (row.consumedAt) return { ok: false, reason: "used" };
  if (row.expiresAt.getTime() <= Date.now()) return { ok: false, reason: "expired" };
  return { ok: true, bookingId: row.bookingId, tokenId: row.id };
}

/** Kills every outstanding one-click link for a booking. */
export async function burnTokensFor(bookingId: string): Promise<void> {
  await db.decisionToken.updateMany({
    where: { bookingId, consumedAt: null },
    data: { consumedAt: new Date() },
  });
}

// ── email ──────────────────────────────────────────────────────────────────

type RequestSummary = {
  id: string;
  date: string;
  startMinutes: number;
  endMinutes: number;
  teamName: string;
  coachName: string;
  coachEmail: string;
  note: string | null;
};

function when(request: RequestSummary): string {
  return `${formatDateLong(request.date)}, ${request.date.slice(0, 4)} · ${formatRange(
    request.startMinutes,
    request.endMinutes,
  )}`;
}

/** Tells everyone who can decide, each with their own one-click approve link. */
export async function emailApprovers(request: RequestSummary): Promise<void> {
  const approvers = await db.user.findMany({
    where: {
      role: { in: ["APPROVER", "SUPER_ADMIN"] },
      status: { in: ["ACTIVE", "INVITED"] },
      // Somebody who has turned these off still sees the request in the queue;
      // they have just said they would rather not be emailed about it. The
      // people screen will not let the last one opt out, so this is never empty
      // while anyone can decide at all.
      notifyOnRequests: true,
    },
    select: { email: true },
  });

  for (const approver of approvers) {
    const token = await issueApprovalToken(request.id);
    const { html, text } = renderEmail({
      eyebrow: "Time request",
      title: `${request.teamName} — ${when(request)}`,
      preheader: `${request.coachName} asked for ${when(request)}. Approve it in one click.`,
      blocks: [
        { kind: "text", text: `${request.coachName} asked for facility time.` },
        {
          kind: "facts",
          facts: [
            { label: "Team", value: request.teamName },
            { label: "When", value: when(request) },
            { label: "Coach", value: request.coachEmail },
          ],
        },
        ...(request.note
          ? [{ kind: "quote" as const, text: request.note }]
          : []),
        {
          kind: "button",
          label: "Approve this request",
          url: `${APP_URL}/decide?token=${encodeURIComponent(token)}`,
        },
        {
          kind: "link",
          label: "Or open the queue to decline it, which asks for a reason the coach will see",
          url: `${APP_URL}/approvals`,
        },
        {
          kind: "text",
          text: "Until it is decided the slot shows as pending, and no other team can take it.",
        },
      ],
      footer: [
        `You get this because you can approve requests for the ${ORG_NAME} indoor facility.`,
        "Turn these off for yourself on Admin → Booking rules.",
      ],
    });

    await sendMail({
      to: approver.email,
      subject: `Time request: ${request.teamName} — ${when(request)}`,
      text,
      html,
    });
  }
}

export async function emailCoachDecision(
  request: RequestSummary,
  decision: "APPROVED" | "DECLINED",
  reason: string | null,
  decidedBy: string,
): Promise<void> {
  const settings = await loadSettings();
  if (!settings.notifyCoachOnDecision) return;

  const approved = decision === "APPROVED";
  const { html, text } = renderEmail(
    approved
      ? {
          eyebrow: "Approved",
          title: `${request.teamName} has the facility`,
          preheader: `${when(request)} — approved by ${decidedBy}.`,
          blocks: [
            { kind: "text", text: "Your request is approved. The block is yours." },
            {
              kind: "facts",
              facts: [
                { label: "Team", value: request.teamName },
                { label: "When", value: when(request) },
                { label: "Approved by", value: decidedBy },
              ],
            },
            { kind: "button", label: "See it on the calendar", url: `${APP_URL}/calendar` },
            {
              kind: "text",
              text:
                "If it turns out you can't use it, release it from the calendar and another " +
                "team can pick it up.",
            },
          ],
          footer: [`${ORG_NAME} indoor facility scheduler.`],
        }
      : {
          eyebrow: "Declined",
          title: `${request.teamName} — ${when(request)}`,
          preheader: reason ? `Declined — ${reason}` : "Your request was declined.",
          blocks: [
            { kind: "text", text: `Your request was declined by ${decidedBy}.` },
            {
              kind: "facts",
              facts: [
                { label: "Team", value: request.teamName },
                { label: "When", value: when(request) },
              ],
            },
            ...(reason ? [{ kind: "quote" as const, text: reason }] : []),
            {
              kind: "text",
              text: "The slot is open again, so another time may work.",
            },
            { kind: "button", label: "Ask for another time", url: `${APP_URL}/request` },
          ],
          footer: [`${ORG_NAME} indoor facility scheduler.`],
        },
  );

  await sendMail({
    to: request.coachEmail,
    subject: `${approved ? "Approved" : "Declined"}: ${request.teamName} — ${when(request)}`,
    text,
    html,
  });
}

export type { RequestSummary };

/**
 * Tells the club's scheduler that a team has given a block back, so somebody
 * can chase it rather than leaving it to sit on the calendar unnoticed.
 *
 * Off unless an address is set: the calendar is the record, and a club that
 * does not want the traffic simply leaves the field empty. Picking a block up
 * deliberately sends nothing — that one was offered and declined.
 */
export async function emailReleaseNotice(released: {
  date: string;
  startMinutes: number;
  endMinutes: number;
  teamName: string;
  releasedBy: string;
}): Promise<void> {
  const settings = await loadSettings();
  const to = settings.releaseNotifyEmail?.trim();
  if (!to) return;

  const when = `${formatDateLong(released.date)}, ${released.date.slice(0, 4)} · ${formatRange(
    released.startMinutes,
    released.endMinutes,
  )}`;

  const { html, text } = renderEmail({
    eyebrow: "Released",
    title: `${released.teamName} gave back ${when}`,
    preheader: `${released.teamName} has given back facility time — it is up for grabs.`,
    blocks: [
      { kind: "text", text: `${released.teamName} has given back facility time.` },
      {
        kind: "facts",
        facts: [
          { label: "When", value: when },
          { label: "Released by", value: released.releasedBy },
        ],
      },
      {
        kind: "text",
        text:
          "It is on the calendar as available now — first come, first served, and any team can " +
          "pick it up without approval.",
      },
      { kind: "button", label: "See the calendar", url: `${APP_URL}/calendar` },
    ],
    footer: [
      `You get this because you are set as the scheduler for the ${ORG_NAME} indoor facility.`,
      "Clear that address on Admin → Booking rules to stop these.",
    ],
  });

  await sendMail({ to, subject: `Released: ${released.teamName} — ${when}`, text, html });
}
