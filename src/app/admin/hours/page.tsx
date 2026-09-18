import { db } from "@/lib/db";
import { loadHours } from "@/lib/facility";
import { FACILITY_TIMEZONE } from "@/lib/env";
import { requireSuperAdmin } from "@/lib/guards";
import { AdminTabs } from "@/components/AdminTabs";
import { Flash } from "@/components/Flash";
import { formatDateLong, formatTimeOfDay, todayInZone, WEEKDAYS } from "@/lib/schedule";
import { addClosure, removeClosure, saveHours } from "./actions";

export const dynamic = "force-dynamic";

/** 6 AM to 11 PM, the window the bar is drawn against. */
const BAR_START = 6 * 60;
const BAR_END = 23 * 60;
const BAR_WIDTH = 420;

function barGeometry(openMinutes: number, closeMinutes: number) {
  const span = BAR_END - BAR_START;
  const left = ((openMinutes - BAR_START) / span) * BAR_WIDTH;
  const width = ((closeMinutes - openMinutes) / span) * BAR_WIDTH;
  return { left: Math.max(0, left), width: Math.max(0, Math.min(width, BAR_WIDTH - left)) };
}

const TIME_OPTIONS = Array.from({ length: ((BAR_END - BAR_START) / 30) + 1 }, (_, i) =>
  BAR_START + i * 30,
);

