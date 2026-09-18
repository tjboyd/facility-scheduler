export const APP_URL = process.env.APP_URL?.replace(/\/+$/, "") || "http://localhost:3000";
export const MAIL_TRANSPORT = process.env.MAIL_TRANSPORT || "console";
export const MAIL_FROM =
  process.env.MAIL_FROM || "Hamilton Jr Chargers Facility <no-reply@jrchargersbaseball.com>";
