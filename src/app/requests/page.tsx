import Link from "next/link";
import { db } from "@/lib/db";
import { FACILITY_TIMEZONE } from "@/lib/env";
import { requireUser } from "@/lib/guards";
import { AppHeader, MobileNav } from "@/components/AppHeader";
import { Flash } from "@/components/Flash";
import { describeLength } from "@/lib/rules";
import { formatDateLong, formatRange, todayInZone } from "@/lib/schedule";
import { withdrawRequest } from "../request/actions";

export const dynamic = "force-dynamic";

const STATUS: Record<string, { label: string; className: string }> = {
  PENDING: { label: "Pending", className: "chip chip-outline" },
  HELD: { label: "Reserved", className: "chip chip-crimson" },
  RELEASED: { label: "Released", className: "chip chip-neutral" },
  DECLINED: { label: "Declined", className: "chip bg-ink text-white" },
  WITHDRAWN: { label: "Withdrawn", className: "chip chip-quiet" },
};

export default async function RequestsPage({
  searchParams,
}: {
  searchParams: Promise<{ msg?: string; kind?: string }>;
}) {
  const user = await requireUser();
  const { msg, kind } = await searchParams;
  const today = todayInZone(FACILITY_TIMEZONE);

  const bookings = user.team
    ? await db.booking.findMany({
        where: { OR: [{ teamId: user.team.id }, { releasedFromTeamId: user.team.id }] },
        include: { decidedBy: true, requestedBy: true },
        orderBy: [{ date: "desc" }, { startMinutes: "desc" }],
        take: 60,
      })
    : [];

  const upcoming = bookings.filter((b) => b.date >= today);
  const past = bookings.filter((b) => b.date < today);

  return (
    <div className="min-h-dvh flex flex-col">
      <AppHeader user={user} active="requests" />

      <main className="grow p-4 pb-24 md:p-7 md:pb-7 flex flex-col gap-4">
        <div className="flex items-end gap-4 flex-wrap">
          <div className="grow">
            <div className="eyebrow">{user.team ? user.team.name : "No team"}</div>
            <h1 className="display text-[34px] mt-1">My requests</h1>
            <p className="text-sm text-muted mt-1">
              Everything your team holds or has asked for, and where it stands.
            </p>
          </div>
          {user.team && (
            <Link href="/request" className="btn btn-primary no-underline">
              Request time
            </Link>
          )}
        </div>

        <Flash message={msg} kind={kind} />

        {!user.team && (
          <div className="card p-6 max-w-[560px]">
            <p className="text-[14.5px] text-muted m-0">
              You aren&rsquo;t on a team, so you can&rsquo;t hold facility time. A club admin can
              put you on one.
            </p>
          </div>
        )}

        {user.team && (
          <div className="card overflow-hidden">
            <div className="thead flex items-center h-10 px-[18px]">
              <div className="w-[250px]">Date &amp; time</div>
              <div className="w-[110px]">Length</div>
              <div className="w-[130px]">Status</div>
              <div className="grow">Detail</div>
              <div className="w-[130px] text-right">Action</div>
            </div>

            {bookings.length === 0 && (
              <p className="px-[18px] py-6 text-sm text-muted">
                Nothing yet. Assigned time shows up here too, once an admin sets it.
              </p>
            )}

            {[...upcoming, ...past].map((booking) => {
              const status = STATUS[booking.status] ?? STATUS.PENDING!;
              const isPast = booking.date < today;
              return (
                <div
                  key={booking.id}
                  data-request={booking.id}
                  className={`flex items-center min-h-[64px] px-[18px] border-b border-line-faint last:border-b-0 ${
                    isPast ? "bg-paper/60" : ""
                  }`}
                >
                  <div className="w-[250px] pr-3">
                    <div className="font-[family-name:var(--font-display)] text-[19px] font-bold uppercase leading-none">
                      {formatDateLong(booking.date)}
                    </div>
                    <div className="font-[family-name:var(--font-mono)] text-xs text-muted mt-1">
                      {formatRange(booking.startMinutes, booking.endMinutes)}
                    </div>
                  </div>
                  <div className="w-[110px] pr-3 text-[13.5px] text-ink-2">
                    {describeLength(booking.endMinutes - booking.startMinutes)}
                  </div>
                  <div className="w-[130px] pr-3">
                    <span className={status.className}>{status.label}</span>
                  </div>
                  <div className="grow pr-3 text-[13px] text-muted">
                    {booking.status === "PENDING" && "Waiting on an approver"}
                    {booking.status === "DECLINED" &&
                      (booking.declineReason
                        ? `“${booking.declineReason}”`
                        : "No reason given")}
                    {booking.status === "HELD" &&
                      (booking.origin === "ASSIGNED"
                        ? "Assigned by the club"
                        : booking.origin === "PICKUP"
                          ? "Picked up from another team"
                          : booking.decidedBy
                            ? `Approved by ${booking.decidedBy.name ?? booking.decidedBy.email}`
                            : "Approved")}
                    {booking.status === "RELEASED" && "Released — another team can take it"}
                    {booking.status === "WITHDRAWN" && "Withdrawn"}
                  </div>
                  <div className="w-[130px] flex justify-end">
                    {booking.status === "PENDING" && !isPast && (
                      <form action={withdrawRequest}>
                        <input type="hidden" name="bookingId" value={booking.id} />
                        <button
                          type="submit"
                          data-withdraw={booking.id}
                          className="btn btn-secondary btn-sm"
                        >
                          Withdraw
                        </button>
                      </form>
                    )}
                    {booking.status === "HELD" && !isPast && (
                      <Link
                        href={`/booking/${booking.id}`}
                        className="btn btn-secondary btn-sm no-underline"
                      >
                        Open
                      </Link>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
      <MobileNav user={user} active="requests" />
    </div>
  );
}
