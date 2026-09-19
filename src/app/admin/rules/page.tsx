import { db } from "@/lib/db";
import { loadSettings } from "@/lib/facility";
import { requireSuperAdmin } from "@/lib/guards";
import { AdminTabs } from "@/components/AdminTabs";
import { Flash } from "@/components/Flash";
import { ROLE_LABELS } from "@/lib/domain";
import { describeLength } from "@/lib/rules";
import { saveRules } from "./actions";

export const dynamic = "force-dynamic";

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 py-2.5 border-t border-line-faint">
      <div className="grow">
        <div className="text-[13.5px]">{label}</div>
        {hint && <div className="text-xs text-faint mt-0.5">{hint}</div>}
      </div>
      {children}
    </div>
  );
}

function Num({ name, value, unit }: { name: string; value: number; unit?: string }) {
  return (
    <div className="flex items-center gap-2.5 shrink-0">
      <input
        type="number"
        name={name}
        defaultValue={value}
        aria-label={name}
        className="input w-[72px] h-[38px] px-2.5 text-center font-[family-name:var(--font-mono)] text-sm"
      />
      {unit && <span className="w-[76px] text-[13.5px] text-muted">{unit}</span>}
    </div>
  );
}

export default async function RulesPage({
  searchParams,
}: {
  searchParams: Promise<{ msg?: string; kind?: string }>;
}) {
  await requireSuperAdmin();
  const { msg, kind } = await searchParams;

  const [settings, deciders] = await Promise.all([
    loadSettings(),
    db.user.findMany({
      where: { role: { in: ["APPROVER", "SUPER_ADMIN"] }, status: { in: ["ACTIVE", "INVITED"] } },
      orderBy: { email: "asc" },
    }),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <AdminTabs active="rules" />
      <Flash message={msg} kind={kind} />

      <form action={saveRules} className="flex flex-col gap-4">
        <div className="flex justify-end">
          <button type="submit" className="btn btn-primary">
            Save booking rules
          </button>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
          <section className="card p-5">
            <h2 className="display text-[23px] mb-0.5">Block size and length</h2>
            <p className="text-[13px] text-muted mb-3">
              How the day is chopped up, and the most any one request can hold. Assigned schedules
              aren&rsquo;t held to this cap.
            </p>
            <Row label="Block size">
              <Num name="blockMinutes" value={settings.blockMinutes} unit="minutes" />
            </Row>
            <Row
              label="Longest single request"
              hint={`Currently ${describeLength(settings.maxRequestMinutes)}`}
            >
              <Num name="maxRequestMinutes" value={settings.maxRequestMinutes} unit="minutes" />
            </Row>
          </section>

          <section className="card p-5">
            <h2 className="display text-[23px] mb-0.5">Limits per team</h2>
            <p className="text-[13px] text-muted mb-3">
              Keeps one team from taking the whole week. Assigned and picked-up blocks don&rsquo;t
              count — that is the club&rsquo;s own time, and time nobody else wanted.
            </p>
            <Row label="Approved requests per team, per week">
              <Num name="maxApprovedPerWeek" value={settings.maxApprovedPerWeek} />
            </Row>
            <Row label="Requests a team can have waiting at once">
              <Num name="maxOpenRequests" value={settings.maxOpenRequests} />
            </Row>
          </section>

          <section className="card p-5">
            <h2 className="display text-[23px] mb-0.5">Timing</h2>
            <p className="text-[13px] text-muted mb-3">
              How far out coaches can book, and how late they can ask. A team can release a block
              right up to its start time — there is no cutoff.
            </p>
            <Row label="Coaches can request up to">
              <Num name="weeksAhead" value={settings.weeksAhead} unit="weeks out" />
            </Row>
            <Row
              label="Requests must land at least"
              hint={
                settings.minNoticeHours === 0
                  ? "Zero: a coach can ask for a slot later today, right up to its start time."
                  : `Zero would let a coach ask for a slot later today. At ${settings.minNoticeHours} nothing inside the next ${settings.minNoticeHours} hours is offered at all.`
              }
            >
              <Num name="minNoticeHours" value={settings.minNoticeHours} unit="hrs ahead" />
            </Row>
          </section>

          <section className="card p-5">
            <h2 className="display text-[23px] mb-0.5">Approvals and email</h2>
            <p className="text-[13px] text-muted mb-3">
              Everyone below can decide requests — untick somebody to stop emailing
              them about new ones. They still see the queue. Who can decide at all is
              set on <span className="font-semibold">People &amp; access</span>.
            </p>

            <div className="flex flex-col mb-1">
              {deciders.map((person) => (
                <label
                  key={person.id}
                  data-decider={person.id}
                  className="flex items-center gap-3 py-2 border-t border-line-faint cursor-pointer"
                >
                  <span className="grow min-w-0">
                    <span className="block text-[13.5px] truncate">{person.email}</span>
                    <span className="block text-xs text-faint mt-0.5">
                      {ROLE_LABELS[person.role as "APPROVER" | "SUPER_ADMIN"]}
                      {person.notifyOnRequests ? " · emailed on every request" : " · not emailed"}
                    </span>
                  </span>
                  <input
                    type="checkbox"
                    name={`notify-${person.id}`}
                    defaultChecked={person.notifyOnRequests}
                    aria-label={`Email ${person.email} when a request comes in`}
                    className="w-4 h-4 accent-[#AD0303] shrink-0"
                  />
                </label>
              ))}
              {deciders.length === 0 && (
                <p className="text-[13px] text-crimson-deep m-0">
                  Nobody can approve requests. Give someone the approver role first.
                </p>
              )}
            </div>

            <Row
              label="Email the coach when a decision is made"
              hint="Approvals and declines both; the reason is included."
            >
              <input
                type="checkbox"
                name="notifyCoachOnDecision"
                defaultChecked={settings.notifyCoachOnDecision}
                className="w-4 h-4 accent-[#AD0303] shrink-0"
              />
            </Row>

            <div className="py-2.5 border-t border-line-faint">
              <label htmlFor="releaseNotifyEmail" className="text-[13.5px]">
                Tell somebody when a block is released
              </label>
              <p className="text-xs text-faint mt-0.5 mb-2">
                Released time is first come, first served, so it helps if one person
                knows it is going spare. <strong>Leave empty to send nothing.</strong>{" "}
                Picking a block up never emails anyone.
              </p>
              <input
                id="releaseNotifyEmail"
                name="releaseNotifyEmail"
                type="email"
                defaultValue={settings.releaseNotifyEmail ?? ""}
                placeholder="scheduler@jrchargersbaseball.com"
                className="input h-[38px] text-[13.5px]"
              />
            </div>
          </section>
        </div>
      </form>
    </div>
  );
}
