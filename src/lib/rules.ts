/**
 * What a coach is allowed to ask for, and what the facility has free.
 *
 * Pure — no database, no framework. Every rule the request screen enforces is
 * here, so the screen and the server action can't drift apart.
 */

import {
  addDays,
  BLOCK_MINUTES,
  formatRange,
  isDateString,
  overlaps,
  startOfWeek,
  weekdayOf,
  type Span,
  type Weekday,
} from "@/lib/schedule";

export type Settings = {
  blockMinutes: number;
  maxRequestMinutes: number;
  weeksAhead: number;
  minNoticeHours: number;
  maxApprovedPerWeek: number;
  maxOpenRequests: number;
  notifyCoachOnDecision: boolean;
  /** Empty or null means nobody is told when a block is released. */
  releaseNotifyEmail: string | null;
};

export const DEFAULT_SETTINGS: Settings = {
  blockMinutes: 30,
  maxRequestMinutes: 90,
  weeksAhead: 4,
  minNoticeHours: 24,
  maxApprovedPerWeek: 3,
  maxOpenRequests: 2,
  notifyCoachOnDecision: true,
  releaseNotifyEmail: null,
};

export type DayHours = {
  weekday: Weekday;
  isOpen: boolean;
  openMinutes: number;
  closeMinutes: number;
};

export type ClosureRange = { startDate: string; endDate: string; reason: string | null };

/** Statuses that occupy the calendar. A pending request holds its slot. */
export const OCCUPYING = ["PENDING", "HELD"] as const;

export function closureFor(date: string, closures: readonly ClosureRange[]): ClosureRange | null {
  return closures.find((c) => date >= c.startDate && date <= c.endDate) ?? null;
}

// ── what is free on a given day ────────────────────────────────────────────

export type Opening = {
  /** Minutes from midnight this block could start at. */
  startMinutes: number;
  /** Longest run free from here, capped by closing time and the request cap. */
  maxMinutes: number;
};

/**
 * Every start time a coach could pick on one day, with how long they could hold
 * it for. Used to build the picker *and* to validate the submission, so a
 * request that the screen offers can never be refused for a clash.
 */
export function openingsFor(
  hours: DayHours,
  taken: readonly Span[],
  settings: Settings,
): Opening[] {
  if (!hours.isOpen || hours.closeMinutes <= hours.openMinutes) return [];

  const block = settings.blockMinutes;
  const openings: Opening[] = [];

  for (let start = hours.openMinutes; start + block <= hours.closeMinutes; start += block) {
    // Walk forward in blocks until something is in the way or the day closes.
    let end = start;
    while (
      end + block <= hours.closeMinutes &&
      end - start + block <= settings.maxRequestMinutes &&
      !taken.some((t) => overlaps({ startMinutes: end, endMinutes: end + block }, t))
    ) {
      end += block;
    }
    if (end > start) openings.push({ startMinutes: start, maxMinutes: end - start });
  }

  return openings;
}

/** The lengths a coach may choose from, given the room at that start. */
export function lengthChoices(settings: Settings, maxMinutes: number): number[] {
  const choices: number[] = [];
  for (let n = settings.blockMinutes; n <= settings.maxRequestMinutes; n += settings.blockMinutes) {
    if (n <= maxMinutes) choices.push(n);
  }
  return choices;
}

