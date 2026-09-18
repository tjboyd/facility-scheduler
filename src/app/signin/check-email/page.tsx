import Link from "next/link";
import { Logo } from "@/components/AppHeader";
import { SIGN_IN_TOKEN_TTL_MINUTES } from "@/lib/auth";

export default async function CheckEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>;
}) {
  const { email } = await searchParams;

  return (
    <main className="min-h-dvh flex flex-col items-center justify-center gap-8 p-10">
      <Logo height={112} />

      <div className="card w-[440px] max-w-full p-8 pb-7">
        <div className="w-[46px] h-[46px] rounded-[4px] bg-crimson flex items-center justify-center mb-4">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <rect x="3" y="5.5" width="18" height="13" rx="1.5" stroke="#fff" strokeWidth="1.8" />
            <path d="M3.8 6.8L12 13l8.2-6.2" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </div>

        <h1 className="display text-[32px] mb-2">Check your inbox</h1>
        <p className="text-[14.5px] leading-relaxed text-muted mb-4">
          If {email ? <strong className="font-semibold text-ink">{email}</strong> : "that address"} is
          on the approved list, a sign-in link is on its way. It works once and expires in{" "}
          {SIGN_IN_TOKEN_TTL_MINUTES} minutes.
        </p>

        <div className="rounded-[4px] border border-[#e4e4e4] bg-paper px-4 py-3.5 text-[13px] leading-relaxed text-muted">
          Nothing arrived? Your email may not be on the approved coach list yet — ask the club admin
          to add it.
        </div>

        <div className="flex items-center gap-5 mt-4 pt-4 border-t border-line-faint">
          <Link
            href="/signin"
            className="font-[family-name:var(--font-display)] text-[15px] font-semibold tracking-[0.06em] uppercase no-underline"
          >
            Use a different email
          </Link>
        </div>
      </div>
    </main>
  );
}
