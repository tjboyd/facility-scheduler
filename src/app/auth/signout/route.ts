import { endSession } from "@/lib/auth";
import { redirectTo } from "@/lib/http";

export async function POST() {
  await endSession();
  // 303, so the browser follows it with a GET rather than re-posting.
  return redirectTo("/signin", 303);
}
