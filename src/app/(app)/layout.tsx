import { requireUser } from "@/server/auth/session";
import { can } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { expiryWindowDays } from "@/server/services/inventory.service";
import { Sidebar, type NavGroup } from "@/components/layout/sidebar";
import { RoleBadge } from "@/components/ui/status";
import { logoutAction } from "@/server/actions/auth";

// Every page shows live, per-user inventory data.
export const dynamic = "force-dynamic";

async function alertCounts(windowDays: number) {
  const [row] = await prisma.$queryRaw<{ expiry: bigint; low: bigint }[]>`
    SELECT
      (SELECT COUNT(*) FROM medicine_batches
        WHERE quantity > 0 AND expiry_date <= fn_business_today() + INTERVAL ${windowDays} DAY) AS expiry,
      (SELECT COUNT(*) FROM v_low_stock_medicines) AS low`;
  return { expiry: Number(row.expiry), low: Number(row.low) };
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const counts = await alertCounts(expiryWindowDays());
  const admin = can(user.role, "user:manage");

  const groups: NavGroup[] = [
    { title: "Overview", items: [{ href: "/dashboard", label: "Dashboard" }] },
    {
      title: "Inventory",
      items: [
        { href: "/medicines", label: "Medicines" },
        { href: "/batches", label: "Batch inventory" },
        { href: "/purchases/new", label: "Receive stock" },
        { href: "/purchases", label: "Purchase history" },
        { href: "/stock/issue", label: "Issue stock" },
        { href: "/stock/waste", label: "Waste & adjustments" },
        { href: "/stock/transactions", label: "Stock ledger" },
      ],
    },
    {
      title: "Alerts",
      items: [
        { href: "/alerts/expiry", label: "Expiry alerts", badge: counts.expiry, badgeTone: "danger" },
        { href: "/alerts/low-stock", label: "Low stock", badge: counts.low, badgeTone: "warning" },
      ],
    },
    {
      title: "Operations",
      items: [
        { href: "/suppliers", label: "Suppliers" },
        { href: "/incidents", label: "Incident reports" },
        { href: "/reports", label: "Reports" },
      ],
    },
  ];
  if (admin) {
    groups.push({
      title: "Administration",
      items: [
        { href: "/admin/users", label: "Users & roles" },
        { href: "/medicines/categories", label: "Categories" },
        { href: "/admin/activity", label: "Activity log" },
        { href: "/admin/database", label: "Database inspector" },
      ],
    });
  }

  const footer = (
    <div className="flex items-center justify-between gap-2 px-2">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-slate-900">{user.name}</p>
        <div className="mt-0.5 flex items-center gap-2">
          <RoleBadge role={user.role} />
        </div>
      </div>
      <form action={logoutAction}>
        <button type="submit" className="whitespace-nowrap rounded-lg px-2.5 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900">
          Sign out
        </button>
      </form>
    </div>
  );

  return (
    <div className="min-h-screen">
      <Sidebar groups={groups} footer={footer} />
      <main className="lg:pl-64">
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</div>
      </main>
    </div>
  );
}
