/**
 * The look of the club's email, in one place.
 *
 * Both bodies come out of the same spec: write the message once as blocks, and
 * get the HTML an email client renders and the plain text a client that refuses
 * HTML — or a screen reader, or the development log — falls back to. Writing
 * the two by hand is how they drift, and the plain one is the copy people
 * actually read when an inbox blocks images or styles.
 *
 * Email rendering is twenty years behind the web: tables for layout, every
 * style inline, no external stylesheet, no web fonts. That is why this is hand
 * written rather than the app's own components. It is deliberately tolerant —
 * strip every style and it is still a heading, some facts and a link that works.
 */
import { ORG_NAME } from "@/lib/env";

export type EmailBlock =
  /** A sentence or two. */
  | { kind: "text"; text: string }
  /** Label-and-value lines: the team, the time, who asked. */
  | { kind: "facts"; facts: { label: string; value: string }[] }
  /** Somebody's own words, set apart — a coach's note, a decline reason. */
  | { kind: "quote"; text: string }
  /** The one thing to do. There should be at most one per email. */
  | { kind: "button"; label: string; url: string }
  /** A second way on, as a plain link. */
  | { kind: "link"; label: string; url: string };

export type EmailSpec = {
  /** Small crimson label above the title: "Time request", "Approved". */
  eyebrow: string;
  title: string;
  /** The line an inbox shows beside the subject, before anyone opens it. */
  preheader: string;
  blocks: EmailBlock[];
  /** Small print: why this arrived, how to stop it. */
  footer?: string[];
};

const CRIMSON = "#AD0303";
const INK = "#0A0A0A";
const BODY = "#3A3A3A";
const FAINT = "#8A8A8A";
const LINE = "#E2E2E2";
const PAPER = "#F4F4F4";
/** No web fonts in email — this is the closest stack every client already has. */
const SANS = "'Helvetica Neue',Helvetica,Arial,sans-serif";

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function paragraph(text: string): string {
  return `<p style="margin:0 0 14px;font-size:15px;line-height:1.55;color:${BODY}">${escapeHtml(text)}</p>`;
}

function facts(rows: { label: string; value: string }[]): string {
  const cells = rows
    .map(
      (row) => `<tr>
          <td style="padding:0 14px 8px 0;font-size:11px;line-height:1.5;letter-spacing:1px;text-transform:uppercase;color:${FAINT};white-space:nowrap;vertical-align:top">${escapeHtml(row.label)}</td>
          <td style="padding:0 0 8px;font-size:15px;line-height:1.5;color:${INK};font-weight:600">${escapeHtml(row.value)}</td>
        </tr>`,
    )
    .join("");
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px;border-collapse:collapse"><tbody>${cells}</tbody></table>`;
}

function quote(text: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 18px;border-collapse:collapse"><tbody><tr>
      <td style="padding:12px 16px;background:${PAPER};border-left:3px solid ${CRIMSON};font-size:14.5px;line-height:1.55;color:${BODY}">${escapeHtml(text)}</td>
    </tr></tbody></table>`;
}

function button(label: string, url: string): string {
  const href = escapeHtml(url);
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 20px;border-collapse:separate"><tbody><tr>
      <td style="background:${CRIMSON};border-radius:3px" align="center">
        <a href="${href}" style="display:inline-block;padding:14px 26px;font-family:${SANS};font-size:14px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:#FFFFFF;text-decoration:none">${escapeHtml(label)}</a>
      </td>
    </tr></tbody></table>
    <p style="margin:-10px 0 20px;font-size:12px;line-height:1.5;color:${FAINT};word-break:break-all">Or paste this into your browser: ${escapeHtml(url)}</p>`;
}

function link(label: string, url: string): string {
  return `<p style="margin:0 0 14px;font-size:14.5px;line-height:1.55;color:${BODY}">${escapeHtml(label)}<br>
    <a href="${escapeHtml(url)}" style="color:${CRIMSON};font-weight:600;word-break:break-all">${escapeHtml(url)}</a></p>`;
}

function blockHtml(block: EmailBlock): string {
  switch (block.kind) {
    case "text":
      return paragraph(block.text);
    case "facts":
      return facts(block.facts);
    case "quote":
      return quote(block.text);
    case "button":
      return button(block.label, block.url);
    case "link":
      return link(block.label, block.url);
  }
}

function blockText(block: EmailBlock): string[] {
  switch (block.kind) {
    case "text":
      return [block.text, ""];
    case "facts": {
      const width = Math.max(...block.facts.map((f) => f.label.length)) + 1;
      return [...block.facts.map((f) => `${`${f.label}:`.padEnd(width + 2)}${f.value}`), ""];
    }
    case "quote":
      return [`"${block.text}"`, ""];
    case "button":
    case "link":
      return [`${block.label}:`, block.url, ""];
  }
}

/** The same message as an email client sees it, and as plain text. */
export function renderEmail(spec: EmailSpec): { html: string; text: string } {
  const body = spec.blocks.map(blockHtml).join("\n");
  const footer = (spec.footer ?? [])
    .map(
      (line) =>
        `<p style="margin:0 0 6px;font-size:12px;line-height:1.5;color:${FAINT}">${escapeHtml(line)}</p>`,
    )
    .join("");

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(spec.title)}</title>
</head>
<body style="margin:0;padding:0;background:${PAPER};font-family:${SANS};-webkit-font-smoothing:antialiased">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${escapeHtml(spec.preheader)}</div>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${PAPER};border-collapse:collapse">
  <tbody><tr><td align="center" style="padding:24px 12px">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="width:600px;max-width:100%;background:#FFFFFF;border:1px solid ${LINE};border-collapse:collapse">
      <tbody>
        <tr><td style="padding:20px 28px 16px;border-bottom:4px solid ${CRIMSON}">
          <span style="font-family:${SANS};font-size:17px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:${INK}">${escapeHtml(ORG_NAME)}</span>
          <span style="font-family:${SANS};font-size:11px;letter-spacing:2px;text-transform:uppercase;color:${FAINT};padding-left:8px">Indoor facility</span>
        </td></tr>
        <tr><td style="padding:26px 28px 6px">
          <p style="margin:0 0 6px;font-size:11.5px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:${CRIMSON}">${escapeHtml(spec.eyebrow)}</p>
          <h1 style="margin:0 0 16px;font-size:24px;line-height:1.2;font-weight:700;letter-spacing:0.3px;text-transform:uppercase;color:${INK}">${escapeHtml(spec.title)}</h1>
          ${body}
        </td></tr>
        ${footer ? `<tr><td style="padding:4px 28px 24px"><div style="border-top:1px solid ${LINE};padding-top:14px">${footer}</div></td></tr>` : ""}
      </tbody>
    </table>
  </td></tr></tbody>
</table>
</body>
</html>`;

  const text = [
    spec.title,
    "",
    ...spec.blocks.flatMap(blockText),
    ...(spec.footer?.length ? [...spec.footer] : []),
  ]
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd();

  return { html, text: `${text}\n` };
}
