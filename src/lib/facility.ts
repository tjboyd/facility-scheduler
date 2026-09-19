import { db } from "@/lib/db";
import { DEFAULT_SETTINGS, type ClosureRange, type DayHours, type Settings } from "@/lib/rules";
import type { Weekday } from "@/lib/schedule";

/** Used when nothing has been configured yet — matches docs/DESIGN.md §5. */
export const DEFAULT_HOURS: DayHours[] = [
  { weekday: 0, isOpen: true, openMinutes: 8 * 60, closeMinutes: 18 * 60 },
  { weekday: 1, isOpen: true, openMinutes: 15 * 60, closeMinutes: 21 * 60 },
  { weekday: 2, isOpen: true, openMinutes: 15 * 60, closeMinutes: 21 * 60 },
  { weekday: 3, isOpen: true, openMinutes: 15 * 60, closeMinutes: 21 * 60 },
  { weekday: 4, isOpen: true, openMinutes: 15 * 60, closeMinutes: 21 * 60 },
  { weekday: 5, isOpen: true, openMinutes: 15 * 60, closeMinutes: 21 * 60 },
  { weekday: 6, isOpen: true, openMinutes: 8 * 60, closeMinutes: 20 * 60 },
];

export async function loadSettings(): Promise<Settings> {
  const row = await db.settings.findUnique({ where: { id: "singleton" } });
  if (!row) return { ...DEFAULT_SETTINGS };
  return {
    blockMinutes: row.blockMinutes,
    maxRequestMinutes: row.maxRequestMinutes,
    weeksAhead: row.weeksAhead,
    minNoticeHours: row.minNoticeHours,
    maxApprovedPerWeek: row.maxApprovedPerWeek,
    maxOpenRequests: row.maxOpenRequests,
    notifyCoachOnDecision: row.notifyCoachOnDecision,
    releaseNotifyEmail: row.releaseNotifyEmail,
  };
}

export async function loadHours(): Promise<DayHours[]> {
  const rows = await db.facilityHours.findMany();
  return DEFAULT_HOURS.map((fallback) => {
    const row = rows.find((r) => r.weekday === fallback.weekday);
    return row
      ? {
          weekday: row.weekday as Weekday,
          isOpen: row.isOpen,
          openMinutes: row.openMinutes,
          closeMinutes: row.closeMinutes,
        }
      : fallback;
  });
}

export async function loadClosures(): Promise<ClosureRange[]> {
  const rows = await db.closure.findMany({ orderBy: { startDate: "asc" } });
  return rows.map((r) => ({ startDate: r.startDate, endDate: r.endDate, reason: r.reason }));
}
