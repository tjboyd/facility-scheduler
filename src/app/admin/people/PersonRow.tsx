import {
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  ROLES,
  type Role,
  type Status,
} from "@/lib/domain";
import { removeAccess, resendInvite, restoreAccess, updatePerson } from "./actions";

export type PersonView = {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  status: Status;
  team: { id: string; name: string } | null;
  invitedAt: Date;
  lastSignInAt: Date | null;
};

const shortDate = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

function StatusCell({ person }: { person: PersonView }) {
  if (person.status === "DISABLED") {
    return <span className="text-[13px] text-disabled">Access removed</span>;
  }
  if (person.status === "INVITED") {
    return (
      <span className="inline-flex items-center gap-2 text-[13px] text-crimson-deep">
        <span className="w-[7px] h-[7px] bg-crimson" aria-hidden />
        Invited {shortDate.format(person.invitedAt)}
      </span>
    );
  }
  return (
    <span className="text-[13px] text-ink-2">
      Active
      {person.lastSignInAt && (
        <span className="text-faint"> · last in {shortDate.format(person.lastSignInAt)}</span>
      )}
    </span>
  );
}

export function PersonRow({
  person,
  teams,
  isSelf,
}: {
  person: PersonView;
  teams: { id: string; name: string }[];
  isSelf: boolean;
}) {
  const gone = person.status === "DISABLED";
  const editId = `edit-${person.id}`;

  return (
    <div
      data-row={person.email}
      className={`flex items-center min-h-[58px] px-[18px] border-b border-line-faint last:border-b-0 ${
        gone ? "bg-paper/60" : ""
      }`}
    >
      {/* display:contents lets one form span several cells of the flex row */}
      <form id={editId} action={updatePerson} className="contents">
        <input type="hidden" name="userId" value={person.id} />

        <div className="w-[230px] pr-3 flex items-center gap-2 min-w-0">
          <span
            title={person.email}
            className={`truncate text-[13.5px] font-medium ${gone ? "text-disabled line-through" : ""}`}
          >
            {person.email}
          </span>
          {isSelf && <span className="chip chip-neutral shrink-0">You</span>}
        </div>

        <div
          title={person.name ?? undefined}
          className={`w-[110px] pr-3 truncate text-[13.5px] ${person.name ? "text-ink-2" : "text-faint"}`}
        >
          {person.name ?? "Not signed in yet"}
        </div>

        <div className="w-[132px] pr-3">
          <select
            name="teamId"
            defaultValue={person.team?.id ?? ""}
            disabled={gone}
            aria-label={`Team for ${person.email}`}
            className="select h-9 px-2 text-[13px]"
          >
            <option value="">— none —</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
            {/* keep an archived team visible rather than silently dropping it */}
            {person.team && !teams.some((t) => t.id === person.team!.id) && (
              <option value={person.team.id}>{person.team.name} (archived)</option>
            )}
          </select>
        </div>

        <div className="w-[150px] pr-3">
          <select
            name="role"
            defaultValue={person.role}
            disabled={gone}
            aria-label={`Role for ${person.email}`}
            className="select h-9 px-2 text-[13px]"
          >
            {ROLES.map((r) => (
              <option key={r} value={r} title={ROLE_DESCRIPTIONS[r]}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        </div>

        <div className="grow pr-3 min-w-[130px]">
          <StatusCell person={person} />
        </div>
      </form>

      {/* Pinned to the right edge of the horizontal scroller: on a laptop this
          column used to fall outside it, so the Save that a changed dropdown
          needs was invisible. Its own background, or the row would show through. */}
      <div
        className={`w-[230px] flex items-center justify-end gap-2 sticky right-0 pl-3 shadow-[-7px_0_7px_-7px_rgba(0,0,0,0.16)] ${
          gone ? "bg-[#FAFAFA]" : "bg-white"
        }`}
      >
        {!gone && (
          <button
            type="submit"
            form={editId}
            data-save={person.email}
            className="btn btn-secondary btn-sm"
          >
            Save
          </button>
        )}

        {!gone && person.status === "INVITED" && (
          <form action={resendInvite}>
            <input type="hidden" name="userId" value={person.id} />
            <button type="submit" className="btn btn-secondary btn-sm">
              Resend
            </button>
          </form>
        )}

        {gone ? (
          <form action={restoreAccess}>
            <input type="hidden" name="userId" value={person.id} />
            <button type="submit" className="btn btn-secondary btn-sm">
              Restore
            </button>
          </form>
        ) : (
          <form action={removeAccess}>
            <input type="hidden" name="userId" value={person.id} />
            <button
              type="submit"
              data-remove={person.email}
              disabled={isSelf}
              title={isSelf ? "Ask another super admin to remove your access" : undefined}
              className="btn btn-outline-dark btn-sm"
            >
              Remove
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
