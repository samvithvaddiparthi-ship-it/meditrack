import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";
import { AuthenticationError } from "@/lib/errors";
import type { Actor, Role } from "@/lib/permissions";
import { loginSchema } from "@/lib/validation/schemas";
import { parseInput } from "@/lib/validation/common";
import { DUMMY_PASSWORD_HASH, verifyPassword } from "@/server/auth/password";
import { recordAudit } from "@/server/services/audit.service";

export const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // one working shift
export const MAX_FAILED_LOGINS = 5;
export const LOCKOUT_MS = 15 * 60 * 1000;

const INVALID_CREDENTIALS = "Invalid email or password.";

export type SessionUser = Actor & { email: string };

/** Only this hash is stored; the raw token lives in the HttpOnly cookie. */
export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export type LoginResult = { token: string; expiresAt: Date; user: SessionUser };

/**
 * Verifies credentials and opens a server-side session.
 * Throws AuthenticationError with a generic message on any failure.
 */
export async function login(
  input: { email: unknown; password: unknown },
  meta: { userAgent?: string | null } = {},
): Promise<LoginResult> {
  const { email, password } = parseInput(loginSchema, input);
  const user = await prisma.user.findUnique({ where: { email } });

  if (!user) {
    await verifyPassword(password, DUMMY_PASSWORD_HASH); // equalise timing
    await recordAudit({
      action: "auth.login_failed",
      entityType: "user",
      summary: "Sign-in failed: unknown account",
      details: { reason: "unknown_account" },
    });
    throw new AuthenticationError(INVALID_CREDENTIALS);
  }

  const now = new Date();
  if (user.lockedUntil && user.lockedUntil > now) {
    await verifyPassword(password, DUMMY_PASSWORD_HASH);
    throw new AuthenticationError("Too many failed sign-in attempts. Try again in a few minutes.");
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    const failed = user.failedLoginCount + 1;
    const lock = failed >= MAX_FAILED_LOGINS;
    await prisma.user.update({
      where: { id: user.id },
      data: lock
        ? { failedLoginCount: 0, lockedUntil: new Date(now.getTime() + LOCKOUT_MS) }
        : { failedLoginCount: failed },
    });
    await recordAudit({
      action: lock ? "auth.account_locked" : "auth.login_failed",
      entityType: "user",
      entityId: user.id,
      summary: lock ? `Account ${user.email} locked after repeated failures` : `Sign-in failed for ${user.email}`,
      details: { reason: "wrong_password", attempt: failed },
    });
    throw new AuthenticationError(INVALID_CREDENTIALS);
  }

  if (!user.isActive) {
    throw new AuthenticationError("This account has been deactivated. Contact an administrator.");
  }

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  await prisma.$transaction([
    prisma.session.create({
      data: {
        id: hashSessionToken(token),
        userId: user.id,
        expiresAt,
        userAgent: meta.userAgent?.slice(0, 255) ?? null,
      },
    }),
    prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: now },
    }),
  ]);

  const sessionUser: SessionUser = { id: user.id, name: user.name, email: user.email, role: user.role as Role };
  await recordAudit({
    action: "auth.login",
    entityType: "user",
    entityId: user.id,
    summary: `${user.name} signed in`,
    actor: sessionUser,
  });
  return { token, expiresAt, user: sessionUser };
}

/**
 * Resolves a cookie token to its user. Expired sessions and deactivated
 * users are rejected, so deactivation takes effect on the next request.
 */
export async function validateSession(token: string | undefined | null): Promise<SessionUser | null> {
  if (!token || token.length > 100) return null;
  const session = await prisma.session.findUnique({
    where: { id: hashSessionToken(token) },
    include: { user: { select: { id: true, name: true, email: true, role: true, isActive: true } } },
  });
  if (!session || session.expiresAt <= new Date() || !session.user.isActive) return null;
  const { id, name, email, role } = session.user;
  return { id, name, email, role: role as Role };
}

export async function logout(token: string | undefined | null): Promise<void> {
  if (!token) return;
  const id = hashSessionToken(token);
  const session = await prisma.session.findUnique({ where: { id }, include: { user: true } });
  if (!session) return;
  await prisma.session.delete({ where: { id } });
  await recordAudit({
    action: "auth.logout",
    entityType: "user",
    entityId: session.userId,
    summary: `${session.user.name} signed out`,
    actor: { id: session.user.id, name: session.user.name, role: session.user.role as Role },
  });
}

/** Ends every session of a user (deactivation / password reset). */
export async function revokeUserSessions(userId: number): Promise<number> {
  const result = await prisma.session.deleteMany({ where: { userId } });
  return result.count;
}
