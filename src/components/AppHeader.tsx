import type { Route } from "next";
import Image from "next/image";
import Link from "next/link";
import type { SessionUser } from "@/lib/auth";
import { canDecideRequests, canManagePeople, displayName, ROLE_LABELS } from "@/lib/domain";

function initials(user: SessionUser): string {
  const source = user.name?.trim() || user.email;
  const parts = source.split(/[\s.@_-]+/).filter(Boolean);
  const letters = parts.slice(0, 2).map((p) => p[0] ?? "");
  return (letters.join("") || source.slice(0, 2)).toUpperCase();
}

export function Logo({ height = 48 }: { height?: number }) {
  // 2552 x 894 — keep the ratio so the lockup never distorts.
  return (
    <Image
      src="/brand/jr-chargers-logo.png"
      alt="Hamilton Jr Chargers"
      width={Math.round((height * 2552) / 894)}
      height={height}
      priority
      style={{ height, width: "auto" }}
    />
  );
}

/**
 * White bar with a crimson rule. The logo's wordmark is black with a white
 * keyline, so it needs a light ground — see docs/DESIGN.md §9.
 */
export function AppHeader({
  user,
  active,
}: {
  user: SessionUser;
  active: "calendar" | "requests" | "approvals" | "admin";
}) {
  const navClass = (key: typeof active) =>
    [
      "flex items-center h-[38px] px-4 rounded-[3px] no-underline",
      "font-[family-name:var(--font-display)] text-[16.5px] font-semibold tracking-[0.07em] uppercase",
      key === active ? "bg-crimson text-white" : "text-muted hover:text-ink",
    ].join(" ");

  return (
    <header className="h-16 md:h-[72px] shrink-0 bg-white border-b-[3px] border-crimson flex items-center gap-3 md:gap-6 px-4 md:px-6">
      <Link
        href="/calendar"
        aria-label="Hamilton Jr Chargers — facility calendar"
        className="flex items-center shrink-0"
      >
        <span className="md:hidden">
          <Logo height={36} />
        </span>
        <span className="hidden md:block">
          <Logo height={48} />
        </span>
      </Link>

      {/* On a phone the tabs live in the bottom bar, where a thumb reaches. */}
      <nav className="hidden md:flex items-center gap-1 grow">
        <Link href="/calendar" className={navClass("calendar")}>
          Calendar
        </Link>
        <Link href="/requests" className={navClass("requests")}>
          My requests
        </Link>
        {canDecideRequests(user.role) && (
          <Link href="/approvals" className={navClass("approvals")}>
            Approvals
          </Link>
        )}
        {canManagePeople(user.role) && (
          <Link href="/admin/people" className={navClass("admin")}>
            Admin
          </Link>
        )}
      </nav>

      <div className="grow md:hidden" />

      <div className="flex items-center gap-2 md:gap-3 min-w-0">
        {user.role === "SUPER_ADMIN" ? (
          <span className="chip chip-crimson hidden lg:inline-flex">Super admin</span>
        ) : (
          <span className="hidden lg:inline-flex items-center gap-2 px-3 py-1.5 border border-line rounded-[3px] font-[family-name:var(--font-display)] text-sm font-semibold tracking-[0.07em] uppercase text-ink-2">
            <span className="w-[7px] h-[7px] bg-crimson" aria-hidden />
            {ROLE_LABELS[user.role]}
            {user.team ? ` · ${user.team.name}` : ""}
          </span>
        )}
        <span
          title={`${displayName(user)} · ${ROLE_LABELS[user.role]}${user.team ? ` · ${user.team.name}` : ""}`}
          className="w-[34px] h-[34px] shrink-0 rounded-full bg-ink text-white font-[family-name:var(--font-display)] text-sm font-bold flex items-center justify-center"
        >
          {initials(user)}
        </span>
        <form action="/auth/signout" method="post" className="shrink-0">
          <button type="submit" className="btn btn-secondary btn-sm">
            <span className="hidden sm:inline">Sign out</span>
            <span className="sm:hidden" aria-label="Sign out">
              Out
            </span>
          </button>
        </form>
      </div>
    </header>
  );
}

/**
 * The phone's navigation. A fixed bottom bar rather than a menu behind a
 * button: there are only ever three or four destinations, and this is the part
 * of the screen a thumb reaches without moving the hand.
 *
 * Pages leave room for it with pb-20 md:pb-0; it is out of the flow.
 */
export function MobileNav({
  user,
  active,
}: {
  user: SessionUser;
  active: "calendar" | "requests" | "approvals" | "admin";
}) {
  const tabs: { key: typeof active; href: Route; label: string }[] = [
    { key: "calendar", href: "/calendar", label: "Calendar" },
    { key: "requests", href: "/requests", label: "Requests" },
    ...(canDecideRequests(user.role)
      ? [{ key: "approvals" as const, href: "/approvals" as Route, label: "Approve" }]
      : []),
    ...(canManagePeople(user.role)
      ? [{ key: "admin" as const, href: "/admin/people" as Route, label: "Admin" }]
      : []),
  ];

  return (
    <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 flex bg-white border-t border-line-soft pb-[env(safe-area-inset-bottom)]">
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          aria-current={tab.key === active ? "page" : undefined}
          className={`grow flex flex-col items-center justify-center gap-1 h-[58px] no-underline font-[family-name:var(--font-display)] text-[12.5px] font-semibold tracking-[0.08em] uppercase ${
            tab.key === active ? "text-crimson-deep" : "text-muted"
          }`}
        >
          <span
            aria-hidden
            className={`w-6 h-[3px] rounded-full ${tab.key === active ? "bg-crimson" : "bg-transparent"}`}
          />
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
