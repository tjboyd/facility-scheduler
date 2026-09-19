import Link from "next/link";
import { redirect } from "next/navigation";
import { FACILITY_TIMEZONE } from "@/lib/env";
import { requireUser } from "@/lib/guards";
import { AppHeader, MobileNav } from "@/components/AppHeader";
import { Flash } from "@/components/Flash";
import { requestContextFor } from "@/lib/requests";
import { closureFor, describeLength, lengthChoices, OCCUPYING, openingsFor } from "@/lib/rules";
import { db } from "@/lib/db";
import {
  addDays,
  formatDateLong,
  formatRange,
  formatTimeOfDay,
  isDateString,
  startOfWeek,
  todayInZone,
  WEEKDAYS,
  weekdayOf,
} from "@/lib/schedule";
import { submitRequest } from "./actions";

export const dynamic = "force-dynamic";

export default async function RequestPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; start?: string; len?: string; msg?: string; kind?: string }>;
}) {
  const user = await requireUser();
  const { date: dateParam, start, len, msg, kind } = await searchParams;

  if (!user.team) {
    return (
      <div className="min-h-dvh flex flex-col">
        <AppHeader user={user} active="calendar" />
        <main className="grow p-4 pb-24 md:p-7 md:pb-7">
          <h1 className="display text-[34px]">Request time</h1>
          <div className="card p-6 mt-4 max-w-[560px]">
            <p className="text-[14.5px] text-muted m-0">
              You aren&rsquo;t on a team, so you can&rsquo;t hold facility time. A club admin can
              put you on one.
            </p>
          </div>
        </main>
      <MobileNav user={user} active="calendar" />
      </div>
    );
  }

  const today = todayInZone(FACILITY_TIMEZONE);
  const date = dateParam && isDateString(dateParam) ? dateParam : today;
  const context = await requestContextFor(date, user.team.id);
  const { settings, hours, closures } = context;

  const closure = closureFor(date, closures);
  const openings = closure ? [] : openingsFor(hours, context.taken, settings);
  const selectedStart = start ? Number(start) : (openings[0]?.startMinutes ?? null);
  const selected = openings.find((o) => o.startMinutes === selectedStart) ?? openings[0];
  const lengths = selected ? lengthChoices(settings, selected.maxMinutes) : [];
  // Start time and length are both links rather than form controls, so the
  // server always knows exactly what is selected — which is what lets the
  // summary below state a real end time, and what makes the whole screen work
  // with JavaScript switched off. Longest that fits is the default.
  const wanted = len ? Number(len) : null;
  const length = (wanted && lengths.includes(wanted) ? wanted : lengths.at(-1)) ?? null;

  // What stops the chosen start running the full length, so the screen can say
  // so rather than silently offering less. The mockup asked for this and it is
  // the difference between "why can't I have 90 minutes" and knowing.
  const blocker =
    selected && selected.maxMinutes < settings.maxRequestMinutes
      ? await db.booking.findFirst({
          where: {
            date,
            status: { in: [...OCCUPYING] },
            startMinutes: { gte: selected.startMinutes },
          },
          orderBy: { startMinutes: "asc" },
          select: { startMinutes: true, team: { select: { name: true } } },
        })
      : null;

  const horizonEnd = addDays(startOfWeek(today), settings.weeksAhead * 7 + 6);

  return (
    <div className="min-h-dvh flex flex-col">
      <AppHeader user={user} active="calendar" />

      <main className="grow p-4 pb-24 md:p-7 md:pb-7 flex flex-col gap-4 max-w-[760px]">
        <Link href="/calendar" className="text-[13px] font-semibold no-underline">
          ‹ Back to the calendar
        </Link>

        <div>
          <div className="eyebrow">{user.team.name}</div>
          <h1 className="display text-[34px] mt-1">Request facility time</h1>
        </div>

        <Flash message={msg} kind={kind} />

        <form action={submitRequest} className="card p-6 flex flex-col gap-5">
          <input type="hidden" name="date" value={date} />

          <div className="flex gap-4 flex-wrap">
            <div className="grow min-w-[220px]">
              <div className="flex items-baseline gap-2.5">
                <span className="field-label">Date</span>
                {/* The native picker shows 09/23/2026 and nothing else, so the
                    day it lands on is spelled out beside it. */}
                <span className="text-[11.5px] text-faint mb-2">{WEEKDAYS[weekdayOf(date)]}</span>
              </div>
              <div className="flex gap-2">
                <input
                  type="date"
                  name="date"
                  form="pick"
                  defaultValue={date}
                  min={today}
                  max={horizonEnd}
                  className="input h-[44px] text-[14.5px]"
                  aria-label="Date"
                />
                <button type="submit" form="pick" className="btn btn-secondary h-[44px] shrink-0">
                  Show
                </button>
              </div>
              <p className="text-xs text-faint mt-1.5">
                Up to {settings.weeksAhead} weeks ahead · at least {settings.minNoticeHours} hours&rsquo;
                notice
              </p>
            </div>
            <div className="grow min-w-[220px]">
              <span className="field-label">Team</span>
              <div className="h-[44px] flex items-center gap-2.5 px-3.5 rounded-[4px] border border-line-soft bg-paper">
                <span className="w-2 h-2 bg-crimson" aria-hidden />
                <span className="font-[family-name:var(--font-display)] text-[20px] font-bold uppercase leading-none">
                  {user.team.name}
                </span>
                <span className="ml-auto text-[11.5px] text-faint">set by admin</span>
              </div>
            </div>
          </div>

          <div>
            <div className="flex items-baseline gap-2.5 mb-2">
              <span className="field-label mb-0">Start time</span>
              <span className="text-[11.5px] text-faint">
                {closure
                  ? `Closed${closure.reason ? ` — ${closure.reason}` : ""}`
                  : hours.isOpen
                    ? `${WEEKDAYS[weekdayOf(date)]}s take requests ${formatRange(hours.openMinutes, hours.closeMinutes)}`
                    : "Not open to requests that day"}
              </span>
            </div>

            {openings.length === 0 ? (
              <p className="text-[13.5px] text-muted m-0">
                Nothing free that day. Try another date.
              </p>
            ) : (
              <div className="grid grid-cols-4 gap-2">
                {openings.map((opening) => {
                  const isSelected = opening.startMinutes === selected?.startMinutes;
                  return (
                    <Link
                      key={opening.startMinutes}
                      href={{
                        pathname: "/request",
                        query: { date, start: opening.startMinutes, ...(len ? { len } : {}) },
                      }}
                      data-start={opening.startMinutes}
                      aria-current={isSelected}
                      className={`h-10 flex items-center justify-center rounded-[4px] border no-underline font-[family-name:var(--font-mono)] text-[13px] ${
                        isSelected
                          ? "bg-crimson border-crimson text-white"
                          : "bg-white border-line text-ink"
                      }`}
                    >
                      {formatTimeOfDay(opening.startMinutes)}
                    </Link>
                  );
                })}
              </div>
            )}
          </div>

          {selected && (
            <>
              <input type="hidden" name="startMinutes" value={selected.startMinutes} />
              <input type="hidden" name="lengthMinutes" value={length ?? ""} />
              <div>
                <span className="field-label">Length</span>
                <div className="grid grid-cols-3 gap-2">
                  {lengths.map((minutes) => (
                    <Link
                      key={minutes}
                      href={{
                        pathname: "/request",
                        query: { date, start: selected.startMinutes, len: minutes },
                      }}
                      data-length={minutes}
                      aria-current={minutes === length}
                      className={`h-11 flex items-center justify-center rounded-[4px] border no-underline font-[family-name:var(--font-display)] text-[17px] font-semibold uppercase tracking-[0.05em] ${
                        minutes === length
                          ? "bg-crimson border-crimson text-white"
                          : "bg-white border-line text-ink"
                      }`}
                    >
                      {describeLength(minutes)}
                    </Link>
                  ))}
                </div>
                <p className="text-xs text-faint mt-1.5">
                  {selected.maxMinutes < settings.maxRequestMinutes ? (
                    <>
                      Only {describeLength(selected.maxMinutes)} is free from this start
                      {blocker
                        ? ` — ${blocker.team?.name ?? "another team"} has the floor at ${formatTimeOfDay(blocker.startMinutes)}.`
                        : blocker === null && hours.isOpen
                          ? ` — the facility closes at ${formatTimeOfDay(hours.closeMinutes)}.`
                          : "."}
                    </>
                  ) : (
                    `${describeLength(settings.maxRequestMinutes)} is the most you can request at once.`
                  )}
                </p>
              </div>

              <div data-summary className="rounded-[4px] bg-ink px-4 py-3.5">
                <div className="font-[family-name:var(--font-display)] text-[20px] font-bold uppercase text-white leading-none">
                  {formatDateLong(date)} ·{" "}
                  {length
                    ? formatRange(selected.startMinutes, selected.startMinutes + length)
                    : `from ${formatTimeOfDay(selected.startMinutes)}`}
                </div>
                <div className="text-[12.5px] text-[#B8B8B8] mt-1.5">
                  The whole block is yours — no other team can book it while it waits on a
                  decision.
                </div>
              </div>

              <div>
                <label htmlFor="note" className="field-label">
                  Note for the approver{" "}
                  <span className="font-normal normal-case tracking-normal text-faint">(optional)</span>
                </label>
                <textarea
                  id="note"
                  name="note"
                  rows={2}
                  maxLength={300}
                  placeholder="Makeup practice — our field time was rained out."
                  className="textarea text-[14px]"
                />
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center gap-3 pt-4 border-t border-line-faint">
                <p className="m-0 grow text-[12.5px] leading-snug text-muted">
                  Goes to the approvers. The slot shows as pending until it&rsquo;s decided.
                </p>
                <div className="flex gap-2.5">
                  <Link
                    href="/calendar"
                    className="btn btn-secondary no-underline grow sm:grow-0 justify-center h-11 sm:h-auto"
                  >
                    Cancel
                  </Link>
                  <button type="submit" className="btn btn-primary grow sm:grow-0 justify-center h-11 sm:h-auto">
                    Send request
                  </button>
                </div>
              </div>
            </>
          )}
        </form>

        {/*
          Changing the date is a plain GET, so the picker works without JS. The
          field and its button live up in the card and reach this form by id,
          because a form cannot be nested inside the one that submits the
          request.
        */}
        <form id="pick" action="/request" className="hidden" />
      </main>
      <MobileNav user={user} active="calendar" />
    </div>
  );
}