export function describeLength(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = minutes / 60;
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)} ${hours === 1 ? "hour" : "hours"}`;
}

// ── validating a request ───────────────────────────────────────────────────

export type RequestInput = {
  date: string;
  startMinutes: number;
  endMinutes: number;
};

export type RequestContext = {
  settings: Settings;
  hours: DayHours;
  closures: readonly ClosureRange[];
  /** Blocks already occupying that day. */
  taken: readonly Span[];
  /** Today, in the facility's timezone. */
  today: string;
  /** Minutes from midnight, now, in the facility's timezone. */
  nowMinutes: number;
  /** The team's approved blocks in the same Sunday-to-Saturday week. */
  approvedThisWeek: number;
  /** The team's requests still waiting on a decision. */
  openRequests: number;
};

/** The first thing wrong with a request, or null. */
export function validateRequest(input: RequestInput, ctx: RequestContext): string | null {
  const { settings } = ctx;

  if (!isDateString(input.date)) return "Pick a date.";

  const length = input.endMinutes - input.startMinutes;
  if (length <= 0) return "The end time has to be after the start time.";
  if (input.startMinutes % settings.blockMinutes !== 0 || length % settings.blockMinutes !== 0) {
    return `Times have to land on ${settings.blockMinutes}-minute boundaries.`;
  }
  if (length > settings.maxRequestMinutes) {
    return `${describeLength(settings.maxRequestMinutes)} is the most you can request at once.`;
  }

  if (input.date < ctx.today) return "That date has already passed.";

  const lastAllowed = addDays(startOfWeek(ctx.today), ctx.settings.weeksAhead * 7 + 6);
  if (input.date > lastAllowed) {
    return `You can only request up to ${settings.weeksAhead} weeks ahead.`;
  }

  const closure = closureFor(input.date, ctx.closures);
  if (closure) {
    return `The facility is closed that day${closure.reason ? ` — ${closure.reason}` : ""}.`;
  }

  if (!ctx.hours.isOpen) return "The facility isn't open to requests that day.";
  if (input.startMinutes < ctx.hours.openMinutes || input.endMinutes > ctx.hours.closeMinutes) {
    return `That day the facility takes requests from ${formatRange(ctx.hours.openMinutes, ctx.hours.closeMinutes)}.`;
  }

  if (ctx.taken.some((t) => overlaps(input, t))) {
    return "Another team already has that time.";
  }

  const noticeMinutes =
    input.date === ctx.today
      ? input.startMinutes - ctx.nowMinutes
      : minutesBetween(ctx.today, ctx.nowMinutes, input.date, input.startMinutes);
  if (noticeMinutes < settings.minNoticeHours * 60) {
    return `Requests need at least ${settings.minNoticeHours} hours' notice.`;
  }

  if (ctx.openRequests >= settings.maxOpenRequests) {
    return `Your team already has ${ctx.openRequests} requests waiting on a decision.`;
  }
  if (ctx.approvedThisWeek >= settings.maxApprovedPerWeek) {
    return `Your team already has ${settings.maxApprovedPerWeek} bookings that week.`;
  }

  return null;
}

/** Whole minutes between two local wall-clock points. Calendar maths only. */
export function minutesBetween(
  fromDate: string,
  fromMinutes: number,
  toDate: string,
  toMinutes: number,
): number {
  const days = daysBetween(fromDate, toDate);
  return days * 24 * 60 + (toMinutes - fromMinutes);
}

export function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split("-").map(Number) as [number, number, number];
  const [ty, tm, td] = to.split("-").map(Number) as [number, number, number];
  // Date.UTC takes a 0-based month. Passing the 1-based one shifts each date
  // forward by a month, which is *not* a constant number of days, so the
  // difference would be wrong across a month boundary.
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
}

/** Counts toward the weekly limit: approved requests only, not assigned time. */
export function countsTowardWeeklyLimit(booking: {
  status: string;
  origin: string;
}): boolean {
  return booking.status === "HELD" && booking.origin === "REQUEST";
}

export { BLOCK_MINUTES, weekdayOf };

// ── the phone's day view ───────────────────────────────────────────────────

export type AgendaEntry<T> =
  | { kind: "free"; startMinutes: number; endMinutes: number }
  | { kind: "booked"; booking: T };

/**
 * One day as a top-to-bottom list: what is booked, and the gaps between.
 *
 * The week grid works on a laptop because seven columns fit side by side. On a
 * phone they do not, so a day becomes a list — which means free time has to be
 * spelled out rather than left as empty space, and consecutive free blocks read
 * far better merged ("Open · 1 hour") than as a column of half-hours.
 *
 * Free time is only ever reported inside the day's open hours, since that is
 * all a coach could request. Bookings are listed wherever they fall: assigned
 * time may sit outside those hours, and a day closed to requests can still have
 * the club's own sessions on it.
 */
export function dayAgenda<T extends Span>(
  hours: DayHours,
  bookings: readonly T[],
): AgendaEntry<T>[] {
  const sorted = [...bookings].sort(
    (a, b) => a.startMinutes - b.startMinutes || a.endMinutes - b.endMinutes,
  );

  const openStart = hours.isOpen && hours.closeMinutes > hours.openMinutes ? hours.openMinutes : null;
  const openEnd = openStart === null ? null : hours.closeMinutes;

  const entries: AgendaEntry<T>[] = [];
  const pushFree = (from: number, to: number) => {
    if (openStart === null || openEnd === null) return;
    const start = Math.max(from, openStart);
    const end = Math.min(to, openEnd);
    if (end > start) entries.push({ kind: "free", startMinutes: start, endMinutes: end });
  };

  // Where the last thing emitted ended. Infinity on a closed day, so nothing is
  // ever reported as free.
  let position = openStart ?? Number.POSITIVE_INFINITY;
  for (const booking of sorted) {
    pushFree(position, booking.startMinutes);
    entries.push({ kind: "booked", booking });
    position = Math.max(position, booking.endMinutes);
  }
  if (openEnd !== null) pushFree(position, openEnd);

  return entries;
}
