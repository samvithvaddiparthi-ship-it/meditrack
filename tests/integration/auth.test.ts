import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { AuthenticationError } from "@/lib/errors";
import { hashSessionToken, login, logout, MAX_FAILED_LOGINS, validateSession } from "@/server/services/auth.service";
import { updateUser } from "@/server/services/users.service";
import { createUser } from "./helpers";
import { setupCleanDatabases } from "./lifecycle";

setupCleanDatabases();

describe("authentication", () => {
  it("signs in with valid credentials and stores only a hash of the session token", async () => {
    const { user, password } = await createUser("STAFF");
    const result = await login({ email: user.email.toUpperCase(), password }, { userAgent: "vitest" });

    expect(result.user).toMatchObject({ id: user.id, role: "STAFF", email: user.email });
    expect(result.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const sessions = await prisma.session.findMany({ where: { userId: user.id } });
    expect(sessions).toHaveLength(1);
    expect(sessions[0].id).toBe(hashSessionToken(result.token));
    expect(sessions[0].id).not.toBe(result.token);
    expect(await validateSession(result.token)).toMatchObject({ id: user.id, role: "STAFF" });
  });

  it("stores passwords as bcrypt hashes, never plaintext", async () => {
    const { user, password } = await createUser("ADMIN");
    expect(user.passwordHash).toMatch(/^\$2[aby]\$12\$/);
    expect(user.passwordHash).not.toContain(password);
  });

  it("rejects a wrong password or unknown email with the same generic message", async () => {
    const { user } = await createUser("STAFF");
    await expect(login({ email: user.email, password: "WrongPassword9" })).rejects.toThrow("Invalid email or password.");
    await expect(login({ email: "nobody@test.local", password: "WrongPassword9" })).rejects.toThrow("Invalid email or password.");
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).failedLoginCount).toBe(1);
    expect(await prisma.session.count()).toBe(0);
  });

  it("locks the account after repeated failures", async () => {
    const { user, password } = await createUser("STAFF");
    for (let i = 0; i < MAX_FAILED_LOGINS; i++) {
      await expect(login({ email: user.email, password: "WrongPassword9" })).rejects.toBeInstanceOf(AuthenticationError);
    }
    await expect(login({ email: user.email, password })).rejects.toThrow(/Too many failed sign-in attempts/);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).lockedUntil).not.toBeNull();
  });

  it("rejects deactivated accounts", async () => {
    const { user, password } = await createUser("STAFF", { isActive: false });
    await expect(login({ email: user.email, password })).rejects.toThrow(/deactivated/);
  });

  it("logout deletes the server-side session", async () => {
    const { user, password } = await createUser("STAFF");
    const { token } = await login({ email: user.email, password });
    await logout(token);
    expect(await validateSession(token)).toBeNull();
    expect(await prisma.session.count()).toBe(0);
  });

  it("expired sessions and deactivated users are rejected", async () => {
    const { user, password } = await createUser("STAFF");
    const { token } = await login({ email: user.email, password });
    await prisma.session.update({ where: { id: hashSessionToken(token) }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await validateSession(token)).toBeNull();

    const second = await login({ email: user.email, password });
    const { actor: admin } = await createUser("ADMIN");
    await updateUser(admin, user.id, { name: user.name, role: "STAFF", isActive: "false" });
    expect(await validateSession(second.token)).toBeNull();
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0);
  });

  it("ignores malformed or forged tokens", async () => {
    expect(await validateSession(undefined)).toBeNull();
    expect(await validateSession("x".repeat(500))).toBeNull();
    expect(await validateSession("forged-token")).toBeNull();
  });
});
