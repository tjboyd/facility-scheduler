import Image from "next/image";
import Link from "next/link";
import type { SessionUser } from "@/lib/auth";
import { canDecideRequests, canManagePeople, ROLE_LABELS } from "@/lib/domain";

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
export function AppHeader({ user, active }: { user: SessionUser; active: "calendar" | "requests" | "approvals" | "admin" }) {
  const navClass = (key: typeof active) =>
    [
      "flex items-center h-[38px] px-4 rounded-[3px] no-underline",
      "font-[family-name:var(--font-display)] text-[16.5px] font-semibold tracking-[0.07em] uppercase",
      key === active ? "bg-crimson text-white" : "text-muted hover:text-ink",
    ].join(" ");

  return (
    <header className="h-[72px] shrink-0 bg-white border-b-[3px] border-crimson flex items-center gap-6 px-6">
      <Link href="/calendar" aria-label="Hamilton Jr Chargers — facility calendar" className="flex items-center shrink-0">
        <Logo height={48} />
      </Link>

      <nav className="flex items-center gap-1 grow">
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

      <div className="flex items-center gap-3">
        {user.role === "SUPER_ADMIN" ? (
          <span className="chip chip-crimson">Super admin</span>
        ) : (
          <span className="inline-flex items-center gap-2 px-3 py-1.5 border border-line rounded-[3px] font-[family-name:var(--font-display)] text-sm font-semibold tracking-[0.07em] uppercase text-ink-2">
            <span className="w-[7px] h-[7px] bg-crimson" aria-hidden />
            {ROLE_LABELS[user.role]}
            {user.team ? ` · ${user.team.name}` : ""}
          </span>
        )}
        <span
          title={user.email}
          className="w-[34px] h-[34px] rounded-full bg-ink text-white font-[family-name:var(--font-display)] text-sm font-bold flex items-center justify-center"
        >
          {initials(user)}
        </span>
        <form action="/auth/signout" method="post">
          <button type="submit" className="btn btn-secondary btn-sm">
            Sign out
          </button>
        </form>
      </div>
    </header>
  );
}
