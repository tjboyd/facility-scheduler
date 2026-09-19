import { type NextRequest } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { pathWithQuery, redirectTo } from "@/lib/http";
import { displayName } from "@/lib/domain";
import { lookupApprovalToken } from "@/lib/requests";
import { decide } from "@/app/approvals/actions";

export const dynamic = "force-dynamic";

/**
 * One-click approve, straight from the approver's email, with no sign-in.
 *
 * The token is bound to this booking and to approving it, is single-use, and
 * dies the moment the booking is decided by any route. Declining is not
 * one-click: it asks for a reason the coach will read.
 *
 * This is a route handler rather than a page because it writes. A page render
 * is not allowed to have side effects — Next refuses `revalidatePath` from one,
 * and React is free to render a page more than once or throw the render away.
 * Redirecting to the result page also keeps the token out of the address bar,
 * the browser's history and any outbound referrer.
 */
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  const done = (state: string, bookingId?: string) =>
    redirectTo(pathWithQuery("/decide/done", { state, b: bookingId }));

  if (!token) return done("incomplete");

  const lookup = await lookupApprovalToken(token);
  if (!lookup.ok) return done(lookup.reason);

  // Whoever holds the link is acting as an approver; record who if they happen
  // to be signed in as well.
  const signedIn = await getSessionUser();
  const result = await decide(
    lookup.bookingId,
    "APPROVE",
    signedIn?.id ?? null,
    signedIn ? displayName(signedIn) : "an approver",
    "EMAIL",
    null,
  );
  return done(result.ok ? "approved" : result.code, lookup.bookingId);
}
