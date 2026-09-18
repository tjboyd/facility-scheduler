/**
 * Calendar and recurrence rules. Pure — no database, no framework.
 *
 * Everything here works in the facility's *local wall clock*: a calendar date
 * ("2026-11-08") plus minutes from midnight (8:00 AM is 480). A series that runs
 * from November to April crosses a daylight-saving change, and 8:00 has to stay
 * 8:00 on both sides of it — which it does not if you store instants and add
 * seven days. Date arithmetic below uses UTC purely as a calendar, never as a
 * timezone, so no conversion ever happens.
 */

export const BLOCK_MINUTES = 30;
export const DAY_MINUTES = 24 * 60;

export const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

// ── time of day ────────────────────────────────────────────────────────────

/** Accepts "8:00", "08:00", "8:00 AM", "8am", "20:30". Returns minutes. */
export function parseTimeOfDay(input: string): number | null {
  const text = input.trim().toLowerCase().replace(/\s+/g, " ");
  const match = text.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!match) return null;

  let hours = Number(match[1]);
  const minutes = match[2] ? Number(match[2]) : 0;
  const meridiem = match[3];

  if (minutes > 59) return null;
  if (meridiem) {
    if (hours < 1 || hours > 12) return null;
    if (hours === 12) hours = 0;
    if (meridiem === "pm") hours += 12;
  } else if (hours > 23) {
    return null;
  }
  return hours * 60 + minutes;
}

export function formatTimeOfDay(minutes: number): string {
  const h24 = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  const meridiem = h24 < 12 ? "AM" : "PM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${meridiem}`;
}

/** "8:00 – 9:30 AM" style, dropping the repeated meridiem where it matches. */
export function formatRange(startMinutes: number, endMinutes: number): string {
  const start = formatTimeOfDay(startMinutes);
  const end = formatTimeOfDay(endMinutes);
  const startMeridiem = start.slice(-2);
  if (startMeridiem === end.slice(-2)) return `${start.slice(0, -3)} – ${end}`;
  return `${start} – ${end}`;
}

export function isOnBlockGrid(minutes: number, block = BLOCK_MINUTES): boolean {
  return Number.isInteger(minutes) && minutes >= 0 && minutes % block === 0;
}

// ── calendar dates ─────────────────────────────────────────────────────────

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isDateString(value: string): boolean {
  const match = value.match(DATE_RE);
  if (!match) return false;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const asDate = new Date(Date.UTC(y, m - 1, d));
  // Rejects 2026-02-31, which Date would silently roll into March.
  return (
    asDate.getUTCFullYear() === y && asDate.getUTCMonth() === m - 1 && asDate.getUTCDate() === d
  );
}

function toUtc(date: string): Date {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d));
}

function fromUtc(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  const d = toUtc(date);
  d.setUTCDate(d.getUTCDate() + days);
  return fromUtc(d);
}

/** 0 = Sunday … 6 = Saturday. */
export function weekdayOf(date: string): Weekday {
  return toUtc(date).getUTCDay() as Weekday;
}

/** The Sunday on or before `date` — the calendar runs Sunday to Saturday. */
export function startOfWeek(date: string): string {
  return addDays(date, -weekdayOf(date));
}

export function weekDates(sunday: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(sunday, i));
}

/** Today's calendar date in the facility's timezone. */
export function todayInZone(timeZone: string, now: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function formatDateLong(date: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(toUtc(date));
}

export function formatDateShort(date: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
  }).format(toUtc(date));
}

// ── recurrence ─────────────────────────────────────────────────────────────

export type SeriesSpec = {
  weekday: Weekday;
  startsOn: string;
  endsOn: string;
};

/**
 * Every date the series falls on, inclusive of both bounds. Returns [] rather
 * than throwing when the range is backwards or empty.
 */
export function expandWeekly(spec: SeriesSpec): string[] {
  if (!isDateString(spec.startsOn) || !isDateString(spec.endsOn)) return [];
  if (spec.endsOn < spec.startsOn) return [];

  const offset = (spec.weekday - weekdayOf(spec.startsOn) + 7) % 7;
  const dates: string[] = [];
  for (let date = addDays(spec.startsOn, offset); date <= spec.endsOn; date = addDays(date, 7)) {
    dates.push(date);
  }
  return dates;
}

