import Link from "next/link";

import { db } from "@/lib/db";
import { displayName } from "@/lib/domain";
import { requireSuperAdmin } from "@/lib/guards";
import { AdminTabs } from "@/components/AdminTabs";
import { Flash } from "@/components/Flash";
import { archiveTeam, createTeam, renameTeam, restoreTeam } from "./actions";

export const dynamic = "force-dynamic";

/** U7 before U10 — plain alphabetical order reads wrong to a club that thinks in
 *  age groups, and numeric collation gets it right without parsing the name. */
const byAge = (a: { name: string }, b: { name: string }) =>
  a.name.localeCompare(b.name, undefined, { numeric: true });

/** Who is on the team, in a line: the reason a team can't be archived yet. */
function membersLine(members: { name: string | null; email: string }[]): string {
  if (members.length === 0) return "Nobody on it";
  const names = members.map(displayName);
  if (names.length <= 3) return names.join(", ");
  return `${names.slice(0, 3).join(", ")} +${names.length - 3} more`;
}

export default async function TeamsPage({
  searchParams,
}: {
  searchParams: Promise<{ msg?: string; kind?: string }>;
}) {
  await requireSuperAdmin();
  const { msg, kind } = await searchParams;

  const teams = await db.team.findMany({
    include: {
      members: {
        where: { status: { in: ["ACTIVE", "INVITED"] } },
        select: { name: true, email: true },
        orderBy: { email: "asc" },
      },
      _count: { select: { bookings: true, assigned: true } },
    },
    orderBy: { name: "asc" },
  });

  const live = teams.filter((t) => t.archivedAt === null).sort(byAge);
  const archived = teams.filter((t) => t.archivedAt !== null).sort(byAge);

  return (
    <div className="flex flex-col gap-4">
      <AdminTabs active="teams" />
      <Flash message={msg} kind={kind} />

      <section className="card p-4 md:p-6 flex flex-col gap-1">
        <div className="flex items-baseline gap-3 flex-wrap">
          <h2 className="display text-2xl">Teams</h2>
          <p className="text-[13px] text-muted">
            {live.length} active
            {archived.length > 0 ? ` · ${archived.length} archived` : ""}
          </p>
        </div>
        <p className="text-[13px] text-muted mb-2">
          The names that appear on the calendar. Renaming one carries every booking and assigned
          schedule with it, so it is safe to fix a name mid-season. A team has to be empty before it
          can be archived — move its coaches on{" "}
          <Link href="/admin/people" className="text-crimson-deep">
            People &amp; access
          </Link>{" "}
          first.
        </p>

        {live.length === 0 && (
          <p className="py-4 text-sm text-muted border-t border-line-faint">
            No teams yet. Add the first one below.
          </p>
        )}

        {live.map((team) => (
          <div
            key={team.id}
            data-team={team.id}
            className="flex flex-wrap items-center gap-2.5 py-2.5 border-t border-line-faint"
          >
            <form action={renameTeam} className="flex items-center gap-2 shrink-0">
              <input type="hidden" name="teamId" value={team.id} />
              <input
                name="name"
                defaultValue={team.name}
                required
                maxLength={40}
                aria-label={`Name for ${team.name}`}
                className="input h-[38px] w-[132px] sm:w-[220px] text-[13.5px]"
              />
              <button type="submit" className="btn btn-secondary btn-sm">
                Rename
              </button>
            </form>

            {/* Last on a phone, so the name and Archive share the first line. */}
            <div className="order-last w-full md:order-none md:w-auto md:grow md:min-w-[180px] text-[13px] text-muted">
              {membersLine(team.members)}
            </div>

            <div className="hidden lg:block shrink-0 text-[12.5px] text-faint w-[120px]">
              {team._count.bookings === 0 ? "no blocks" : `${team._count.bookings} blocks`}
              {team._count.assigned > 0 ? ` · ${team._count.assigned} assigned` : ""}
            </div>

            <form action={archiveTeam} className="shrink-0 ml-auto md:ml-0">
              <input type="hidden" name="teamId" value={team.id} />
              <button
                type="submit"
                className="btn btn-secondary btn-sm"
                aria-label={`Archive ${team.name}`}
              >
                Archive
              </button>
            </form>
          </div>
        ))}

        <form
          action={createTeam}
          className="flex items-end gap-2.5 flex-wrap pt-4 mt-1 border-t border-line-faint"
        >
          <div className="grow sm:grow-0">
            <label htmlFor="new-team" className="field-label">
              Add a team
            </label>
            <input
              id="new-team"
              name="name"
              required
              maxLength={40}
              placeholder="e.g. U12 - Red"
              className="input w-full sm:w-[260px] h-[42px] text-[13.5px]"
            />
          </div>
          <button type="submit" className="btn btn-primary h-[42px]">
            Add team
          </button>
        </form>
      </section>

      {archived.length > 0 && (
        <section className="card p-6">
          <h2 className="display text-2xl mb-1">Archived</h2>
          <p className="text-[13px] text-muted mb-3">
            Kept for their history. They can&rsquo;t be booked or assigned to anyone until they are
            restored.
          </p>
          <div className="flex flex-wrap gap-2.5">
            {archived.map((team) => (
              <span
                key={team.id}
                data-team={team.id}
                className="inline-flex items-center gap-2.5 py-1.5 pl-3.5 pr-1.5 rounded-[3px] border border-line-soft bg-paper text-[13.5px] text-disabled"
              >
                {team.name}
                <form action={restoreTeam}>
                  <input type="hidden" name="teamId" value={team.id} />
                  <button type="submit" className="btn btn-secondary btn-sm">
                    Restore
                  </button>
                </form>
              </span>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
