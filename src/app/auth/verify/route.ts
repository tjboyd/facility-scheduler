import { type NextRequest } from "next/server";
import { consumeSignInToken, purgeExpired, startSession } from "@/lib/auth";
import { redirectTo } from "@/lib/http";

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  if (!token) return redirectTo("/signin?error=link");

  const result = await consumeSignInToken(token);
  if (!result.ok) {
    return redirectTo(`/signin?error=${result.reason}`);
  }

  await startSession(result.userId);
  await purgeExpired();
  return redirectTo("/calendar");
}