export default async function HoursPage({
  searchParams,
}: {
  searchParams: Promise<{ msg?: string; kind?: string }>;
}) {
  await requireSuperAdmin();
  const { msg, kind } = await searchParams;

  const today = todayInZone(FACILITY_TIMEZONE);
  const [hours, closureRows, past] = await Promise.all([
    loadHours(),
    db.closure.findMany({ where: { endDate: { gte: today } }, orderBy: { startDate: "asc" } }),
    db.closure.count({ where: { endDate: { lt: today } } }),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <AdminTabs active="hours" />
      <Flash message={msg} kind={kind} />

      <form action={saveHours} className="card p-6 flex flex-col gap-3">
        <div className="flex items-end gap-4">
          <div className="grow">
            <h2 className="display text-2xl mb-1">Weekly hours</h2>
            <p className="text-[13px] text-muted">
              When coaches can <em>request</em> time. Assigned schedules may sit outside these
              hours — the club opens the building when it needs to. Changing them leaves bookings
              that already exist alone.
            </p>
          </div>
          <button type="submit" className="btn btn-primary shrink-0">
            Save hours
          </button>
        </div>

        <div className="hidden xl:flex justify-end">
          <div style={{ width: BAR_WIDTH }} className="flex">
            {["6 AM", "9 AM", "12 PM", "3 PM", "6 PM", "9 PM"].map((label) => (
              <span
                key={label}
                style={{ width: BAR_WIDTH / 6 }}
                className="font-[family-name:var(--font-mono)] text-[10.5px] text-faint"
              >
                {label}
              </span>
            ))}
          </div>
        </div>

        {hours.map((day) => {
          const bar = barGeometry(day.openMinutes, day.closeMinutes);
          return (
            <div
              key={day.weekday}
              data-day={day.weekday}
              className="flex items-center h-14 border-t border-line-faint"
            >
              <div className="w-[118px] font-[family-name:var(--font-display)] text-[21px] font-bold uppercase tracking-[0.02em]">
                {WEEKDAYS[day.weekday]}
              </div>

              <label className="w-[124px] flex items-center gap-2.5 text-[13px] text-ink-2">
                <input
                  type="checkbox"
                  name={`open-${day.weekday}`}
                  defaultChecked={day.isOpen}
                  className="w-4 h-4 accent-[#AD0303]"
                />
                Takes requests
              </label>

              <div className="flex items-center gap-2.5">
                <select
                  name={`from-${day.weekday}`}
                  defaultValue={formatTimeOfDay(day.openMinutes)}
                  aria-label={`${WEEKDAYS[day.weekday]} opening time`}
                  className="select w-[118px] h-9 px-2.5 text-[13.5px]"
                >
                  {TIME_OPTIONS.map((m) => (
                    <option key={m}>{formatTimeOfDay(m)}</option>
                  ))}
                </select>
                <span className="text-[13px] text-faint">to</span>
                <select
                  name={`to-${day.weekday}`}
                  defaultValue={formatTimeOfDay(day.closeMinutes)}
                  aria-label={`${WEEKDAYS[day.weekday]} closing time`}
                  className="select w-[118px] h-9 px-2.5 text-[13.5px]"
                >
                  {TIME_OPTIONS.map((m) => (
                    <option key={m}>{formatTimeOfDay(m)}</option>
                  ))}
                </select>
              </div>

              <div className="grow" />

              <div
                className="hidden xl:block relative h-[26px] rounded-[3px] bg-paper border border-[#E4E4E4] overflow-hidden shrink-0"
                style={{ width: BAR_WIDTH }}
                aria-hidden="true"
              >
                <div
                  className="absolute inset-0"
                  style={{
                    backgroundImage: `repeating-linear-gradient(to right,#DDDDDD 0 1px,transparent 1px ${BAR_WIDTH / 6}px)`,
                  }}
                />
                {day.isOpen && (
                  <div
                    className="absolute top-1 h-4 rounded-[2px] bg-crimson"
                    style={{ left: bar.left, width: bar.width }}
                  />
                )}
              </div>
            </div>
          );
        })}
      </form>

      <section className="card p-6">
        <h2 className="display text-2xl mb-1">Closures</h2>
        <p className="text-[13px] text-muted mb-4">
          Dates the facility is shut whatever the weekly hours say — holidays, tournaments,
          maintenance. Requests are refused on these days.
        </p>

        <div className="flex flex-wrap gap-2.5 mb-4">
          {closureRows.length === 0 && (
            <p className="text-[13px] text-faint m-0">Nothing coming up.</p>
          )}
          {closureRows.map((closure) => (
            <span
              key={closure.id}
              data-closure={closure.id}
              className="inline-flex items-center gap-2.5 h-9 pl-3.5 pr-2 rounded-[3px] border border-line-soft bg-paper text-[13.5px]"
            >
              {formatDateLong(closure.startDate)}
              {closure.endDate !== closure.startDate && ` – ${formatDateLong(closure.endDate)}`}
              {closure.reason && <span className="text-muted">· {closure.reason}</span>}
              <form action={removeClosure}>
                <input type="hidden" name="closureId" value={closure.id} />
                <button
                  type="submit"
                  aria-label={`Remove the ${closure.startDate} closure`}
                  className="w-5 h-5 flex items-center justify-center cursor-pointer text-faint"
                >
                  ✕
                </button>
              </form>
            </span>
          ))}
          {past > 0 && (
            <span className="inline-flex items-center h-9 text-[12.5px] text-faint">
              {past} past {past === 1 ? "closure" : "closures"} hidden
            </span>
          )}
        </div>

        <form action={addClosure} className="flex items-end gap-2.5 flex-wrap">
          <div>
            <label htmlFor="startDate" className="field-label">
              First day
            </label>
            <input
              id="startDate"
              name="startDate"
              type="date"
              required
              defaultValue={today}
              className="input w-[170px] h-[42px] text-[13.5px]"
            />
          </div>
          <div>
            <label htmlFor="endDate" className="field-label">
              Last day <span className="font-normal normal-case tracking-normal text-faint">(optional)</span>
            </label>
            <input
              id="endDate"
              name="endDate"
              type="date"
              className="input w-[170px] h-[42px] text-[13.5px]"
            />
          </div>
          <div className="grow min-w-[200px]">
            <label htmlFor="reason" className="field-label">
              Reason
            </label>
            <input
              id="reason"
              name="reason"
              maxLength={80}
              placeholder="e.g. Thanksgiving"
              className="input h-[42px] text-[13.5px]"
            />
          </div>
          <button type="submit" className="btn btn-secondary h-[42px]">
            Add closure
          </button>
        </form>
      </section>
    </div>
  );
}
