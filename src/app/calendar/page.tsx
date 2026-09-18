import Link from "next/link";
import { db } from "@/lib/db";
import { FACILITY_TIMEZONE } from "@/lib/env";
import { requireUser } from "@/lib/guards";
import { AppHeader } from "@/components/AppHeader";
import { Flash } from "@/components/Flash";
import {
  addDays,
  BLOCK_MINUTES,
  formatDateLong,
  formatDateShort,
  formatRange,
  formatWeekdayShort,
  formatTimeOfDay,
  isDateString,
  startOfWeek,
  todayInZone,
  weekDates,
} from "@/lib/schedule";

export const dynamic = "force-dynamic";

/**
 * How a block reads in the team's own list. Status comes first: a request
 * still waiting on an approver is pending whatever it would become.
 */
function statusLabel(booking: { status: string; origin: string }): string {
  if (booking.status === "PENDING") return "Pending";
  if (booking.origin === "PICKUP") return "Picked up";
  if (booking.origin === "REQUEST") return "Approved";
  return "Assigned";
}

const ROW_PX = 34;
/**
 * A block has to be at least this tall before the chips fit under the team
 * name and the time — 90 minutes, in practice. Below it the dashed border and
 * the stripes still say pending on their own, which is what the legend reads.
 */
const CHIP_MIN_PX = 70;
/** The window the grid shows unless a booking that week falls outside it. */
const DEFAULT_START = 8 * 60;
const DEFAULT_END = 21 * 60;

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string; msg?: string; kind?: string }>;
}) {
  const user = await requireUser();
  const { week, msg, kind } = await searchParams;

  const today = todayInZone(FACILITY_TIMEZONE);
  const sunday = startOfWeek(week && isDateString(week) ? week : today);
  const dates = weekDates(sunday);

  const bookings = await db.booking.findMany({
    where: { date: { in: dates }, status: { in: ["PENDING", "HELD", "RELEASED"] } },
    include: { team: true, releasedFromTeam: true },
    orderBy: [{ date: "asc" }, { startMinutes: "asc" }],
  });

  // Widen the window if anything that week sits outside the usual hours.
  const windowStart = Math.min(DEFAULT_START, ...bookings.map((b) => b.startMinutes));
  const windowEnd = Math.max(DEFAULT_END, ...bookings.map((b) => b.endMinutes));
  const rows = Math.max(1, (windowEnd - windowStart) / BLOCK_MINUTES);
  const gridHeight = rows * ROW_PX;

  const byDate = new Map(dates.map((d) => [d, [] as typeof bookings]));
  for (const booking of bookings) byDate.get(booking.date)?.push(booking);

  const mine = bookings.filter((b) => b.teamId && b.teamId === user.team?.id && b.date >= today);
  const available = bookings.filter((b) => b.status === "RELEASED" && b.date >= today);

  return (
    <div className="min-h-dvh flex flex-col">
      <AppHeader user={user} active="calendar" />

      <main className="grow p-7 flex flex-col gap-4">
        <Flash message={msg} kind={kind} />

        <div className="flex items-center gap-3.5 flex-wrap">
          <div className="flex items-center border border-line rounded-[4px] overflow-hidden bg-white">
            <Link
              href={{ pathname: "/calendar", query: { week: addDays(sunday, -7) } }}
              aria-label="Previous week"
              className="w-9 h-9 flex items-center justify-center no-underline text-ink"
            >
              ‹
            </Link>
            <span className="w-px h-5 bg-line-soft" />
            <Link
              href={{ pathname: "/calendar", query: { week: addDays(sunday, 7) } }}
              aria-label="Next week"
              className="w-9 h-9 flex items-center justify-center no-underline text-ink"
            >
              ›
            </Link>
          </div>

          <div>
            <div className="eyebrow">Facility calendar</div>
            <h1 className="display text-[25px] mt-1">
              {formatDateShort(sunday)} – {formatDateShort(dates[6]!)}
            </h1>
          </div>

          <Link href="/calendar" className="btn btn-secondary btn-sm no-underline">
            This week
          </Link>

          {user.team && (
            <Link href="/request" className="btn btn-primary btn-sm no-underline">
              Request time
            </Link>
          )}

          <div className="grow" />

          <div className="flex items-center gap-4 text-[12.5px] text-ink-2">
            <span className="inline-flex items-center gap-2">
              <span className="w-3.5 h-3.5 rounded-[2px] bg-crimson" /> Reserved
            </span>
            <span className="inline-flex items-center gap-2">
              <span
                className="w-3.5 h-3.5 rounded-[2px] border-[1.5px] border-dashed border-crimson"
                style={{
                  background:
                    "repeating-linear-gradient(135deg,#F7DADA 0 4px,#FFFFFF 4px 8px)",
                }}
              />
              Pending
            </span>
            <span className="inline-flex items-center gap-2">
              <span className="w-3.5 h-3.5 rounded-[2px] bg-white border-[1.5px] border-dashed border-ink" />
              Available
            </span>
          </div>
        </div>

        <div className="card overflow-hidden">
          <div className="flex h-11 bg-ink">
            <div className="w-[76px] shrink-0" />
            {dates.map((date) => (
              <div
                key={date}
                className={`flex-1 border-l border-[#2A2A2A] flex items-center justify-center gap-2 font-[family-name:var(--font-display)] text-[15px] font-semibold tracking-[0.1em] uppercase ${
                  date === today ? "text-white" : "text-[#A8A8A8]"
                }`}
              >
                <span>{formatWeekdayShort(date)}</span>
                <span className={date === today ? "text-[#C8C8C8]" : "text-[#7C7C7C]"}>
                  {formatDateShort(date)}
                </span>
              </div>
            ))}
          </div>

          <div className="flex" style={{ height: gridHeight }}>
            <div className="w-[76px] shrink-0 bg-paper">
              {Array.from({ length: rows }, (_, i) => {
                const minutes = windowStart + i * BLOCK_MINUTES;
                const onHour = minutes % 60 === 0;
                return (
                  <div
                    key={minutes}
                    style={{ height: ROW_PX }}
                    className="flex justify-end pr-2.5"
                  >
                    <span
                      className={`font-[family-name:var(--font-mono)] ${
                        onHour ? "text-[11px] font-medium text-ink-2" : "text-[10.5px] text-[#8A8A8A]"
                      }`}
                      style={{ transform: i === 0 ? undefined : "translateY(-6px)" }}
                    >
                      {onHour ? formatTimeOfDay(minutes) : formatTimeOfDay(minutes).slice(0, -3)}
                    </span>
                  </div>
                );
              })}
            </div>

            {dates.map((date) => (
              <div
                key={date}
                className="flex-1 relative border-l border-[#E8E8E8] bg-white"
                style={{
                  backgroundImage:
                    "repeating-linear-gradient(to bottom,#DCDCDC 0 1px,transparent 1px 68px),repeating-linear-gradient(to bottom,#F0F0F0 0 1px,transparent 1px 34px)",
                }}
              >
                {(byDate.get(date) ?? []).map((booking) => {
                  const top = ((booking.startMinutes - windowStart) / BLOCK_MINUTES) * ROW_PX;
                  const height =
                    ((booking.endMinutes - booking.startMinutes) / BLOCK_MINUTES) * ROW_PX - 4;
                  const released = booking.status === "RELEASED";
                  const pending = booking.status === "PENDING";
                  const isMine = Boolean(user.team) && booking.teamId === user.team?.id;
                  const chipClass = [
                    "inline-block rounded-[2px] px-1.5 py-0.5 border",
                    "font-[family-name:var(--font-display)] text-[10px] font-bold tracking-[0.1em]",
                    pending
                      ? "bg-white border-crimson-line text-crimson-deep"
                      : "border-white/55 text-white",
                  ].join(" ");

                  return (
                    <Link
                      key={booking.id}
                      href={`/booking/${booking.id}`}
                      data-block={booking.id}
                      data-status={booking.status}
                      style={{
                        top: top + 2,
                        height: Math.max(height, 26),
                        ...(pending
                          ? {
                              background:
                                "repeating-linear-gradient(135deg,#F7DADA 0 5px,#FFFFFF 5px 10px)",
                            }
                          : {}),
                      }}
                      className={`absolute left-[5px] right-[5px] rounded-[3px] px-2 py-1.5 no-underline overflow-hidden ${
                        pending
                          ? "border-[1.5px] border-dashed border-crimson"
                          : released
                            ? "bg-white border-[1.5px] border-dashed border-ink"
                            : "bg-crimson border border-crimson-deep"
                      }`}
                    >
                      <div
                        className={`font-[family-name:var(--font-display)] text-[15px] font-bold uppercase leading-none tracking-[0.03em] ${
                          pending ? "text-crimson-deep" : released ? "text-ink" : "text-white"
                        }`}
                      >
                        {released ? "Available" : (booking.team?.name ?? "—")}
                      </div>
                      <div
                        className={`font-[family-name:var(--font-mono)] text-[10.5px] mt-1 ${
                          pending ? "text-crimson" : released ? "text-muted" : "text-[#F2C9C9]"
                        }`}
                      >
                        {formatRange(booking.startMinutes, booking.endMinutes)}
                      </div>
                      {height > CHIP_MIN_PX && (pending || isMine) && (
                        // One row, so a pending block of your own doesn't stack
                        // two chips on top of each other. A reserved block is
                        // solid crimson and takes white chips; a pending one is
                        // pale and takes crimson ones.
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {pending && <span className={chipClass}>PENDING</span>}
                          {isMine && <span className={chipClass}>YOUR TEAM</span>}
                        </div>
                      )}
                      {released && booking.releasedFromTeam && height > CHIP_MIN_PX && (
                        <div className="mt-1 text-[10px] leading-tight text-muted">
                          released by {booking.releasedFromTeam.name}
                        </div>
                      )}
                    </Link>
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        <div className="flex gap-4 flex-wrap">
          <section className="card p-4 grow min-w-[320px]">
            <h2 className="display text-xl mb-2">
              {user.team ? `${user.team.name} this week` : "Your team"}
            </h2>
            {!user.team && (
              <p className="text-[13px] text-muted">
                You aren&rsquo;t on a team, so you can&rsquo;t hold facility time. A club admin can
                assign you one.
              </p>
            )}
            {user.team && mine.length === 0 && (
              <p className="text-[13px] text-muted">Nothing booked from today onwards this week.</p>
            )}
            <ul className="list-none p-0 m-0 flex flex-col gap-1.5">
              {mine.map((booking) => (
                <li key={booking.id}>
                  <Link
                    href={`/booking/${booking.id}`}
                    className="flex items-center gap-3 rounded-[3px] border border-line-soft bg-paper px-3 h-10 no-underline text-ink"
                  >
                    <span className="font-[family-name:var(--font-display)] text-[17px] uppercase grow">
                      {formatDateLong(booking.date)} · {formatRange(booking.startMinutes, booking.endMinutes)}
                    </span>
                    <span className={booking.status === "PENDING" ? "chip chip-crimson" : "chip chip-neutral"}>
                      {statusLabel(booking)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>

          <section className="card p-4 grow min-w-[320px]">
            <h2 className="display text-xl mb-2">Up for grabs</h2>
            {available.length === 0 && (
              <p className="text-[13px] text-muted">
                Nothing released this week. When a team gives back time they aren&rsquo;t using, it
                shows up here first come, first served.
              </p>
            )}
            <ul className="list-none p-0 m-0 flex flex-col gap-1.5">
              {available.map((booking) => (
                <li key={booking.id}>
                  <Link
                    href={`/booking/${booking.id}`}
                    className="flex items-center gap-3 rounded-[3px] border-[1.5px] border-dashed border-crimson px-3 h-10 no-underline text-ink"
                  >
                    <span className="font-[family-name:var(--font-display)] text-[17px] uppercase grow">
                      {formatDateLong(booking.date)} · {formatRange(booking.startMinutes, booking.endMinutes)}
                    </span>
                    {booking.releasedFromTeam && (
                      <span className="text-[12px] text-muted">
                        from {booking.releasedFromTeam.name}
                      </span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </main>
    </div>
  );
}
