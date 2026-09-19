import Link from "next/link";

const TAB =
  "h-10 px-4 inline-flex items-center border-b-[3px] font-[family-name:var(--font-display)] text-base font-semibold tracking-[0.06em] uppercase no-underline whitespace-nowrap";

const TABS = [
  { key: "people", href: "/admin/people", label: "People & access" },
  { key: "teams", href: "/admin/teams", label: "Teams" },
  { key: "schedule", href: "/admin/schedule", label: "Assigned schedule" },
  { key: "hours", href: "/admin/hours", label: "Hours" },
  { key: "rules", href: "/admin/rules", label: "Booking rules" },
] as const;

export function AdminTabs({ active }: { active: (typeof TABS)[number]["key"] }) {
  return (
    // On a phone the five tabs are wider than the screen, so the strip itself
    // scrolls sideways rather than the page — and it bleeds to both edges, which
    // is the hint that there is more of it off to the right.
    <div className="-mx-4 px-4 md:mx-0 md:px-0 overflow-x-auto">
      <div className="flex items-center gap-1 border-b border-line-soft min-w-max md:min-w-0">
        {TABS.map((tab) => (
          <Link
            key={tab.key}
            href={tab.href}
            className={
              tab.key === active
                ? `${TAB} border-crimson text-ink`
                : `${TAB} border-transparent text-muted hover:text-ink`
            }
          >
            {tab.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
