import { Badge } from "@/components/ui/primitives";
import type { BatchStatus } from "@/lib/dates";
import { humanize } from "@/lib/format";

const BATCH: Record<BatchStatus, { tone: "success" | "warning" | "danger" | "neutral"; label: string }> = {
  AVAILABLE: { tone: "success", label: "Available" },
  EXPIRING_SOON: { tone: "warning", label: "Expiring soon" },
  EXPIRED: { tone: "danger", label: "Expired" },
  DEPLETED: { tone: "neutral", label: "Depleted" },
};

export function BatchStatusBadge({ status }: { status: BatchStatus }) {
  const s = BATCH[status];
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

const MOVEMENT: Record<string, { tone: "success" | "info" | "danger" | "warning" | "brand"; label: string }> = {
  STOCK_IN: { tone: "success", label: "Stock in" },
  STOCK_OUT: { tone: "info", label: "Issue" },
  WASTE: { tone: "danger", label: "Waste" },
  ADJUSTMENT_IN: { tone: "brand", label: "Adjust +" },
  ADJUSTMENT_OUT: { tone: "warning", label: "Adjust −" },
};

export function MovementBadge({ type }: { type: string }) {
  const m = MOVEMENT[type] ?? { tone: "brand" as const, label: humanize(type) };
  return <Badge tone={m.tone}>{m.label}</Badge>;
}

export function movementSign(type: string): 1 | -1 {
  return type === "STOCK_IN" || type === "ADJUSTMENT_IN" ? 1 : -1;
}

const SEVERITY: Record<string, "neutral" | "info" | "warning" | "danger"> = { LOW: "neutral", MEDIUM: "info", HIGH: "warning", CRITICAL: "danger" };
const INCIDENT_STATUS: Record<string, "info" | "warning" | "success" | "neutral"> = { OPEN: "info", UNDER_REVIEW: "warning", RESOLVED: "success", DISMISSED: "neutral" };

export function SeverityBadge({ severity }: { severity: string }) {
  return <Badge tone={SEVERITY[severity] ?? "neutral"}>{humanize(severity)}</Badge>;
}

export function IncidentStatusBadge({ status }: { status: string }) {
  return <Badge tone={INCIDENT_STATUS[status] ?? "neutral"}>{humanize(status)}</Badge>;
}

export function ActiveBadge({ active, activeLabel = "Active", inactiveLabel = "Inactive" }: { active: boolean; activeLabel?: string; inactiveLabel?: string }) {
  return <Badge tone={active ? "success" : "neutral"}>{active ? activeLabel : inactiveLabel}</Badge>;
}

export function RoleBadge({ role }: { role: string }) {
  return <Badge tone={role === "ADMIN" ? "brand" : "neutral"}>{role === "ADMIN" ? "Admin" : "Staff"}</Badge>;
}

export function daysLabel(days: number): string {
  if (days < 0) return `Expired ${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} ago`;
  if (days === 0) return "Expires today";
  return `${days} day${days === 1 ? "" : "s"} left`;
}
