import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { can, type Permission } from "@/lib/permissions";
import { ForbiddenError, AuthenticationError } from "@/lib/errors";
import { SESSION_COOKIE } from "@/lib/session-cookie";
import { validateSession, type SessionUser } from "@/server/services/auth.service";

/**
 * Cookie settings: HttpOnly (no JavaScript access), SameSite=Lax (not sent
 * on cross-site POSTs), Secure in production, scoped to the whole app.
 * The cookie holds a random 256-bit token; MySQL stores only its SHA-256.
 */
export { SESSION_COOKIE };

export async function setSessionCookie(token: string, expiresAt: Date): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export async function readSessionToken(): Promise<string | undefined> {
  return (await cookies()).get(SESSION_COOKIE)?.value;
}

export async function clearSessionCookie(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}

/** Current user for this request (deduplicated per render). */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  return validateSession(await readSessionToken());
});

/** Pages: redirect to /login when signed out. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/** Pages: redirect to /forbidden when the role lacks the permission. */
export async function requirePageAccess(permission: Permission): Promise<SessionUser> {
  const user = await requireUser();
  if (!can(user.role, permission)) redirect("/forbidden");
  return user;
}

/** Server actions / route handlers: throw instead of redirecting. */
export async function requireActor(permission?: Permission): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) throw new AuthenticationError();
  if (permission && !can(user.role, permission)) throw new ForbiddenError();
  return user;
}
