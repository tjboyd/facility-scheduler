import Link from "next/link";
import { db } from "@/lib/db";
import { Logo } from "@/components/AppHeader";
import { formatDateLong, formatRange } from "@/lib/schedule";

export const dynamic = "force-dynamic";

/**
 * What the approver sees after the link in their email has done its work. It
 * only reports: the decision itself happened in the route handler that sent
 * them here, so a reload cannot repeat it.
 */
const OUTCOMES: Record<string, { heading: string; detail: string }> = {
  approved: {
    heading: "Approved",
    detail: "The coach has been emailed and the calendar is updated. Nothing else to do.",
  },
  incomplete: {
    heading: "Couldn't approve that",
    detail: "That link was incomplete — it may have been cut in half by the mail app.",
  },
  invalid: {
    heading: "Couldn't approve that",
    detail: "That approval link isn't valid.",
  },
  expired: {
    heading: "Link expired",
    detail: "That approval link has expired. Open approvals to decide it there.",
  },
  used: {
    heading: "Already decided",
    detail: "That link has already been used — the request is decided.",
  },
  decided: {
    heading: "Already decided",
    detail: "Somebody got to this one first. Approvals shows who and when.",
  },
  raced: {
    heading: "Already decided",
    detail: "Another approver decided that request a moment before you did.",
  },
  clash: {
    heading: "Couldn't approve that",
    detail:
      "Another team has taken that time since the request came in, so approving it would " +
      "double-book the floor. The coach can ask for a different block.",
  },
  gone: {
    heading: "Couldn't approve that",
    detail: "That request no longer exists — the coach may have withdrawn it.",
  },
};

export default async function DecideDonePage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string; b?: string }>;
}) {
  const { state, b } = await searchParams;
  const outcome = OUTCOMES[state ?? ""] ?? OUTCOMES.invalid!;

  const booking = b
    ? await db.booking.findUnique({ where: { id: b }, include: { team: true } })
    : null;

  return (
    <main className="min-h-dvh flex flex-col items-center justify-center gap-8 p-10">
      <Logo height={96} />

      <div className="card w-[460px] max-w-full border-t-4 border-t-crimson p-8">
        <div className="eyebrow">Facility request</div>
        <h1 className="display text-[36px] mt-1.5 mb-3">{outcome.heading}</h1>

        {booking && (
          <p className="text-[17px] font-semibold mb-1">
            {booking.team?.name ?? "A team"} · {formatDateLong(booking.date)},{" "}
            <span className="font-[family-name:var(--font-mono)] text-[15px]">
              {formatRange(booking.startMinutes, booking.endMinutes)}
            </span>
          </p>
        )}

        <p className="text-[14.5px] leading-relaxed text-muted">{outcome.detail}</p>

        <div className="flex gap-2.5 mt-6 pt-5 border-t border-line-faint">
          <Link href="/approvals" className="btn btn-secondary no-underline">
            Open approvals
          </Link>
          <Link href="/calendar" className="btn btn-secondary no-underline">
            See the calendar
          </Link>
        </div>
      </div>
    </main>
  );
}
