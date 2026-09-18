import { APP_URL, MAIL_FROM, MAIL_TRANSPORT } from "@/lib/env";

export type Mail = { to: string; subject: string; text: string };

/**
 * Development sends nothing: the sign-in link is printed to the server log so
 * the app runs with no mail credentials. Wire a real transport here (Resend,
 * SES, SMTP) and set MAIL_TRANSPORT to switch.
 */
export async function sendMail(mail: Mail): Promise<void> {
  if (MAIL_TRANSPORT === "console") {
    console.info(
      ["", "── email ────────────────────────────────", `from: ${MAIL_FROM}`,
       `to:   ${mail.to}`, `subj: ${mail.subject}`, "", mail.text,
       "─────────────────────────────────────────", ""].join("\n"),
    );
    return;
  }
  throw new Error(`Unknown MAIL_TRANSPORT: ${MAIL_TRANSPORT}`);
}

export function signInLink(token: string): string {
  return `${APP_URL}/auth/verify?token=${encodeURIComponent(token)}`;
}

export async function sendSignInEmail(to: string, token: string, minutes: number): Promise<void> {
  await sendMail({
    to,
    subject: "Your sign-in link — Jr Chargers indoor facility",
    text: [
      "Here is your sign-in link for the Hamilton Jr Chargers indoor facility scheduler.",
      "",
      signInLink(token),
      "",
      `The link works once and expires in ${minutes} minutes.`,
      "If you didn't ask for it, you can ignore this email.",
    ].join("\n"),
  });
}

export async function sendInviteEmail(to: string, token: string, invitedBy: string): Promise<void> {
  await sendMail({
    to,
    subject: "You've been added to the Jr Chargers facility scheduler",
    text: [
      `${invitedBy} added you to the Hamilton Jr Chargers indoor facility scheduler.`,
      "",
      "Use this link to sign in:",
      signInLink(token),
      "",
      "Coaches request cage and turf time in 30-minute blocks, up to 1.5 hours per",
      "request. An approver accepts or declines, and you get an email either way.",
    ].join("\n"),
  });
}
