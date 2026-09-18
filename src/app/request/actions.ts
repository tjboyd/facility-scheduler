"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { displayName } from "@/lib/domain";
import { emailApprovers } from "@/lib/requests";
import { requestContextFor } from "@/lib/requests";
import { validateRequest } from "@/lib/rules";
import { formatDateLong, formatRange } from "@/lib/schedule";

function back(date: string, message: string, kind: "ok" | "error"): never {
  redirect(`/request?date=${encodeURIComponent(date)}&msg=${encodeURIComponent(message)}&kind=${kind}`);
}

export async function submitRequest(formData: FormData): Promise<void> {
  const user = await getSessionUser();
  if (!user) redirect("/signin");

  const date = String(formData.get("date") ?? "").trim();
  const startMinutes = Number(String(formData.get("startMinutes") ?? ""));
  const lengthMinutes = Number(String(formData.get("lengthMinutes") ?? ""));
  const note = String(formData.get("note") ?? "").trim() || null;

  if (!user.team) back(date, "You need a team before you can request facility time.", "error");
  if (!Number.isInteger(startMinutes) || !Number.isInteger(lengthMinutes)) {
    back(date, "Pick a start time and a length.", "error");
  }

  const input = { date, startMinutes, endMinutes: startMinutes + lengthMinutes };
  const context = await requestContextFor(date, user.team.id);

  const problem = validateRequest(input, context);
  if (problem) back(date, problem, "error");

  const booking = await db.booking.create({
    data: {
      date,
      startMinutes: input.startMinutes,
      endMinutes: input.endMinutes,
      teamId: user.team.id,
      status: "PENDING",
      origin: "REQUEST",
      requestedById: user.id,
      note,
    },
  });

  // The request is saved before anything is emailed: a mail outage must not
  // lose a coach's request.
  try {
    await emailApprovers({
      id: booking.id,
      date: booking.date,
      startMinutes: booking.startMinutes,
      endMinutes: booking.endMinutes,
      teamName: user.team.name,
      coachName: displayName(user),
      coachEmail: user.email,
      note,
    });
  } catch (error) {
    console.error(`[request] could not email approvers for ${booking.id}:`, error);
  }

  revalidatePath("/calendar");
  revalidatePath("/requests");
  redirect(
    `/requests?msg=${encodeURIComponent(
      `Requested ${formatDateLong(date)}, ${formatRange(input.startMinutes, input.endMinutes)}. The approvers have been told.`,
    )}&kind=ok`,
  );
}

export async function withdrawRequest(formData: FormData): Promise<void> {
  const user = await getSessionUser();
  if (!user) redirect("/signin");

  const id = String(formData.get("bookingId") ?? "");
  const booking = await db.booking.findUnique({ where: { id } });
  if (!booking) redirect("/requests");

  const mine = booking.teamId === user.team?.id;
  if (!mine && user.role !== "SUPER_ADMIN") {
    redirect(`/requests?msg=${encodeURIComponent("That isn't your team's request.")}&kind=error`);
  }

  const updated = await db.booking.updateMany({
    where: { id, status: "PENDING" },
    data: { status: "WITHDRAWN" },
  });
  if (updated.count === 0) {
    redirect(`/requests?msg=${encodeURIComponent("That request has already been decided.")}&kind=error`);
  }

  await db.decisionToken.updateMany({
    where: { bookingId: id, consumedAt: null },
    data: { consumedAt: new Date() },
  });

  revalidatePath("/calendar");
  revalidatePath("/requests");
  redirect(`/requests?msg=${encodeURIComponent("Request withdrawn.")}&kind=ok`);
}
