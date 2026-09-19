"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { canDecideRequests, displayName, wouldSilenceAllApprovers } from "@/lib/domain";
import { burnTokensFor, emailCoachDecision } from "@/lib/requests";
import { overlaps } from "@/lib/schedule";

function back(message: string, kind: "ok" | "error"): never {
  redirect(`/approvals?msg=${encodeURIComponent(message)}&kind=${kind}`);
}

type Decision = "APPROVE" | "DECLINE";

/**
 * `gone` — the booking was deleted. `decided` — somebody got there first, by
 * either route. `clash` — the slot was taken while the request sat in an inbox.
 * `raced` — two decisions landed together and this one lost.
 */
type DecisionCode = "ok" | "gone" | "decided" | "clash" | "raced";

type DecisionResult = { ok: boolean; code: DecisionCode; message: string };

/**
 * Decides a pending request. Shared by the approvals screen and the one-click
 * link in the approver's email, so both routes behave identically.
 *
 * Returns an outcome rather than redirecting, because the email route lands on
 * its own confirmation page. `code` is for callers that branch on the outcome;
 * `message` is for the ones that just show it.
 */
export async function decide(
  bookingId: string,
  decision: Decision,
  decidedById: string | null,
  decidedByName: string,
  via: "APP" | "EMAIL",
  reason: string | null,
): Promise<DecisionResult> {
  const booking = await db.booking.findUnique({
    where: { id: bookingId },
    include: { team: true, requestedBy: true },
  });
  if (!booking) return { ok: false, code: "gone", message: "That request no longer exists." };
  if (booking.status !== "PENDING") {
    return { ok: false, code: "decided", message: "That request has already been decided." };
  }

  if (decision === "APPROVE") {
    // Something else may have taken the slot while this sat in an inbox.
    const clashes = await db.booking.findMany({
      where: { date: booking.date, status: { in: ["PENDING", "HELD"] }, id: { not: bookingId } },
      select: { startMinutes: true, endMinutes: true, status: true },
    });
    if (clashes.some((c) => c.status === "HELD" && overlaps(c, booking))) {
      return {
        ok: false,
        code: "clash",
        message: "Another team has taken that time since the request came in.",
      };
    }
  }

  const updated = await db.booking.updateMany({
    where: { id: bookingId, status: "PENDING" },
    data: {
      status: decision === "APPROVE" ? "HELD" : "DECLINED",
      decidedById,
      decidedAt: new Date(),
      decidedVia: via,
      declineReason: decision === "DECLINE" ? reason : null,
    },
  });
  if (updated.count === 0) {
    return { ok: false, code: "raced", message: "Somebody else decided that request first." };
  }

  await burnTokensFor(bookingId);

  if (booking.requestedBy && booking.team) {
    try {
      await emailCoachDecision(
        {
          id: booking.id,
          date: booking.date,
          startMinutes: booking.startMinutes,
          endMinutes: booking.endMinutes,
          teamName: booking.team.name,
          coachName: displayName(booking.requestedBy),
          coachEmail: booking.requestedBy.email,
          note: booking.note,
        },
        decision === "APPROVE" ? "APPROVED" : "DECLINED",
        reason,
        decidedByName,
      );
    } catch (error) {
      console.error(`[approvals] could not email the coach for ${bookingId}:`, error);
    }
  }

  revalidatePath("/calendar");
  revalidatePath("/approvals");
  revalidatePath("/requests");

  return {
    ok: true,
    code: "ok",
    message:
      decision === "APPROVE"
        ? `Approved — ${booking.team?.name ?? "the team"} has the block.`
        : `Declined. ${booking.team?.name ?? "The team"} has been told.`,
  };
}

export async function approveRequest(formData: FormData): Promise<void> {
  const user = await getSessionUser();
  if (!user) redirect("/signin");
  if (!canDecideRequests(user.role)) back("You can't decide requests.", "error");

  const result = await decide(
    String(formData.get("bookingId") ?? ""),
    "APPROVE",
    user.id,
    displayName(user),
    "APP",
    null,
  );
  back(result.message, result.ok ? "ok" : "error");
}

export async function declineRequest(formData: FormData): Promise<void> {
  const user = await getSessionUser();
  if (!user) redirect("/signin");
  if (!canDecideRequests(user.role)) back("You can't decide requests.", "error");

  const reason = String(formData.get("reason") ?? "").trim();
  if (reason.length < 3) {
    back("Give the coach a short reason — they'll read it.", "error");
  }

  const result = await decide(
    String(formData.get("bookingId") ?? ""),
    "DECLINE",
    user.id,
    displayName(user),
    "APP",
    reason,
  );
  back(result.message, result.ok ? "ok" : "error");
}

/**
 * An approver muting or unmuting their own request emails, without needing a
 * super admin. The same rule applies as on the rules screen: somebody has to
 * stay listening, or requests pile up with nobody told.
 */
export async function setMyNotifications(formData: FormData): Promise<void> {
  const user = await getSessionUser();
  if (!user) redirect("/signin");
  if (!canDecideRequests(user.role)) back("You can't decide requests.", "error");

  const next = formData.get("notify") === "on";
  const deciders = await db.user.findMany({
    where: { role: { in: ["APPROVER", "SUPER_ADMIN"] }, status: { in: ["ACTIVE", "INVITED"] } },
    select: { id: true, notifyOnRequests: true },
  });
  const nextNotifiedIds = deciders
    .filter((d) => (d.id === user.id ? next : d.notifyOnRequests))
    .map((d) => d.id);

  if (wouldSilenceAllApprovers({ deciderIds: deciders.map((d) => d.id), nextNotifiedIds })) {
    back(
      "You're the only one being emailed about new requests. Ask a super admin to turn " +
        "somebody else on first, or they would arrive with nobody told.",
      "error",
    );
  }

  await db.user.update({ where: { id: user.id }, data: { notifyOnRequests: next } });
  revalidatePath("/approvals");
  back(
    next ? "You'll be emailed about new requests." : "You won't be emailed about new requests.",
    "ok",
  );
}
