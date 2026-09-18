"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { FACILITY_TIMEZONE } from "@/lib/env";
import { getSessionUser } from "@/lib/auth";
import {
  canClaim,
  canRelease,
  formatDateLong,
  formatRange,
  isPast,
  overlaps,
  todayInZone,
  type BookingView,
} from "@/lib/schedule";

function backTo(id: string, message: string, kind: "ok" | "error" = "ok"): never {
  redirect(`/booking/${id}?msg=${encodeURIComponent(message)}&kind=${kind}`);
}

function toView(row: {
  id: string;
  date: string;
  startMinutes: number;
  endMinutes: number;
  status: string;
  origin: string;
  teamId: string | null;
}): BookingView {
  return {
    id: row.id,
    date: row.date,
    startMinutes: row.startMinutes,
    endMinutes: row.endMinutes,
    status: row.status === "RELEASED" ? "RELEASED" : "HELD",
    origin: row.origin === "PICKUP" ? "PICKUP" : "ASSIGNED",
    teamId: row.teamId,
  };
}

/** A team gives back time it will not use; it becomes first come, first served. */
export async function releaseBooking(formData: FormData): Promise<void> {
  const user = await getSessionUser();
  if (!user) redirect("/signin");

  const id = String(formData.get("bookingId") ?? "");
  const booking = await db.booking.findUnique({ where: { id }, include: { team: true } });
  if (!booking) redirect("/calendar");

  const today = todayInZone(FACILITY_TIMEZONE);
  if (isPast(booking, today)) backTo(id, "That block is in the past.", "error");
  if (!canRelease(toView(booking), { role: user.role, teamId: user.team?.id ?? null })) {
    backTo(id, "That isn't your team's block to release.", "error");
  }

  const updated = await db.booking.updateMany({
    where: { id, status: "HELD" },
    data: {
      status: "RELEASED",
      releasedFromTeamId: booking.teamId,
      teamId: null,
      releasedAt: new Date(),
      claimedAt: null,
    },
  });
  if (updated.count === 0) backTo(id, "That block had already changed hands.", "error");

  revalidatePath("/calendar");
  revalidatePath(`/booking/${id}`);
  backTo(
    id,
    `Released ${formatDateLong(booking.date)}, ${formatRange(booking.startMinutes, booking.endMinutes)}. Any team can pick it up now.`,
  );
}

/**
 * Picks up released time. First come, first served and no approval — it is time
 * that would otherwise go empty.
 *
 * The update is conditional on the row still being RELEASED, so two coaches
 * tapping at the same moment cannot both get it: exactly one update matches,
 * and the other is told plainly.
 */
export async function claimBooking(formData: FormData): Promise<void> {
  const user = await getSessionUser();
  if (!user) redirect("/signin");

  const id = String(formData.get("bookingId") ?? "");
  const booking = await db.booking.findUnique({ where: { id } });
  if (!booking) redirect("/calendar");

  const today = todayInZone(FACILITY_TIMEZONE);
  if (isPast(booking, today)) backTo(id, "That block is in the past.", "error");

  const actor = { role: user.role, teamId: user.team?.id ?? null };
  if (!canClaim(toView(booking), actor)) {
    backTo(
      id,
      user.team
        ? "That block isn't available."
        : "You need a team before you can pick up facility time.",
      "error",
    );
  }

  // A team cannot be in two places at once.
  const sameDay = await db.booking.findMany({
    where: { date: booking.date, teamId: user.team!.id, status: "HELD" },
    select: { startMinutes: true, endMinutes: true },
  });
  if (sameDay.some((other) => overlaps(other, booking))) {
    backTo(id, `${user.team!.name} already has facility time that overlaps this block.`, "error");
  }

  const claimed = await db.booking.updateMany({
    where: { id, status: "RELEASED" },
    data: {
      status: "HELD",
      origin: "PICKUP",
      teamId: user.team!.id,
      claimedAt: new Date(),
    },
  });
  if (claimed.count === 0) {
    backTo(id, "Another team picked that up first.", "error");
  }

  revalidatePath("/calendar");
  revalidatePath(`/booking/${id}`);
  backTo(
    id,
    `${user.team!.name} has ${formatDateLong(booking.date)}, ${formatRange(booking.startMinutes, booking.endMinutes)}.`,
  );
}
