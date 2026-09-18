import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { canSignIn, isRole, isStatus, normalizeEmail, type Role, type Status } from "@/lib/domain";

export const SESSION_COOKIE = "fs_session";
export const SIGN_IN_TOKEN_TTL_MINUTES = 15;
export const SESSION_TTL_DAYS = 30;

/**
 * Secrets are stored hashed, never in the clear: a leaked database row cannot
 * be replayed as a sign-in link or a session cookie.
 */
function hash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function newSecret(): string {
  return randomBytes(32).toString("base64url");
}

/** Constant-time compare for anything derived from user input. */
export function secretsMatch(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export type SessionUser = {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  status: Status;
  team: { id: string; name: string } | null;
};

/**
 * Issues a single-use sign-in link for an address already on the allowlist.
 * Returns null when the address is unknown or access has been removed — the
 * caller must not reveal which, so the sign-in screen says the same thing
 * either way.
 */
export async function issueSignInToken(
  rawEmail: string,
): Promise<{ token: string; expiresAt: Date; userId: string } | null> {
  const email = normalizeEmail(rawEmail);
  const user = await db.user.findUnique({ where: { email } });
  if (!user) return null;
  if (!isStatus(user.status) || !canSignIn(user.status)) return null;

  const token = newSecret();
  const expiresAt = new Date(Date.now() + SIGN_IN_TOKEN_TTL_MINUTES * 60_000);

  // One live link per person: asking for a new one retires the old.
  await db.signInToken.deleteMany({ where: { userId: user.id, consumedAt: null } });
  await db.signInToken.create({ data: { tokenHash: hash(token), userId: user.id, expiresAt } });

  return { token, expiresAt, userId: user.id };
}

export type ConsumeResult =
  | { ok: true; userId: string }
  | { ok: false; reason: "invalid" | "expired" | "used" | "no_access" };

/** Verifies a link, burns it, and marks the person active. */
export async function consumeSignInToken(token: string): Promise<ConsumeResult> {
  const record = await db.signInToken.findUnique({
    where: { tokenHash: hash(token) },
    include: { user: true },
  });
  if (!record) return { ok: false, reason: "invalid" };
  if (record.consumedAt) return { ok: false, reason: "used" };
  if (record.expiresAt.getTime() <= Date.now()) return { ok: false, reason: "expired" };
  if (!isStatus(record.user.status) || !canSignIn(record.user.status)) {
    return { ok: false, reason: "no_access" };
  }

  const now = new Date();
  await db.$transaction([
    db.signInToken.update({ where: { id: record.id }, data: { consumedAt: now } }),
    db.user.update({
      where: { id: record.userId },
      data: {
        lastSignInAt: now,
        // The invitation is accepted the first time the link is followed.
        status: record.user.status === "INVITED" ? "ACTIVE" : record.user.status,
      },
    }),
  ]);

  return { ok: true, userId: record.userId };
}

/** Creates a server-side session and sets the cookie. */
export async function startSession(userId: string): Promise<void> {
  const token = newSecret();
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 86_400_000);

  await db.session.create({ data: { tokenHash: hash(token), userId, expiresAt } });

  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export async function endSession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await db.session.deleteMany({ where: { tokenHash: hash(token) } });
  jar.delete(SESSION_COOKIE);
}

/**
 * The current signed-in person, or null. Re-reads role, status and team on
 * every call, so an access change takes effect on the user's next request
 * rather than whenever their cookie happens to expire.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = await db.session.findUnique({
    where: { tokenHash: hash(token) },
    include: { user: { include: { team: true } } },
  });
  if (!session) return null;

  if (session.expiresAt.getTime() <= Date.now()) {
    await db.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }

  const { user } = session;
  if (!isRole(user.role) || !isStatus(user.status) || !canSignIn(user.status)) return null;

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    status: user.status,
    team: user.team ? { id: user.team.id, name: user.team.name } : null,
  };
}

/** Best-effort cleanup of expired rows; cheap enough to run on sign-in. */
export async function purgeExpired(): Promise<void> {
  const now = new Date();
  await db.session.deleteMany({ where: { expiresAt: { lt: now } } });
  await db.signInToken.deleteMany({ where: { expiresAt: { lt: now } } });
}
