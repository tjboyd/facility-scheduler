/**
 * Pure domain rules for people and access. No database, no framework — so the
 * rules that decide who may sign in and who may change what are testable on
 * their own.
 */

export const ROLES = ["HEAD_COACH", "APPROVER", "SUPER_ADMIN"] as const;
export type Role = (typeof ROLES)[number];

export const STATUSES = ["INVITED", "ACTIVE", "DISABLED"] as const;
export type Status = (typeof STATUSES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  HEAD_COACH: "Head coach",
  APPROVER: "Approver",
  SUPER_ADMIN: "Super admin",
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  HEAD_COACH: "Can request time for their team",
  APPROVER: "Can accept or decline requests",
  SUPER_ADMIN: "Can change settings and manage people",
};

export const STATUS_LABELS: Record<Status, string> = {
  INVITED: "Invited",
  ACTIVE: "Active",
  DISABLED: "Access removed",
};

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

export function isStatus(value: unknown): value is Status {
  return typeof value === "string" && (STATUSES as readonly string[]).includes(value);
}

/** Lowercased and trimmed. Every stored and compared address goes through this. */
export function normalizeEmail(input: string): string {
  return input.trim().toLowerCase();
}

/**
 * Deliberately conservative: one @, no whitespace, a dot in the domain. Good
 * enough to catch typos; the sign-in link is what actually proves the address.
 */
const EMAIL_RE = /^[^\s@,;]+@[^\s@,;.]+(\.[^\s@,;.]+)+$/;

export function isValidEmail(input: string): boolean {
  const email = normalizeEmail(input);
  return email.length <= 254 && EMAIL_RE.test(email);
}

export type ParsedEmails = {
  /** Valid, normalized, de-duplicated, in first-seen order. */
  valid: string[];
  /** Entries that did not look like an address, as typed. */
  invalid: string[];
};

/**
 * Accepts the shapes people actually paste: one per line, comma separated,
 * semicolons, or "Name <addr@example.org>" out of a mail client.
 */
export function parseEmailList(input: string): ParsedEmails {
  const seen = new Set<string>();
  const valid: string[] = [];
  const invalid: string[] = [];

  for (const rawPart of input.split(/[\n,;]+/)) {
    const part = rawPart.trim();
    if (part === "") continue;

    const angled = part.match(/<([^>]+)>/);
    const candidate = angled?.[1] ?? part.split(/\s+/).pop() ?? part;

    if (!isValidEmail(candidate)) {
      invalid.push(part);
      continue;
    }
    const email = normalizeEmail(candidate);
    if (seen.has(email)) continue;
    seen.add(email);
    valid.push(email);
  }

  return { valid, invalid };
}

/** Only super admins may reach the admin area or change anyone's access. */
export function canManagePeople(role: Role): boolean {
  return role === "SUPER_ADMIN";
}

/** Approvers and super admins can decide requests. */
export function canDecideRequests(role: Role): boolean {
  return role === "APPROVER" || role === "SUPER_ADMIN";
}

/** Everyone on the list can request time for their own team. */
export function canRequestTime(role: Role): boolean {
  return role === "HEAD_COACH" || canDecideRequests(role);
}

/** Head coaches book for a team, so they need one. Staff roles do not. */
export function requiresTeam(role: Role): boolean {
  return role === "HEAD_COACH";
}

export function canSignIn(status: Status): boolean {
  return status === "INVITED" || status === "ACTIVE";
}

export type SuperAdminGuardInput = {
  /** Every currently active or invited super admin, by id. */
  currentSuperAdminIds: readonly string[];
  /** The user being changed. */
  targetId: string;
  /** What the change would leave them as, or null if access is being removed. */
  nextRole: Role | null;
};

/**
 * Locking yourself out is the one mistake this screen can make that cannot be
 * undone in the app. Refuse any edit that would leave no super admin standing.
 */
export function wouldRemoveLastSuperAdmin(input: SuperAdminGuardInput): boolean {
  const { currentSuperAdminIds, targetId, nextRole } = input;
  if (!currentSuperAdminIds.includes(targetId)) return false;
  if (nextRole === "SUPER_ADMIN") return false;
  return currentSuperAdminIds.length <= 1;
}

export type NotifyGuardInput = {
  /** Everyone who can decide requests at all. */
  deciderIds: readonly string[];
  /** Who would still be emailed once this save lands. */
  nextNotifiedIds: readonly string[];
};

/**
 * True when a save would leave a request with nobody to email, while somebody
 * can still decide it. The queue would keep filling up, but silently — and a
 * coach waiting has no way to tell "not looked at yet" from "nobody was told".
 *
 * Stated over the *resulting* set rather than per person on purpose: two
 * approvers turned off in one save are each harmless on their own and fatal
 * together, which a per-change check would wave through.
 */
export function wouldSilenceAllApprovers(input: NotifyGuardInput): boolean {
  return input.deciderIds.length > 0 && input.nextNotifiedIds.length === 0;
}

export type OptionalEmail =
  | { ok: true; value: string | null }
  | { ok: false; raw: string };

/**
 * An address field where blank is a real answer rather than a mistake — the
 * release notice, where empty means tell nobody.
 *
 * The form marks it type="email" so a browser catches a typo without a round
 * trip, which means this rarely fires. It still has to exist: that check is
 * absent with JavaScript off, and absent entirely for anything posting
 * directly.
 */
export function parseOptionalEmail(raw: string): OptionalEmail {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: true, value: null };
  const normalized = normalizeEmail(trimmed);
  if (!isValidEmail(normalized)) return { ok: false, raw: trimmed };
  return { ok: true, value: normalized };
}

/** "Coach Rivera" from "rivera@jrchargersbaseball.com" is wrong more often than
 *  it is right, so an invited person simply has no name until they sign in. */
export function displayName(user: { name: string | null; email: string }): string {
  return user.name?.trim() || user.email;
}
