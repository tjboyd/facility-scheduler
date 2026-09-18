"use server";

import { redirect } from "next/navigation";
import { issueSignInToken, purgeExpired, SIGN_IN_TOKEN_TTL_MINUTES } from "@/lib/auth";
import { isValidEmail, normalizeEmail } from "@/lib/domain";
import { sendSignInEmail } from "@/lib/mail";

export async function requestSignInLink(formData: FormData): Promise<void> {
  const raw = String(formData.get("email") ?? "");

  if (!isValidEmail(raw)) {
    redirect(`/signin?error=email&email=${encodeURIComponent(raw.slice(0, 254))}`);
  }
  const email = normalizeEmail(raw);

  await purgeExpired();
  const issued = await issueSignInToken(email);
  if (issued) {
    try {
      await sendSignInEmail(email, issued.token, SIGN_IN_TOKEN_TTL_MINUTES);
    } catch (error) {
      // Still answer identically: whether an address is on the list is not
      // something an unauthenticated visitor gets to learn from a failure.
      console.error(`[signin] could not send a link to ${email}:`, error);
    }
  }

  // Always the same answer: whether an address is on the list is not something
  // an unauthenticated visitor gets to probe.
  redirect(`/signin/check-email?email=${encodeURIComponent(email)}`);
}
