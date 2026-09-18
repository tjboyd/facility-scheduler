import { archiveTeam, createTeam, restoreTeam } from "./actions";

export type TeamView = { id: string; name: string; archived: boolean; members: number };

export function TeamsCard({ teams }: { teams: TeamView[] }) {
  const live = teams.filter((t) => !t.archived);
  const archived = teams.filter((t) => t.archived);

  return (
    <section className="card p-5 flex flex-col gap-3.5">
      <div>
        <h2 className="display text-2xl">Teams</h2>
        <p className="text-[12.5px] leading-snug text-muted mt-0.5">
          The names that appear on the calendar. A team has to be empty before it can be archived.
        </p>
      </div>

      <ul className="flex flex-col gap-1.5 list-none p-0 m-0">
        {live.length === 0 && <li className="text-[13px] text-faint">No teams yet.</li>}

        {live.map((team) => (
          <li
            key={team.id}
            className="flex items-center gap-2 rounded-[3px] border border-line-soft bg-paper px-3 h-10"
          >
            <span className="display text-[19px] grow">{team.name}</span>
            <span className="text-xs text-faint">
              {team.members === 0 ? "empty" : `${team.members} ${team.members === 1 ? "person" : "people"}`}
            </span>
            <form action={archiveTeam}>
              <input type="hidden" name="teamId" value={team.id} />
              <button
                type="submit"
                aria-label={`Archive ${team.name}`}
                className="w-6 h-6 flex items-center justify-center cursor-pointer"
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M6 6l12 12M18 6L6 18" stroke="#767676" strokeWidth="2.6" strokeLinecap="round" />
                </svg>
              </button>
            </form>
          </li>
        ))}
      </ul>

      <form action={createTeam} className="flex gap-2">
        <input
          name="name"
          required
          maxLength={40}
          placeholder="New team, e.g. 12U Red"
          aria-label="New team name"
          className="input h-[42px] text-[13.5px] grow"
        />
        <button type="submit" className="btn btn-secondary h-[42px] px-4">
          Add
        </button>
      </form>

      {archived.length > 0 && (
        <details className="text-[12.5px]">
          <summary className="cursor-pointer text-muted">Archived ({archived.length})</summary>
          <ul className="flex flex-col gap-1.5 list-none p-0 mt-2">
            {archived.map((team) => (
              <li key={team.id} className="flex items-center gap-2 h-9">
                <span className="display text-[17px] text-disabled grow">{team.name}</span>
                <form action={restoreTeam}>
                  <input type="hidden" name="teamId" value={team.id} />
                  <button type="submit" className="btn btn-secondary btn-sm">
                    Restore
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
