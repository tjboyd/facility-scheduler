"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { FACILITY_TIMEZONE } from "@/lib/env";
import { assertSuperAdmin } from "@/lib/guards";
import {
  expandWeekly,
  findClashes,
  formatDateShort,
  parseTimeOfDay,
  todayInZone,
  validateSeries,
  WEEKDAYS,
  type Weekday,
} from "@/lib/schedule";

const SCHEDULE_PATH = "/admin/schedule";

function backWith(message: string, kind: "ok" | "error" = "ok"): never {
  redirect(`${SCHEDULE_PATH}?msg=${encodeURIComponent(message)}&kind=${kind}`);
}

/**
 * Assigns a team a repeating block — "U9 - White, Saturdays 8:00–9:30, from
 * today through 30 April". Every occurrence is written out as its own row, so
 * each one can be released, picked up or cancelled on its own.
 *
 * Dates that clash with something already booked are skipped rather than
 * failing the whole series: one busy Saturday in October should not stop the
 * other thirty being assigned. The skipped dates are named in the result.
 */
export async function createSeries(formData: FormData): Promise<void> {
  await assertSuperAdmin();

  const teamId = String(formData.get("teamId") ?? "").trim();
  const weekdayRaw = Number(String(formData.get("weekday") ?? ""));
  const startMinutes = parseTimeOfDay(String(formData.get("startTime") ?? ""));
  const endMinutes = parseTimeOfDay(String(formData.get("endTime") ?? ""));
  const startsOn = String(formData.get("startsOn") ?? "").trim();
  const endsOn = String(formData.get("endsOn") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim() || null;

  if (startMinutes === null || endMinutes === null) {
    backWith("Give a start and end time, like 8:00 AM and 9:30 AM.", "error");
  }

  const problems = validateSeries({
    weekday: weekdayRaw,
    startMinutes,
    endMinutes,
    startsOn,
    endsOn,
  });
  if (problems.length > 0) backWith(problems[0]!, "error");

  const team = await db.team.findUnique({ where: { id: teamId } });
  if (!team) backWith("Pick a team.", "error");
  if (team.archivedAt) backWith(`${team.name} is archived — restore it first.`, "error");

  const dates = expandWeekly({ weekday: weekdayRaw as Weekday, startsOn, endsOn });
  if (dates.length === 0) {
    backWith(`That range contains no ${WEEKDAYS[weekdayRaw as Weekday]}s.`, "error");
  }

  const existing = await db.booking.findMany({
    where: { date: { in: dates } },
    select: { id: true, date: true, startMinutes: true, endMinutes: true, teamId: true },
  });

  const proposed = dates.map((date) => ({ date, startMinutes, endMinutes }));
  const clashes = findClashes(proposed, existing);
  const clashingDates = new Set(clashes.map((c) => c.date));
  const usable = dates.filter((date) => !clashingDates.has(date));

  if (usable.length === 0) {
    backWith(
      `Every one of those ${dates.length} dates is already booked. Nothing was assigned.`,
      "error",
    );
  }

  const series = await db.assignedSeries.create({
    data: {
      teamId,
      weekday: weekdayRaw,
      startMinutes,
      endMinutes,
      startsOn,
      endsOn,
      note,
    },
  });

  await db.booking.createMany({
    data: usable.map((date) => ({
      date,
      startMinutes,
      endMinutes,
      teamId,
      status: "HELD",
      origin: "ASSIGNED",
      seriesId: series.id,
    })),
  });

  revalidatePath(SCHEDULE_PATH);
  revalidatePath("/calendar");

  if (clashingDates.size > 0) {
    const named = [...clashingDates].sort().slice(0, 4).map(formatDateShort).join(", ");
    const more = clashingDates.size > 4 ? ` and ${clashingDates.size - 4} more` : "";
    backWith(
      `Assigned ${usable.length} of ${dates.length} dates to ${team.name}. Skipped ${named}${more} — already booked.`,
      "error",
    );
  }
  backWith(`Assigned ${usable.length} dates to ${team.name}.`);
}

/**
 * Stops a series from today onwards. Past occurrences stay as history, and so
 * do any a team has already released or another team has picked up — those are
 * somebody else's plans now.
 */
export async function endSeries(formData: FormData): Promise<void> {
  await assertSuperAdmin();
  const seriesId = String(formData.get("seriesId") ?? "");

  const series = await db.assignedSeries.findUnique({
    where: { id: seriesId },
    include: { team: true },
  });
  if (!series) backWith("That schedule no longer exists.", "error");

  const today = todayInZone(FACILITY_TIMEZONE);
  const removed = await db.booking.deleteMany({
    where: {
      seriesId,
      date: { gte: today },
      status: "HELD",
      origin: "ASSIGNED",
      teamId: series.teamId,
    },
  });

  await db.assignedSeries.update({
    where: { id: seriesId },
    data: { endsOn: today < series.startsOn ? series.startsOn : today },
  });

  revalidatePath(SCHEDULE_PATH);
  revalidatePath("/calendar");
  backWith(
    `Ended ${series.team.name}'s ${WEEKDAYS[series.weekday as Weekday]} schedule and removed ${removed.count} upcoming ${removed.count === 1 ? "date" : "dates"}.`,
  );
}
