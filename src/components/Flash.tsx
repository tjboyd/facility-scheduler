"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Route } from "next";

/**
 * The one-line result of whatever just happened, carried in the query string by
 * the server action that redirected here.
 *
 * It has weight on purpose — a thin white strip on a near-white page was easy
 * to miss, and a coach who misses "Sent a new sign-in link" sends it again. The
 * bar down the left and the word in front of the message do that work; colour
 * alone never does, since the whole design is legible in black and white.
 *
 * Dismissing is a link back to the same page without the message, so it works
 * with JavaScript off and leaves a clean URL to bookmark or reload.
 */
export function Flash({ message, kind }: { message?: string; kind?: string }) {
  const pathname = usePathname();
  if (!message) return null;
  const error = kind === "error";

  return (
    <div
      role="status"
      data-flash={error ? "error" : "ok"}
      className={`flex items-start gap-3 rounded-[4px] border border-l-[5px] pl-3.5 pr-2 py-3 shadow-[0_1px_4px_rgba(0,0,0,0.10)] ${
        error
          ? "border-crimson-line border-l-crimson bg-crimson-tint"
          : "border-line-soft border-l-ink bg-white"
      }`}
    >
      <span
        className={`shrink-0 mt-[2px] font-[family-name:var(--font-display)] text-[12.5px] font-bold tracking-[0.12em] uppercase ${
          error ? "text-crimson-deep" : "text-ink"
        }`}
      >
        {error ? "Problem" : "Done"}
      </span>

      <span className={`grow text-[13.5px] leading-snug ${error ? "text-crimson-deep" : "text-ink-2"}`}>
        {message}
      </span>

      <Link
        href={pathname as Route}
        replace
        aria-label="Dismiss this message"
        data-dismiss-flash=""
        className={`shrink-0 w-6 h-6 flex items-center justify-center rounded-[3px] no-underline leading-none ${
          error ? "text-crimson" : "text-faint"
        } hover:bg-black/5`}
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M6 6l12 12M18 6L6 18"
            stroke="currentColor"
            strokeWidth="2.6"
            strokeLinecap="round"
          />
        </svg>
      </Link>
    </div>
  );
}