// ── overlap ────────────────────────────────────────────────────────────────

export type Span = { startMinutes: number; endMinutes: number };

/** Half-open: a block ending at 9:30 does not clash with one starting at 9:30. */
export function overlaps(a: Span, b: Span): boolean {
  return a.startMinutes < b.endMinutes && b.startMinutes < a.endMinutes;
}

export type DatedSpan = Span & { date: string };

/** The existing blocks a proposed set of dated spans would run into. */
export function findClashes<T extends DatedSpan>(
  proposed: readonly DatedSpan[],
  existing: readonly T[],
): { date: string; against: T }[] {
  const byDate = new Map<string, T[]>();
  for (const item of existing) {
    const list = byDate.get(item.date);
    if (list) list.push(item);
    else byDate.set(item.date, [item]);
  }

  const clashes: { date: string; against: T }[] = [];
  for (const span of proposed) {
    for (const against of byDate.get(span.date) ?? []) {
      if (overlaps(span, against)) clashes.push({ date: span.date, against });
    }
  }
  return clashes;
}

// ── validation ─────────────────────────────────────────────────────────────

export type SeriesInput = {
  weekday: number;
  startMinutes: number;
  endMinutes: number;
  startsOn: string;
  endsOn: string;
};

/**
 * Admin-assigned time is deliberately *not* held to the 1.5-hour cap that
 * applies to coach requests — the club can assign a team a three-hour block if
 * it wants to. It still has to sit on the 30-minute grid so the calendar lines
 * up.
 */
export function validateSeries(input: SeriesInput): string[] {
  const problems: string[] = [];

  if (!Number.isInteger(input.weekday) || input.weekday < 0 || input.weekday > 6) {
    problems.push("Pick a day of the week.");
  }
  if (!isOnBlockGrid(input.startMinutes) || !isOnBlockGrid(input.endMinutes)) {
    problems.push(`Start and end have to land on ${BLOCK_MINUTES}-minute boundaries.`);
  }
  if (input.endMinutes <= input.startMinutes) {
    problems.push("The end time has to be after the start time.");
  }
  if (input.endMinutes > DAY_MINUTES) {
    problems.push("A block can't run past midnight.");
  }
  if (!isDateString(input.startsOn) || !isDateString(input.endsOn)) {
    problems.push("Give both a start and an end date.");
  } else if (input.endsOn < input.startsOn) {
    problems.push("The end date is before the start date.");
  }
  return problems;
}

// ── who may do what ────────────────────────────────────────────────────────

export type BookingView = {
  id: string;
  date: string;
  startMinutes: number;
  endMinutes: number;
  status: "HELD" | "RELEASED";
  origin: "ASSIGNED" | "PICKUP";
  teamId: string | null;
};

export type Actor = {
  role: "HEAD_COACH" | "APPROVER" | "SUPER_ADMIN";
  teamId: string | null;
};

/**
 * A team gives back time it will not use. Their own coaches can, and so can an
 * admin on their behalf — clubs run on phone calls, and the admin is the one
 * who gets them.
 */
export function canRelease(booking: BookingView, actor: Actor): boolean {
  if (booking.status !== "HELD") return false;
  if (actor.role === "SUPER_ADMIN") return true;
  return booking.teamId !== null && booking.teamId === actor.teamId;
}

/**
 * Released time is first come, first served: any team with a coach can take it,
 * with no approval, because it is time that would otherwise go empty. A team
 * cannot claim back the slot it just released — releasing is the undo.
 */
export function canClaim(booking: BookingView, actor: Actor): boolean {
  if (booking.status !== "RELEASED") return false;
  return actor.teamId !== null;
}

/** Past blocks are history: nothing can be released or claimed. */
export function isPast(booking: { date: string }, today: string): boolean {
  return booking.date < today;
}
