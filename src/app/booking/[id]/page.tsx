import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { FACILITY_TIMEZONE } from "@/lib/env";
import { requireUser } from "@/lib/guards";
import { AppHeader } from "@/components/AppHeader";
import { Flash } from "@/components/Flash";
import {
  canClaim,
  canRelease,
  formatDateLong,
  formatRange,
  isPast,
  startOfWeek,
  todayInZone,
  WEEKDAYS,
  weekdayOf,
} from "@/lib/schedule";
import { claimBooking, releaseBooking } from "../actions";

export const dynamic = "force-dynamic";

export default async function BookingPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ msg?: string; kind?: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;
  const { msg, kind } = await searchParams;

  const booking = await db.booking.findUnique({
    where: { id },
    include: { team: true, releasedFromTeam: true, series: { include: { team: true } } },
  });
  if (!booking) notFound();

  const today = todayInZone(FACILITY_TIMEZONE);
  const past = isPast(booking, today);
  const view = {
    id: booking.id,
    date: booking.date,
    startMinutes: booking.startMinutes,
    endMinutes: booking.endMinutes,
    status: booking.status === "RELEASED" ? ("RELEASED" as const) : ("HELD" as const),
    origin: booking.origin === "PICKUP" ? ("PICKUP" as const) : ("ASSIGNED" as const),
    teamId: booking.teamId,
  };
  const actor = { role: user.role, teamId: user.team?.id ?? null };
  const mayRelease = !past && canRelease(view, actor);
  const mayClaim = !past && canClaim(view, actor);
  const released = booking.status === "RELEASED";

  return (
    <div className="min-h-dvh flex flex-col">
      <AppHeader user={user} active="calendar" />

      <main className="grow p-7 flex flex-col gap-4 max-w-[760px]">
        <Link
          href={{ pathname: "/calendar", query: { week: startOfWeek(booking.date) } }}
          className="text-[13px] font-semibold no-underline"
        >
          ‹ Back to the calendar
        </Link>

        <Flash message={msg} kind={kind} />

        <div className="card overflow-hidden">
          <div className="p-6 border-b border-line-faint">
            <div className="flex items-start gap-3">
              <div className="grow">
                <div className="eyebrow">
                  {released ? "Available — first come, first served" : "Facility time"}
                </div>
                <h1 className="display text-[40px] mt-1.5">
                  {released ? "Open block" : (booking.team?.name ?? "Unassigned")}
                </h1>
              </div>
              <span className={released ? "chip chip-outline" : "chip chip-crimson"}>
                {released ? "Released" : booking.origin === "PICKUP" ? "Picked up" : "Assigned"}
              </span>
            </div>

            <p className="text-[18px] font-semibold mt-3">
              {formatDateLong(booking.date)}, {booking.date.slice(0, 4)} ·{" "}
              <span className="font-[family-name:var(--font-mono)] text-[16px]">
                {formatRange(booking.startMinutes, booking.endMinutes)}
              </span>
            </p>
            <p className="text-[13px] text-muted mt-1">
              {(booking.endMinutes - booking.startMinutes) / 60} hours ·{" "}
              {(booking.endMinutes - booking.startMinutes) / 30} blocks of 30 minutes
              {past ? " · in the past" : ""}
            </p>
          </div>

          <dl className="p-6 grid grid-cols-2 gap-5 m-0">
            {booking.series && (
              <div>
                <dt className="font-[family-name:var(--font-display)] text-xs font-semibold tracking-[0.14em] uppercase text-muted mb-1">
                  From the schedule
                </dt>
                <dd className="m-0 text-[14px]">
                  {booking.series.team.name}, {WEEKDAYS[weekdayOf(booking.date)]}s
                  <div className="text-[13px] text-muted">
                    {booking.series.startsOn} to {booking.series.endsOn}
                  </div>
                </dd>
              </div>
            )}

            {booking.releasedFromTeam && (
              <div>
                <dt className="font-[family-name:var(--font-display)] text-xs font-semibold tracking-[0.14em] uppercase text-muted mb-1">
                  Released by
                </dt>
                <dd className="m-0 text-[14px]">
                  {booking.releasedFromTeam.name}
                  {booking.releasedAt && (
                    <div className="text-[13px] text-muted">
                      {booking.releasedAt.toISOString().slice(0, 10)}
                    </div>
                  )}
                </dd>
              </div>
            )}

            {booking.claimedAt && booking.team && (
              <div>
                <dt className="font-[family-name:var(--font-display)] text-xs font-semibold tracking-[0.14em] uppercase text-muted mb-1">
                  Picked up by
                </dt>
                <dd className="m-0 text-[14px]">{booking.team.name}</dd>
              </div>
            )}
          </dl>

          <div className="p-5 border-t border-line-faint bg-paper flex items-center gap-3">
            <p className="m-0 grow text-[12.5px] leading-snug text-muted">
              {released
                ? "Any team can take this. No approval — first come, first served."
                : mayRelease
                  ? "Releasing gives this block back to the club. Any team can then pick it up, and you can't take it back."
                  : "Only the team holding this block, or a club admin, can release it."}
            </p>

            {mayRelease && (
              <form action={releaseBooking}>
                <input type="hidden" name="bookingId" value={booking.id} />
                <button type="submit" data-release={booking.id} className="btn btn-outline-dark">
                  Release this block
                </button>
              </form>
            )}

            {mayClaim && (
              <form action={claimBooking}>
                <input type="hidden" name="bookingId" value={booking.id} />
                <button type="submit" data-claim={booking.id} className="btn btn-primary">
                  Pick it up
                </button>
              </form>
            )}

            {released && !mayClaim && !past && (
              <span className="text-[13px] text-muted">
                {user.team ? "" : "You need a team to pick up time."}
              </span>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
