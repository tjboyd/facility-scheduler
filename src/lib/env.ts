/**
 * Runtime configuration. Nothing about the club's name, domain or addresses is
 * hardcoded anywhere else — moving to a different sending domain is an .env
 * change plus DNS, with no code edits.
 */

export const APP_URL = (process.env.APP_URL || "http://localhost:3000").replace(/\/+$/, "");

/** Used in email copy. */
export const ORG_NAME = process.env.ORG_NAME?.trim() || "Hamilton Jr Chargers";

/** "console" (development: print to the log) or "postmark". */
export const MAIL_TRANSPORT = (process.env.MAIL_TRANSPORT || "console").trim().toLowerCase();

/**
 * Must be on a domain verified in Postmark, or it will reject the send.
 * "Name <addr@domain>" is fine.
 */
export const MAIL_FROM =
  process.env.MAIL_FROM?.trim() || "Facility Scheduler <no-reply@localhost>";

/** Where replies should go — coaches will hit reply whatever the From says. */
export const MAIL_REPLY_TO = process.env.MAIL_REPLY_TO?.trim() || undefined;

/**
 * Postmark message stream. Sign-in links and approvals are transactional, so
 * this should stay on a transactional stream ("outbound" is the default one) —
 * never a broadcast stream, which is filtered far more aggressively.
 */
export const POSTMARK_MESSAGE_STREAM =
  process.env.POSTMARK_MESSAGE_STREAM?.trim() || "outbound";

export const POSTMARK_SERVER_TOKEN = process.env.POSTMARK_SERVER_TOKEN?.trim() || "";
