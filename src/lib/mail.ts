import { renderEmail } from "@/lib/email";
import {
  APP_URL,
  MAIL_FROM,
  MAIL_REPLY_TO,
  MAIL_TRANSPORT,
  ORG_NAME,
  POSTMARK_MESSAGE_STREAM,
  POSTMARK_SERVER_TOKEN,
} from "@/lib/env";

export type Mail = {
  to: string;
  subject: string;
  /** Always sent: what a client that refuses HTML, or a screen reader, reads. */
  text: string;
  /** The branded version, when there is one. */
  html?: string;
};

/** Anything the caller can reasonably report to a person. */
export class MailError extends Error {
  constructor(
    message: string,
    /** True when the address itself is the problem — a typo, or suppressed. */
    readonly recipientProblem = false,
  ) {
    super(message);
    this.name = "MailError";
  }
}

export type PostmarkConfig = {
  token: string;
  from: string;
  replyTo?: string;
  messageStream: string;
};

export function postmarkConfig(): PostmarkConfig {
  if (!POSTMARK_SERVER_TOKEN) {
    throw new MailError(
      "POSTMARK_SERVER_TOKEN is not set, so no email can be sent. Set it, or set MAIL_TRANSPORT=console.",
    );
  }
  if (!MAIL_FROM || MAIL_FROM.includes("@localhost")) {
    throw new MailError(
      "MAIL_FROM must be an address on a domain verified in Postmark.",
    );
  }
  return {
    token: POSTMARK_SERVER_TOKEN,
    from: MAIL_FROM,
    replyTo: MAIL_REPLY_TO,
    messageStream: POSTMARK_MESSAGE_STREAM,
  };
}

/** Pure — the request body Postmark expects. Separated so it can be tested. */
export function postmarkPayload(mail: Mail, cfg: PostmarkConfig): Record<string, string> {
  return {
    From: cfg.from,
    To: mail.to,
    Subject: mail.subject,
    // Both bodies, always. Postmark sends them as one multipart/alternative
    // message and the client picks — which is what keeps the plain version
    // honest rather than a fallback nobody ever looks at.
    TextBody: mail.text,
    ...(mail.html ? { HtmlBody: mail.html } : {}),
    MessageStream: cfg.messageStream,
    ...(cfg.replyTo ? { ReplyTo: cfg.replyTo } : {}),
  };
}

/**
 * Turns a Postmark failure into something worth showing a club admin.
 * Their ErrorCodes are documented; these are the ones this app can hit.
 */
export function describePostmarkError(status: number, body: unknown): MailError {
  const parsed = body as { ErrorCode?: number; Message?: string } | null;
  const code = parsed?.ErrorCode;
  const detail = parsed?.Message?.trim();

  if (status === 401) {
    return new MailError("Postmark rejected the server token. Check POSTMARK_SERVER_TOKEN.");
  }
  if (code === 300) {
    return new MailError(detail || "Postmark says that address is invalid.", true);
  }
  if (code === 406) {
    return new MailError(
      "Postmark has that address marked inactive — it hard-bounced or reported spam before. Reactivate it in Postmark once the address is confirmed good.",
      true,
    );
  }
  if (code === 400 || code === 401 || code === 402) {
    return new MailError(detail || "Postmark rejected the sender. Is the domain verified?");
  }
  return new MailError(
    detail ? `Postmark refused the message: ${detail}` : `Postmark returned HTTP ${status}.`,
  );
}

async function sendViaPostmark(mail: Mail): Promise<void> {
  const cfg = postmarkConfig();

  let response: Response;
  try {
    response = await fetch("https://api.postmarkapp.com/email", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Postmark-Server-Token": cfg.token,
      },
      body: JSON.stringify(postmarkPayload(mail, cfg)),
    });
  } catch (cause) {
    throw new MailError(`Could not reach Postmark: ${(cause as Error).message}`);
  }

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw describePostmarkError(response.status, body);
  }
}

function sendToLog(mail: Mail): void {
  console.info(
    [
      "",
      "── email ────────────────────────────────",
      `from: ${MAIL_FROM}`,
      `to:   ${mail.to}`,
      `subj: ${mail.subject}`,
      "",
      mail.text,
      ...(mail.html ? [`(also sent as HTML, ${mail.html.length} bytes)`] : []),
      "─────────────────────────────────────────",
      "",
    ].join("\n"),
  );
}

/**
 * Development prints to the server log so the app runs with no mail
 * credentials. Production goes through Postmark.
 */
export async function sendMail(mail: Mail): Promise<void> {
  switch (MAIL_TRANSPORT) {
    case "console":
      return sendToLog(mail);
    case "postmark":
      return sendViaPostmark(mail);
    default:
      throw new MailError(`Unknown MAIL_TRANSPORT "${MAIL_TRANSPORT}" — use "console" or "postmark".`);
  }
}

export function signInLink(token: string): string {
  return `${APP_URL}/auth/verify?token=${encodeURIComponent(token)}`;
}

export async function sendSignInEmail(to: string, token: string, minutes: number): Promise<void> {
  const { html, text } = renderEmail({
    eyebrow: "Sign in",
    title: "Your sign-in link",
    preheader: `Works once, and expires in ${minutes} minutes.`,
    blocks: [
      {
        kind: "text",
        text: `Here is your link to the ${ORG_NAME} indoor facility scheduler. There is no password — this link is the sign-in.`,
      },
      { kind: "button", label: "Sign in", url: signInLink(token) },
    ],
    footer: [
      `The link works once and expires in ${minutes} minutes.`,
      "If you didn't ask for it, you can ignore this email — it does nothing on its own.",
    ],
  });

  await sendMail({ to, subject: `Your sign-in link — ${ORG_NAME} indoor facility`, text, html });
}

export async function sendInviteEmail(to: string, token: string, invitedBy: string): Promise<void> {
  const { html, text } = renderEmail({
    eyebrow: "You're in",
    title: "Facility scheduler access",
    preheader: `${invitedBy} added you to the ${ORG_NAME} indoor facility scheduler.`,
    blocks: [
      {
        kind: "text",
        text: `${invitedBy} added you to the ${ORG_NAME} indoor facility scheduler. Use this link to sign in — there is no password to set.`,
      },
      { kind: "button", label: "Sign in", url: signInLink(token) },
      {
        kind: "text",
        text:
          "Coaches ask for cage and turf time in 30-minute blocks, and an approver accepts or " +
          "declines it. You get an email either way, and the whole club's week is on the calendar.",
      },
    ],
    footer: [`You get this because a club admin added your address at ${ORG_NAME}.`],
  });

  await sendMail({
    to,
    subject: `You've been added to the ${ORG_NAME} facility scheduler`,
    text,
    html,
  });
}
