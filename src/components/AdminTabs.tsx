import Link from "next/link";

const TAB =
  "h-10 px-4 inline-flex items-center border-b-[3px] font-[family-name:var(--font-display)] text-base font-semibold tracking-[0.06em] uppercase no-underline";

export function AdminTabs({ active }: { active: "people" | "schedule" }) {
  const on = `${TAB} border-crimson text-ink`;
  const off = `${TAB} border-transparent text-muted hover:text-ink`;

  return (
    <div className="flex items-center gap-1 border-b border-line-soft">
      <Link href="/admin/people" className={active === "people" ? on : off}>
        People &amp; access
      </Link>
      <Link href="/admin/schedule" className={active === "schedule" ? on : off}>
        Assigned schedule
      </Link>
      <span className={`${TAB} border-transparent text-disabled cursor-default`} aria-disabled="true">
        Hours
        <span className="ml-2 chip chip-quiet">Soon</span>
      </span>
      <span className={`${TAB} border-transparent text-disabled cursor-default`} aria-disabled="true">
        Booking rules
        <span className="ml-2 chip chip-quiet">Soon</span>
      </span>
    </div>
  );
}
