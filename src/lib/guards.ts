import { redirect } from "next/navigation";
import { getSessionUser, type SessionUser } from "@/lib/auth";
import { canManagePeople } from "@/lib/domain";

export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/signin");
  return user;
}

export async function requireSuperAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (!canManagePeople(user.role)) redirect("/calendar");
  return user;
}

/** For server actions, where redirecting is the wrong answer. */
export class NotAuthorized extends Error {
  constructor(message = "You don't have access to do that.") {
    super(message);
    this.name = "NotAuthorized";
  }
}

export async function assertSuperAdmin(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user || !canManagePeople(user.role)) throw new NotAuthorized();
  return user;
}
