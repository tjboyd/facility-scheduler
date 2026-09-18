"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { assertSuperAdmin } from "@/lib/guards";
import { DEFAULT_HOURS } from "@/lib/facility";
import { isDateString, isOnBlockGrid, parseTimeOfDay, WEEKDAYS } from "@/lib/schedule";

const PATH = "/admin/hours";

function backWith(message: string, kind: "ok" | "error" = "ok"): never {
  redirect(`${PATH}?msg=${encodeURIComponent(message)}&kind=${kind}`);
}

/** Saves all seven days at once, so the screen is one form and one Save. */
export async function saveHours(formData: FormData): Promise<void> {
  await assertSuperAdmin();

  const days = DEFAULT_HOURS.map((fallback) => {
    const d = fallback.weekday;
    return {
      weekday: d,
      isOpen: formData.get(`open-${d}`) === "on",
      openMinutes: parseTimeOfDay(String(formData.get(`from-${d}`) ?? "")),
      closeMinutes: parseTimeOfDay(String(formData.get(`to-${d}`) ?? "")),
    };
  });

  for (const day of days) {
    if (day.openMinutes === null || day.closeMinutes === null) {
      backWith(`${WEEKDAYS[day.weekday]}: give both an opening and a closing time.`, "error");
    }
    if (!isOnBlockGrid(day.openMinutes) || !isOnBlockGrid(day.closeMinutes)) {
      backWith(`${WEEKDAYS[day.weekday]}: times have to land on 30-minute boundaries.`, "error");
    }
    if (day.isOpen && day.closeMinutes <= day.openMinutes) {
      backWith(`${WEEKDAYS[day.weekday]}: closing time has to be after opening time.`, "error");
    }
  }

  for (const day of days) {
    await db.facilityHours.upsert({
      where: { weekday: day.weekday },
      update: {
        isOpen: day.isOpen,
        openMinutes: day.openMinutes!,
        closeMinutes: day.closeMinutes!,
      },
      create: {
        weekday: day.weekday,
        isOpen: day.isOpen,
        openMinutes: day.openMinutes!,
        closeMinutes: day.closeMinutes!,
      },
    });
  }

  revalidatePath(PATH);
  revalidatePath("/calendar");
  const open = days.filter((d) => d.isOpen).length;
  backWith(`Saved. The facility takes requests on ${open} ${open === 1 ? "day" : "days"} a week.`);
}

export async function addClosure(formData: FormData): Promise<void> {
  await assertSuperAdmin();

  const startDate = String(formData.get("startDate") ?? "").trim();
  const endDateRaw = String(formData.get("endDate") ?? "").trim();
  const endDate = endDateRaw || startDate;
  const reason = String(formData.get("reason") ?? "").trim() || null;

  if (!isDateString(startDate) || !isDateString(endDate)) backWith("Pick a date.", "error");
  if (endDate < startDate) backWith("The last day is before the first.", "error");

  await db.closure.create({ data: { startDate, endDate, reason } });
  revalidatePath(PATH);
  revalidatePath("/calendar");
  backWith(
    startDate === endDate
      ? `Closed ${startDate}${reason ? ` — ${reason}` : ""}.`
      : `Closed ${startDate} to ${endDate}${reason ? ` — ${reason}` : ""}.`,
  );
}

export async function removeClosure(formData: FormData): Promise<void> {
  await assertSuperAdmin();
  const id = String(formData.get("closureId") ?? "");
  const closure = await db.closure.findUnique({ where: { id } });
  if (!closure) backWith("That closure is already gone.", "error");
  await db.closure.delete({ where: { id } });
  revalidatePath(PATH);
  revalidatePath("/calendar");
  backWith(`Removed the ${closure.startDate} closure.`);
}
