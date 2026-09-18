import Link from "next/link";

const TAB =
  "h-10 px-4 inline-flex items-center border-b-[3px] font-[family-name:var(--font-display)] text-base font-semibold tracking-[0.06em] uppercase no-underline";

export function AdminTabs() {
  return (
    <div className="flex items-center gap-1 border-b border-line-soft">
      <Link href="/admin/people" className={`${TAB} border-crimson text-ink`}>
        People &amp; access
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
