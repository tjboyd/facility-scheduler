import { db } from "@/lib/db";
import { FACILITY_TIMEZONE } from "@/lib/env";
import { requireSuperAdmin } from "@/lib/guards";
import { AdminTabs } from "@/components/AdminTabs";
import { Flash } from "@/components/Flash";
import {
  addDays,
  formatDateShort,
  formatRange,
  todayInZone,
  WEEKDAYS,
  type Weekday,
} from "@/lib/schedule";
import { createSeries, endSeries } from "./actions";

export const dynamic = "force-dynamic";

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ msg?: string; kind?: string }>;
}) {
  await requireSuperAdmin();
  const { msg, kind } = await searchParams;

  const today = todayInZone(FACILITY_TIMEZONE);

  const [teams, series] = await Promise.all([
    db.team.findMany({ where: { archivedAt: null }, orderBy: { name: "asc" } }),
    db.assignedSeries.findMany({
      include: {
        team: true,
        _count: { select: { occurrences: true } },
      },
      orderBy: [{ weekday: "asc" }, { startMinutes: "asc" }],
    }),
  ]);

  const upcomingCounts = await db.booking.groupBy({
    by: ["seriesId"],
    where: { seriesId: { not: null }, date: { gte: today }, status: "HELD" },
    _count: { _all: true },
  });
  const upcomingBySeries = new Map(
    upcomingCounts.map((row) => [row.seriesId, row._count._all]),
  );

  const running = series.filter((s) => s.endsOn >= today);
  const finished = series.filter((s) => s.endsOn < today);

  return (
    <div className="flex flex-col gap-4">
      <AdminTabs active="schedule" />
      <Flash message={msg} kind={kind} />

      <div className="flex gap-[18px] items-start flex-wrap xl:flex-nowrap">
        <section className="grow min-w-[560px] flex flex-col gap-3">
          <div className="flex items-baseline gap-3">
            <h2 className="display text-2xl">Assigned schedules</h2>
            <p className="text-[13px] text-muted">
              {running.length} running · time assigned this way needs no approval
            </p>
          </div>

          <div className="card overflow-hidden">
            <div className="thead flex items-center h-10 px-[18px]">
              <div className="w-[150px]">Team</div>
              <div className="w-[120px]">Day</div>
              <div className="w-[170px]">Time</div>
              <div className="w-[190px]">Runs</div>
              <div className="grow">Dates</div>
              <div className="w-[110px] text-right">Action</div>
            </div>

            {running.length === 0 && finished.length === 0 && (
              <p className="px-[18px] py-6 text-sm text-muted">
                No assigned schedules yet. Give a team a repeating block on the right.
              </p>
            )}

            {[...running, ...finished].map((row) => {
              const ended = row.endsOn < today;
              const upcoming = upcomingBySeries.get(row.id) ?? 0;
              return (
                <div
                  key={row.id}
                  data-series={row.id}
                  className={`flex items-center min-h-[58px] px-[18px] border-b border-line-faint last:border-b-0 ${
                    ended ? "bg-paper/60" : ""
                  }`}
                >
                  <div
                    className={`w-[150px] pr-3 font-[family-name:var(--font-display)] text-[19px] font-bold uppercase ${
                      ended ? "text-disabled" : ""
                    }`}
                  >
                    {row.team.name}
                  </div>
                  <div className="w-[120px] pr-3 text-[13.5px]">
                    {WEEKDAYS[row.weekday as Weekday]}s
                  </div>
                  <div className="w-[170px] pr-3 font-[family-name:var(--font-mono)] text-[12.5px]">
                    {formatRange(row.startMinutes, row.endMinutes)}
                  </div>
                  <div className="w-[190px] pr-3 text-[13px] text-muted">
                    {formatDateShort(row.startsOn)} – {formatDateShort(row.endsOn)}
                  </div>
                  <div className="grow pr-3 text-[13px]">
                    {ended ? (
                      <span className="text-disabled">Ended</span>
                    ) : (
                      <>
                        <span className="font-semibold">{upcoming}</span> upcoming
                        <span className="text-faint"> of {row._count.occurrences}</span>
                      </>
                    )}
                  </div>
                  <div className="w-[110px] text-right">
                    {!ended && (
                      <form action={endSeries}>
                        <input type="hidden" name="seriesId" value={row.id} />
                        <button
                          type="submit"
                          data-end={row.id}
                          className="btn btn-outline-dark btn-sm"
                        >
                          End
                        </button>
                      </form>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <p className="text-[12.5px] leading-snug text-muted">
            Ending a schedule removes its upcoming dates but leaves past ones, anything a team has
            released, and anything another team has picked up — those are somebody else&rsquo;s
            plans by then.
          </p>
        </section>

        <aside className="w-[340px] shrink-0">
          <section className="card p-5 flex flex-col gap-3.5">
            <div>
              <h2 className="display text-2xl">Assign a schedule</h2>
              <p className="text-[12.5px] leading-snug text-muted mt-0.5">
                A repeating block for one team. Every date is written out, so a team can release any
                one of them.
              </p>
            </div>

            <form action={createSeries} className="flex flex-col gap-3.5">
              <div>
                <label htmlFor="teamId" className="field-label">
                  Team
                </label>
                <select id="teamId" name="teamId" required className="select h-[42px] text-[13.5px]">
                  {teams.map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="weekday" className="field-label">
                  Day
                </label>
                <select id="weekday" name="weekday" defaultValue="6" className="select h-[42px] text-[13.5px]">
                  {WEEKDAYS.map((name, index) => (
                    <option key={name} value={index}>
                      {name}s
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex gap-2.5">
                <div className="grow">
                  <label htmlFor="startTime" className="field-label">
                    From
                  </label>
                  <input
                    id="startTime"
                    name="startTime"
                    required
                    defaultValue="8:00 AM"
                    className="input h-[42px] text-[13.5px]"
                  />
                </div>
                <div className="grow">
                  <label htmlFor="endTime" className="field-label">
                    To
                  </label>
                  <input
                    id="endTime"
                    name="endTime"
                    required
                    defaultValue="9:30 AM"
                    className="input h-[42px] text-[13.5px]"
                  />
                </div>
              </div>

              <div className="flex gap-2.5">
                <div className="grow">
                  <label htmlFor="startsOn" className="field-label">
                    Starting
                  </label>
                  <input
                    id="startsOn"
                    name="startsOn"
                    type="date"
                    required
                    defaultValue={today}
                    className="input h-[42px] text-[13.5px]"
                  />
                </div>
                <div className="grow">
                  <label htmlFor="endsOn" className="field-label">
                    Through
                  </label>
                  <input
                    id="endsOn"
                    name="endsOn"
                    type="date"
                    required
                    defaultValue={addDays(today, 180)}
                    className="input h-[42px] text-[13.5px]"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="note" className="field-label">
                  Note <span className="font-normal normal-case tracking-normal text-faint">(optional)</span>
                </label>
                <input
                  id="note"
                  name="note"
                  maxLength={120}
                  placeholder="e.g. winter skills block"
                  className="input h-[42px] text-[13.5px]"
                />
              </div>

              <button type="submit" className="btn btn-primary h-[46px] text-[18px]">
                Assign the schedule
              </button>

              <p className="text-xs leading-snug text-faint">
                Dates that clash with something already booked are skipped and named, rather than
                failing the whole run. Assigned time isn&rsquo;t held to the 1.5-hour request cap.
              </p>
            </form>
          </section>
        </aside>
      </div>
    </div>
  );
}
