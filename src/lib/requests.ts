import { createHash, randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { APP_URL, FACILITY_TIMEZONE, ORG_NAME } from "@/lib/env";
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
    await sendMail({
      to: approver.email,
      subject: `Time request: ${request.teamName} — ${when(request)}`,
      text: [
        `${request.coachName} asked for facility time.`,
        "",
        `Team:   ${request.teamName}`,
        `When:   ${when(request)}`,
        `Coach:  ${request.coachEmail}`,
        ...(request.note ? ["", `Note:   "${request.note}"`] : []),
        "",
        "Approve it in one click:",
        `${APP_URL}/decide?token=${encodeURIComponent(token)}`,
        "",
        "Or open it to decline, which asks for a reason the coach will see:",
        `${APP_URL}/approvals`,
        "",
        "Until it is decided the slot shows as pending and no other team can take it.",
        `You get this because you can approve requests for the ${ORG_NAME} indoor facility.`,
      ].join("\n"),
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

  await sendMail({
    to: request.coachEmail,
    subject: `${decision === "APPROVED" ? "Approved" : "Declined"}: ${request.teamName} — ${when(request)}`,
    text:
      decision === "APPROVED"
        ? [
            `Your request is approved — ${request.teamName} has the facility.`,
            "",
            when(request),
            `Approved by ${decidedBy}.`,
            "",
            `See it on the calendar: ${APP_URL}/calendar`,
          ].join("\n")
        : [
            `Your request was declined.`,
            "",
            when(request),
            ...(reason ? ["", `Reason: ${reason}`] : []),
            "",
            `The slot is open again, so another time may work: ${APP_URL}/request`,
          ].join("\n"),
  });
}

export type { RequestSummary };
