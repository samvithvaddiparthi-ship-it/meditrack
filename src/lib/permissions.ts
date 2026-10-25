/**
 * Role-based access control. This matrix is the single source of truth:
 * server actions, route handlers and services call `assertCan()`, and the
 * UI uses `can()` only to decide which controls to show.
 */
export type Role = "ADMIN" | "STAFF";

export const PERMISSIONS = [
  "dashboard:view",
  "medicine:view",
  "medicine:manage",
  "category:manage",
  "supplier:view",
  "supplier:manage",
  "batch:view",
  "purchase:view",
  "purchase:create",
  "stock:issue",
  "stock:waste",
  "stock:adjust-out",
  "stock:adjust-in",
  "stock:write-off-expired",
  "ledger:view",
  "alerts:view",
  "reports:view",
  "reports:financial",
  "incident:create",
  "incident:view-all",
  "incident:review",
  "user:manage",
  "audit:view",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const STAFF_PERMISSIONS: readonly Permission[] = [
  "dashboard:view",
  "medicine:view",
  "supplier:view",
  "batch:view",
  "purchase:view",
  "purchase:create",
  "stock:issue",
  "stock:waste",
  "stock:adjust-out",
  "ledger:view",
  "alerts:view",
  "reports:view",
  "incident:create",
];

const ROLE_PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  ADMIN: new Set(PERMISSIONS),
  STAFF: new Set(STAFF_PERMISSIONS),
};

export function can(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.has(permission) ?? false;
}

export type Actor = { id: number; role: Role; name: string };
