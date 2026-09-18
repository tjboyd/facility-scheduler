"use client";

import { useActionState } from "react";
import { ROLE_DESCRIPTIONS, ROLE_LABELS, ROLES } from "@/lib/domain";
import { invitePeople, type InviteState } from "./actions";

const INITIAL: InviteState = { status: "idle" };

export function AddPeopleForm({ teams }: { teams: { id: string; name: string }[] }) {
  const [state, formAction, pending] = useActionState(invitePeople, INITIAL);

  return (
    <section className="card p-5 flex flex-col gap-3.5">
      <div>
        <h2 className="display text-2xl">Add people</h2>
        <p className="text-[12.5px] leading-snug text-muted mt-0.5">
          They get an invite email with a sign-in link and can use it straight away.
        </p>
      </div>

      {state.status !== "idle" && state.message && (
        <p
          role="status"
          className={[
            "rounded-[4px] border px-3 py-2.5 text-[13px] leading-snug",
            state.status === "error"
              ? "border-crimson-line bg-crimson-tint text-crimson-deep"
              : "border-line-soft bg-paper text-ink-2",
          ].join(" ")}
        >
          {state.message}
        </p>
      )}

      {state.alreadyThere && state.alreadyThere.length > 0 && state.status === "ok" && (
        <p className="text-[12px] leading-snug text-faint">
          Already on the list, left alone: {state.alreadyThere.join(", ")}
        </p>
      )}

      {state.mailProblem && (
        <p className="rounded-[4px] border border-line-soft bg-paper px-3 py-2.5 text-[12.5px] leading-snug text-muted">
          {state.mailProblem}
        </p>
      )}

      {state.notEmailed && state.notEmailed.length > 0 && (
        <p className="text-[12px] leading-snug text-crimson-deep">
          On the list but not emailed: {state.notEmailed.join(", ")}
        </p>
      )}

      {state.invalid && state.invalid.length > 0 && (
        <p className="text-[12px] leading-snug text-crimson-deep">
          Not added — doesn&rsquo;t look like an address: {state.invalid.join(", ")}
        </p>
      )}

      <form action={formAction} className="flex flex-col gap-3.5">
        <div>
          <label htmlFor="emails" className="field-label">
            Email addresses
          </label>
          <textarea
            id="emails"
            name="emails"
            rows={3}
            required
            placeholder={"one per line, or paste a comma-separated list"}
            className="textarea text-[13.5px]"
          />
        </div>

        <div>
          <label htmlFor="role" className="field-label">
            Role
          </label>
          <select id="role" name="role" defaultValue="HEAD_COACH" className="select h-[42px] text-[13.5px]">
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]} — {ROLE_DESCRIPTIONS[r].toLowerCase()}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="teamId" className="field-label">
            Team
          </label>
          <select id="teamId" name="teamId" defaultValue="" className="select h-[42px] text-[13.5px]">
            <option value="">— none (staff) —</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <p className="mt-1.5 text-xs leading-snug text-faint">
            Head coaches need a team — it&rsquo;s the name everyone sees on the calendar once a block
            is approved.
          </p>
        </div>

        <button type="submit" disabled={pending} className="btn btn-primary h-[46px] text-[18px]">
          {pending ? "Sending…" : "Send invitations"}
        </button>
      </form>
    </section>
  );
}
