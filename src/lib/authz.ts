import { ForbiddenError } from "@/lib/errors";
import { can, type Actor, type Permission } from "@/lib/permissions";

/** Throws ForbiddenError unless the actor's role grants the permission. */
export function assertCan(actor: Actor, permission: Permission): void {
  if (!can(actor.role, permission)) {
    throw new ForbiddenError();
  }
}
