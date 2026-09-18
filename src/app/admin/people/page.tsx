import { db } from "@/lib/db";
import { requireSuperAdmin } from "@/lib/guards";
import { isRole, isStatus, type Role, type Status } from "@/lib/domain";
import { Flash } from "@/components/Flash";
import { AddPeopleForm } from "./AddPeopleForm";
import { PersonRow } from "./PersonRow";
import { TeamsCard } from "./TeamsCard";

export const dynamic = "force-dynamic";

/** Staff first, then coaches, then anyone whose access was removed. */
const ROLE_ORDER: Record<Role, number> = { SUPER_ADMIN: 0, APPROVER: 1, HEAD_COACH: 2 };

export default async function PeoplePage({
  searchParams,
}: {
  searchParams: Promise<{ msg?: string; kind?: string }>;
}) {
  const actor = await requireSuperAdmin();
  const { msg, kind } = await searchParams;

  const [rawUsers, teams] = await Promise.all([
    db.user.findMany({ include: { team: true }, orderBy: { email: "asc" } }),
    db.team.findMany({
      include: { _count: { select: { members: true } } },
      orderBy: [{ archivedAt: "asc" }, { name: "asc" }],
    }),
  ]);

  const people = rawUsers
    .map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      role: isRole(u.role) ? u.role : ("HEAD_COACH" as Role),
      status: isStatus(u.status) ? u.status : ("DISABLED" as Status),
      team: u.team ? { id: u.team.id, name: u.team.name } : null,
      invitedAt: u.invitedAt,
      lastSignInAt: u.lastSignInAt,
    }))
    .sort((a, b) => {
      const aGone = a.status === "DISABLED" ? 1 : 0;
      const bGone = b.status === "DISABLED" ? 1 : 0;
      if (aGone !== bGone) return aGone - bGone;
      if (ROLE_ORDER[a.role] !== ROLE_ORDER[b.role]) return ROLE_ORDER[a.role] - ROLE_ORDER[b.role];
      return a.email.localeCompare(b.email);
    });

  const assignableTeams = teams
    .filter((t) => !t.archivedAt)
    .map((t) => ({ id: t.id, name: t.name }));

  const withAccess = people.filter((p) => p.status !== "DISABLED").length;
  const pendingInvites = people.filter((p) => p.status === "INVITED").length;

  return (
    <div className="flex flex-col gap-4">
      <Flash message={msg} kind={kind} />

      <div className="flex gap-[18px] items-start flex-wrap xl:flex-nowrap">
        <section className="grow min-w-[560px] flex flex-col gap-3">
          <div className="flex items-baseline gap-3">
            <h2 className="display text-2xl">Approved people</h2>
            <p className="text-[13px] text-muted">
              {withAccess} with access
              {pendingInvites > 0 ? ` · ${pendingInvites} yet to sign in` : ""}
            </p>
          </div>

          <div className="card overflow-hidden">
            <div className="thead flex items-center h-10 px-[18px]">
              <div className="w-[300px]">Email</div>
              <div className="w-[150px]">Name</div>
              <div className="w-[140px]">Team</div>
              <div className="w-[170px]">Role</div>
              <div className="grow">Status</div>
              <div className="w-[230px] text-right">Actions</div>
            </div>

            {people.length === 0 && (
              <p className="px-[18px] py-6 text-sm text-muted">
                Nobody here yet. Add the first coach on the right.
              </p>
            )}

            {people.map((person) => (
              <PersonRow
                key={person.id}
                person={person}
                teams={assignableTeams}
                isSelf={person.id === actor.id}
              />
            ))}
          </div>

          <p className="flex items-center gap-2.5 text-[12.5px] text-muted">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <rect x="4" y="10.5" width="16" height="10.5" rx="1.6" stroke="#AD0303" strokeWidth="1.7" />
              <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" stroke="#AD0303" strokeWidth="1.7" />
            </svg>
            This list <em>is</em> the access control — an email that isn&rsquo;t here can&rsquo;t sign
            in, even with a valid link.
          </p>
        </section>

        <aside className="w-[340px] shrink-0 flex flex-col gap-[18px]">
          <AddPeopleForm teams={assignableTeams} />
          <TeamsCard
            teams={teams.map((t) => ({
              id: t.id,
              name: t.name,
              archived: t.archivedAt !== null,
              members: t._count.members,
            }))}
          />
        </aside>
      </div>
    </div>
  );
}
