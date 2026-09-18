"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { assertSuperAdmin } from "@/lib/guards";

const PATH = "/admin/rules";

function backWith(message: string, kind: "ok" | "error" = "ok"): never {
  redirect(`${PATH}?msg=${encodeURIComponent(message)}&kind=${kind}`);
}

function intField(formData: FormData, name: string, min: number, max: number): number | null {
  const value = Number(String(formData.get(name) ?? ""));
  if (!Number.isInteger(value) || value < min || value > max) return null;
  return value;
}

export async function saveRules(formData: FormData): Promise<void> {
  await assertSuperAdmin();

  const blockMinutes = intField(formData, "blockMinutes", 5, 120);
  const maxRequestMinutes = intField(formData, "maxRequestMinutes", 5, 600);
  const weeksAhead = intField(formData, "weeksAhead", 1, 52);
  const minNoticeHours = intField(formData, "minNoticeHours", 0, 336);
  const maxApprovedPerWeek = intField(formData, "maxApprovedPerWeek", 1, 50);
  const maxOpenRequests = intField(formData, "maxOpenRequests", 1, 50);
  const notifyCoachOnDecision = formData.get("notifyCoachOnDecision") === "on";

  if (
    blockMinutes === null ||
    maxRequestMinutes === null ||
    weeksAhead === null ||
    minNoticeHours === null ||
    maxApprovedPerWeek === null ||
    maxOpenRequests === null
  ) {
    backWith("Some of those numbers are out of range.", "error");
  }
  if (maxRequestMinutes % blockMinutes !== 0) {
    backWith(
      `The longest request has to be a whole number of ${blockMinutes}-minute blocks.`,
      "error",
    );
  }

  await db.settings.upsert({
    where: { id: "singleton" },
    update: {
      blockMinutes,
      maxRequestMinutes,
      weeksAhead,
      minNoticeHours,
      maxApprovedPerWeek,
      maxOpenRequests,
      notifyCoachOnDecision,
    },
    create: {
      id: "singleton",
      blockMinutes,
      maxRequestMinutes,
      weeksAhead,
      minNoticeHours,
      maxApprovedPerWeek,
      maxOpenRequests,
      notifyCoachOnDecision,
    },
  });

  revalidatePath(PATH);
  revalidatePath("/calendar");
  backWith("Booking rules saved.");
}
