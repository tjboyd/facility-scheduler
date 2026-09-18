import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { Logo } from "@/components/AppHeader";
import { requestSignInLink } from "./actions";

const MESSAGES: Record<string, string> = {
  email: "That doesn't look like an email address. Check it and try again.",
  link: "That sign-in link was incomplete. Ask for a new one below.",
  invalid: "That sign-in link isn't valid. Ask for a new one below.",
  expired: "That sign-in link has expired. Ask for a new one below.",
  used: "That sign-in link has already been used. Ask for a new one below.",
  no_access: "That account no longer has access. Ask the club admin about it.",
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; email?: string }>;
}) {
  if (await getSessionUser()) redirect("/calendar");

  const { error, email } = await searchParams;
  const message = error ? MESSAGES[error] : undefined;

  return (
    <main className="min-h-dvh flex flex-col items-center justify-center gap-8 p-10">
      <Logo height={112} />

      <div className="w-[440px] max-w-full">
        <div className="card border-t-4 border-t-crimson p-8 pb-7">
          <div className="eyebrow">Indoor facility scheduler</div>
          <h1 className="display text-[38px] mt-1.5 mb-2">Sign in</h1>
          <p className="text-[14.5px] leading-relaxed text-muted mb-6">
            Use the email address the club admin added to the approved coach list.
          </p>

          {message && (
            <p
              role="alert"
              className="mb-5 rounded-[4px] border border-crimson-line bg-crimson-tint px-3.5 py-3 text-[13.5px] leading-snug text-crimson-deep"
            >
              {message}
            </p>
          )}

          <form action={requestSignInLink}>
            <label htmlFor="email" className="field-label">
              Email address
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              defaultValue={email ?? ""}
              placeholder="you@yourclub.org"
              className="input h-12 border-[1.5px] border-crimson"
            />
            <button type="submit" className="btn btn-primary w-full h-[50px] mt-4 text-[18px] tracking-[0.07em]">
              Email me a sign-in link
            </button>
          </form>

          <p className="mt-6 pt-5 border-t border-line-faint text-[13px] leading-relaxed text-muted">
            Email addresses that aren&rsquo;t on the approved list can&rsquo;t sign in. Ask the club
            admin to add you.
          </p>
        </div>

        <p className="mt-4 text-center text-[12.5px] text-faint">
          30-minute blocks · 1.5 hours max per request · one team per block
        </p>
      </div>
    </main>
  );
}
