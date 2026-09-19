import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { FACILITY_TIMEZONE } from "@/lib/env";
import { requireUser } from "@/lib/guards";
import { canDecideRequests, displayName } from "@/lib/domain";
import { AppHeader } from "@/components/AppHeader";
import { Flash } from "@/components/Flash";
import { describeLength } from "@/lib/rules";
import { formatDateLong, formatRange, overlaps, todayInZone } from "@/lib/schedule";
import { approveRequest, declineRequest, setMyNotifications } from "./actions";

export const dynamic = "force-dynamic";

export default async function ApprovalsPage({
  searchParams,
}: {
  searchParams: Promise<{ msg?: string; kind?: string }>;
}) {
  const user = await requireUser();
  if (!canDecideRequests(user.role)) redirect("/calendar");
  const { msg, kind } = await searchParams;

  const today = todayInZone(FACILITY_TIMEZONE);

  const pending = await db.booking.findMany({
    where: { status: "PENDING", date: { gte: today } },
    include: { team: true, requestedBy: true },
    orderBy: [{ createdAt: "asc" }],
  });

  const me = await db.user.findUnique({
    where: { id: user.id },
    select: { notifyOnRequests: true },
  });

  const decided = await db.booking.count({
    where: { origin: "REQUEST", status: { in: ["HELD", "DECLINED"] } },
  });

  // What else is on those days, so an approver can see the context.
  const dates = [...new Set(pending.map((p) => p.date))];
  const sameDay = dates.length
    ? await db.booking.findMany({
        where: { date: { in: dates }, status: { in: ["PENDING", "HELD"] } },
        include: { team: true },
      })
    : [];

  return (
    <div className="min-h-dvh flex flex-col">
      <AppHeader user={user} active="approvals" />

      <main className="grow p-7 flex flex-col gap-4 max-w-[900px]">
        <div>
          <div className="eyebrow">Facility office</div>
          <h1 className="display text-[34px] mt-1">Approvals</h1>
          <p className="text-sm text-muted mt-1">
            {pending.length === 0
              ? "Nothing waiting."
              : `${pending.length} ${pending.length === 1 ? "request" : "requests"} waiting`}
            {decided > 0 && ` · ${decided} decided so far`}
          </p>
        </div>

        <Flash message={msg} kind={kind} />

        {pending.length === 0 && (
          <div className="card p-6">
            <p className="text-[14.5px] text-muted m-0">
              No requests waiting on a decision. Approvers are emailed when one comes in, and can
              approve straight from that email.
            </p>
          </div>
        )}

        {pending.map((request) => {
          const clashes = sameDay.filter(
            (other) => other.id !== request.id && other.date === request.date && overlaps(other, request),
          );
          const alsoThatDay = sameDay.filter(
            (other) => other.id !== request.id && other.date === request.date && !overlaps(other, request),
          );

          return (
            <section key={request.id} data-pending={request.id} className="card overflow-hidden">
              <div className="p-5 border-b border-line-faint flex items-start gap-3">
                <div className="grow">
                  <h2 className="display text-[32px]">{request.team?.name ?? "—"}</h2>
                  <p className="text-[17px] font-semibold mt-1.5">
                    {formatDateLong(request.date)}, {request.date.slice(0, 4)} ·{" "}
                    <span className="font-[family-name:var(--font-mono)] text-[15px]">
                      {formatRange(request.startMinutes, request.endMinutes)}
                    </span>
                  </p>
                  <p className="text-[13px] text-muted mt-1">
                    {describeLength(request.endMinutes - request.startMinutes)} ·{" "}
                    {request.requestedBy ? displayName(request.requestedBy) : "unknown coach"}
                    {request.requestedBy && ` · ${request.requestedBy.email}`}
                  </p>
                </div>
                <span className="chip chip-outline">Pending</span>
              </div>

              {request.note && (
                <div className="px-5 py-4 border-b border-line-faint">
                  <div className="font-[family-name:var(--font-display)] text-xs font-semibold tracking-[0.14em] uppercase text-muted mb-1.5">
                    Note from the coach
                  </div>
                  <p className="m-0 text-[14px] leading-relaxed">“{request.note}”</p>
                </div>
              )}

              <div className="px-5 py-4 border-b border-line-faint">
                {clashes.length > 0 ? (
                  <p className="m-0 rounded-[4px] border border-crimson-line bg-crimson-tint px-3.5 py-3 text-[13.5px] text-crimson-deep">
                    Clashes with {clashes.map((c) => c.team?.name ?? "another booking").join(", ")} —
                    approving this is blocked until that changes.
                  </p>
                ) : (
                  <p className="m-0 rounded-[4px] bg-ink px-3.5 py-3 font-[family-name:var(--font-display)] text-[16px] font-semibold uppercase tracking-[0.04em] text-white">
                    No clashes — nothing else is booked in this block
                  </p>
                )}
                {alsoThatDay.length > 0 && (
                  <p className="text-[12.5px] text-muted mt-2.5 mb-0">
                    Also that day:{" "}
                    {alsoThatDay
                      .map(
                        (o) =>
                          `${o.team?.name ?? "—"} ${formatRange(o.startMinutes, o.endMinutes)}`,
                      )
                      .join(" · ")}
                  </p>
                )}
              </div>

              <div className="px-5 py-4 bg-paper flex items-end gap-3 flex-wrap">
                <form action={declineRequest} className="grow min-w-[280px] flex items-end gap-2.5">
                  <input type="hidden" name="bookingId" value={request.id} />
                  <div className="grow">
                    <label
                      htmlFor={`reason-${request.id}`}
                      className="field-label"
                    >
                      Reason, if you&rsquo;re declining
                    </label>
                    <input
                      id={`reason-${request.id}`}
                      name="reason"
                      maxLength={200}
                      placeholder="e.g. cage nets being replaced that evening"
                      className="input h-[42px] text-[13.5px]"
                    />
                  </div>
                  <button
                    type="submit"
                    data-decline={request.id}
                    className="btn btn-outline-dark shrink-0"
                  >
                    Decline
                  </button>
                </form>

                <form action={approveRequest}>
                  <input type="hidden" name="bookingId" value={request.id} />
                  <button
                    type="submit"
                    data-approve={request.id}
                    disabled={clashes.length > 0}
                    className="btn btn-primary"
                  >
                    Approve
                  </button>
                </form>
              </div>
            </section>
          );
        })}

        <form
          action={setMyNotifications}
          className="card flex flex-wrap items-center gap-x-3 gap-y-2 p-4"
        >
          <div className="grow min-w-[240px]">
            <div className="text-[13.5px]">Email me when a request comes in</div>
            <div className="text-xs text-faint mt-0.5">
              {me?.notifyOnRequests
                ? "On. Each request also carries a link that approves it in one click."
                : "Off. Requests still appear here — you just aren't emailed about them."}
            </div>
          </div>
          <input
            type="hidden"
            name="notify"
            value={me?.notifyOnRequests ? "off" : "on"}
          />
          <button type="submit" data-notify-toggle className="btn btn-secondary btn-sm">
            {me?.notifyOnRequests ? "Turn off" : "Turn on"}
          </button>
        </form>

        <p className="text-[12.5px] text-muted">
          Approving from the email does exactly this. Whoever gets there first decides it — the
          other route then says so rather than deciding twice.{" "}
          <Link href="/calendar">See the calendar</Link>
        </p>
      </main>
    </div>
  );
}
