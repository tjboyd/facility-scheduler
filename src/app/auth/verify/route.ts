import { NextResponse, type NextRequest } from "next/server";
import { consumeSignInToken, purgeExpired, startSession } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  if (!token) return NextResponse.redirect(new URL("/signin?error=link", request.url));

  const result = await consumeSignInToken(token);
  if (!result.ok) {
    return NextResponse.redirect(new URL(`/signin?error=${result.reason}`, request.url));
  }

  await startSession(result.userId);
  await purgeExpired();
  return NextResponse.redirect(new URL("/calendar", request.url));
}
