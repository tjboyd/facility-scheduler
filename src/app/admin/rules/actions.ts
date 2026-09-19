"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { assertSuperAdmin } from "@/lib/guards";
import { wouldSilenceAllApprovers } from "@/lib/domain";

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

  // Who hears about a new request. An unticked checkbox sends nothing at all,
  // so "on" is read as presence rather than by value.
  const deciders = await db.user.findMany({
    where: { role: { in: ["APPROVER", "SUPER_ADMIN"] }, status: { in: ["ACTIVE", "INVITED"] } },
    select: { id: true, notifyOnRequests: true },
  });
  const nextNotified = deciders.filter((d) => formData.get(`notify-${d.id}`) === "on");

  if (
    wouldSilenceAllApprovers({
      deciderIds: deciders.map((d) => d.id),
      nextNotifiedIds: nextNotified.map((d) => d.id),
    })
  ) {
    backWith(
      "Somebody has to be emailed when a request comes in, or requests would sit in " +
        "the queue with nobody told. Leave at least one approver ticked.",
      "error",
    );
  }

  const notifiedIds = new Set(nextNotified.map((d) => d.id));
  for (const person of deciders) {
    const next = notifiedIds.has(person.id);
    if (next === person.notifyOnRequests) continue;
    await db.user.update({ where: { id: person.id }, data: { notifyOnRequests: next } });
  }

  revalidatePath(PATH);
  revalidatePath("/calendar");
  backWith("Booking rules saved.");
}
