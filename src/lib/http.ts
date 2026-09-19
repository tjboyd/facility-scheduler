import { NextResponse } from "next/server";

/**
 * A redirect to another page of this app.
 *
 * The Location is deliberately relative. `NextResponse.redirect()` needs an
 * absolute URL, and the only one a route handler has to build from is the
 * incoming request — which behind a proxy is the *internal* address the app was
 * handed, not the one the browser asked for. In production that is
 * `localhost:8080`, so the browser dutifully followed the approval link to a
 * host that only exists inside the container.
 *
 * A relative Location is resolved by the browser against the URL it actually
 * used, so it is right on every host the app is ever reached on — no
 * configuration involved, and nothing to keep in step with APP_URL (which
 * remains what the *emails* are built from, since an email has no request to
 * resolve against).
 */
export function redirectTo(path: string, status: 303 | 307 = 307): NextResponse {
  return new NextResponse(null, { status, headers: { Location: path } });
}

/** `/decide/done?state=approved&b=…`, with the empty params left off. */
export function pathWithQuery(path: string, params: Record<string, string | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) query.set(key, value);
  const search = query.toString();
  return search ? `${path}?${search}` : path;
}
