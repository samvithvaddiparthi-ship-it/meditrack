import "server-only";
import { prisma } from "@/lib/db";
import { assertCan } from "@/lib/authz";
import { ConflictError, NotFoundError, ValidationError, isUniqueViolation } from "@/lib/errors";
import type { Actor } from "@/lib/permissions";
import { parseInput } from "@/lib/validation/common";
import { createUserSchema, resetPasswordSchema, updateUserSchema } from "@/lib/validation/schemas";
import { hashPassword } from "@/server/auth/password";
import { enqueueAudit, flushOutbox } from "@/server/services/audit.service";
import { runTransaction } from "@/server/services/tx";

const publicUserFields = {
  id: true,
  name: true,
  email: true,
  role: true,
  isActive: true,
  lastLoginAt: true,
  lockedUntil: true,
  createdAt: true,
} as const;

export async function listUsers(actor: Actor) {
  assertCan(actor, "user:manage");
  const users = await prisma.user.findMany({
    select: { ...publicUserFields, _count: { select: { stockTransactions: true } } },
    orderBy: [{ isActive: "desc" }, { role: "asc" }, { name: "asc" }],
  });
  return users;
}

export async function getUser(actor: Actor, id: number) {
  assertCan(actor, "user:manage");
  const user = await prisma.user.findUnique({ where: { id }, select: publicUserFields });
  if (!user) throw new NotFoundError("User not found.");
  return user;
}

export async function createUser(actor: Actor, input: unknown) {
  assertCan(actor, "user:manage");
  const data = parseInput(createUserSchema, input);
  const passwordHash = await hashPassword(data.password);
  try {
    const user = await runTransaction(async (tx) => {
      const created = await tx.user.create({
        data: { name: data.name, email: data.email, role: data.role, passwordHash },
        select: publicUserFields,
      });
      await enqueueAudit(tx, {
        action: "user.create",
        entityType: "user",
        entityId: created.id,
        summary: `Created ${created.role.toLowerCase()} account for ${created.name}`,
        actor,
        details: { email: created.email, role: created.role },
      });
      return created;
    });
    await flushOutbox();
    return user;
  } catch (error) {
    if (isUniqueViolation(error, "uq_users_email")) {
      throw new ValidationError("An account with this email already exists.", { email: ["Already registered."] });
    }
    throw error;
  }
}

/**
 * Updates name / role / active flag. Admins cannot demote or deactivate
 * themselves, and the last active admin can never be removed. Deactivation
 * revokes all of the user's sessions immediately.
 */
export async function updateUser(actor: Actor, id: number, input: unknown) {
  assertCan(actor, "user:manage");
  const data = parseInput(updateUserSchema, input);
  const user = await runTransaction(async (tx) => {
    const current = await tx.user.findUnique({ where: { id } });
    if (!current) throw new NotFoundError("User not found.");
    if (id === actor.id && (data.role !== current.role || !data.isActive)) {
      throw new ConflictError("You cannot change your own role or deactivate your own account.");
    }
    const removesAdmin = current.role === "ADMIN" && current.isActive && (data.role !== "ADMIN" || !data.isActive);
    if (removesAdmin) {
      const [{ admins }] = await tx.$queryRaw<{ admins: bigint }[]>`
        SELECT COUNT(*) AS admins FROM users WHERE role = 'ADMIN' AND is_active = TRUE AND id <> ${id} FOR UPDATE`;
      if (Number(admins) === 0) throw new ConflictError("At least one active administrator is required.");
    }
    const updated = await tx.user.update({
      where: { id },
      data: { name: data.name, role: data.role, isActive: data.isActive },
      select: publicUserFields,
    });
    if (!data.isActive || data.role !== current.role) {
      await tx.session.deleteMany({ where: { userId: id } });
    }
    await enqueueAudit(tx, {
      action: "user.update",
      entityType: "user",
      entityId: id,
      summary: `Updated account ${updated.name}`,
      actor,
      details: {
        roleChanged: current.role !== updated.role ? { from: current.role, to: updated.role } : undefined,
        activeChanged: current.isActive !== updated.isActive ? { from: current.isActive, to: updated.isActive } : undefined,
      },
    });
    return updated;
  });
  await flushOutbox();
  return user;
}

export async function resetUserPassword(actor: Actor, id: number, input: unknown) {
  assertCan(actor, "user:manage");
  const { password } = parseInput(resetPasswordSchema, input);
  const passwordHash = await hashPassword(password);
  await runTransaction(async (tx) => {
    const user = await tx.user.update({
      where: { id },
      data: { passwordHash, failedLoginCount: 0, lockedUntil: null },
    }).catch((error: unknown) => {
      if ((error as { code?: string }).code === "P2025") throw new NotFoundError("User not found.");
      throw error;
    });
    await tx.session.deleteMany({ where: { userId: id } });
    await enqueueAudit(tx, {
      action: "user.reset_password",
      entityType: "user",
      entityId: id,
      summary: `Reset the password of ${user.name}`,
      actor,
    });
  });
  await flushOutbox();
}

export async function listUserOptions() {
  const users = await prisma.user.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } });
  return users.map((u) => ({ id: u.id, label: u.name }));
}
