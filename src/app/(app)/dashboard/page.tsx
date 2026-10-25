import type { Metadata } from "next";
import { requirePageAccess } from "@/server/auth/session";
import { dashboardMetrics } from "@/server/services/inventory.service";
import { recentIncidents } from "@/server/services/incidents.service";
import { logServerError } from "@/lib/errors";
import { addDays, businessToday, formatDate, formatDateTime, toIsoDate } from "@/lib/dates";
import { formatCurrency, formatNumber, humanize } from "@/lib/format";
import { can } from "@/lib/permissions";
import { Alert, ButtonLink, Card, CardHeader, EmptyState, PageHeader, StatCard, Table, TBody, Td, TextLink, Th } from "@/components/ui/primitives";
import { IncidentStatusBadge, MovementBadge, SeverityBadge, movementSign } from "@/components/ui/status";
import { ColumnChart } from "@/components/charts";

export const metadata: Metadata = { title: "Dashboard" };

async function loadIncidents(actor: Parameters<typeof recentIncidents>[0]) {
  try {
    return { rows: await recentIncidents(actor, 5), error: null };
  } catch (error) {
    logServerError("Dashboard incidents", error);
    return { rows: [], error: "Incident reports are unavailable because MongoDB cannot be reached. Inventory data below is unaffected." };
  }
}

export default async function DashboardPage() {
  const user = await requirePageAccess("dashboard:view");
  const [m, incidents] = await Promise.all([dashboardMetrics(user), loadIncidents(user)]);

  // 14-day movement trend with empty days filled in.
  const today = businessToday();
  const days = Array.from({ length: 14 }, (_, i) => toIsoDate(addDays(today, i - 13)));
  const byDay = new Map(m.movementTrend.map((d) => [d.day, d]));

  return (
    <>
      <PageHeader
        title={`Welcome back, ${user.name.split(" ")[0]}`}
        description={`Live inventory overview · ${formatDate(today)} · expiry window ${m.windowDays} days`}
        actions={
          <>
            {can(user.role, "stock:issue") ? <ButtonLink href="/stock/issue">Issue stock</ButtonLink> : null}
            {can(user.role, "purchase:create") ? (
              <ButtonLink href="/purchases/new" variant="secondary">
                Receive stock
              </ButtonLink>
            ) : null}
          </>
        }
      />

      {m.reconciliationIssues > 0 ? (
        <Alert tone="danger" title="Ledger mismatch detected" className="mb-6">
          {m.reconciliationIssues} batch(es) differ from the stock ledger. Check the Database inspector.
        </Alert>
      ) : null}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatCard label="Active medicines" value={formatNumber(m.activeMedicines)} tone="brand" href="/medicines" />
        <StatCard label="Units in stock" value={formatNumber(m.totalUnits)} hint={`${formatNumber(m.usableUnits)} usable (unexpired)`} tone="info" href="/batches" />
        <StatCard label="Low-stock medicines" value={formatNumber(m.lowStock)} hint={`${m.outOfStock} out of stock`} tone="warning" href="/alerts/low-stock" />
        <StatCard label="Expired batches" value={formatNumber(m.expiredBatches)} hint="Still holding stock" tone="danger" href="/alerts/expiry" />
        <StatCard label="Expiring soon" value={formatNumber(m.expiringBatches)} hint={`Within ${m.windowDays} days`} tone="warning" href="/alerts/expiry" />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Stock movement, last 14 days" description="Units received or adjusted in vs. units issued, wasted or adjusted out" />
          <div className="px-5 py-4">
            <ColumnChart
              title="Stock movement, last 14 days"
              categories={days}
              categoryLabel="Date"
              tickLabels={days.map((d, i) => ((13 - i) % 3 === 0 ? formatDate(d).slice(0, 6) : ""))}
              series={[
                { name: "Units in", values: days.map((d) => byDay.get(d)?.unitsIn ?? 0) },
                { name: "Units out", values: days.map((d) => byDay.get(d)?.unitsOut ?? 0) },
              ]}
            />
          </div>
        </Card>

        <Card>
          <CardHeader title="Recent incident reports" actions={<TextLink href="/incidents">View all</TextLink>} />
          {incidents.error ? (
            <div className="p-5">
              <Alert tone="warning">{incidents.error}</Alert>
            </div>
          ) : incidents.rows.length === 0 ? (
            <EmptyState title="No incident reports" description="Damaged stock, discrepancies and storage issues appear here." />
          ) : (
            <ul className="divide-y divide-slate-100">
              {incidents.rows.map((i) => (
                <li key={i.id} className="px-5 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <TextLink href={`/incidents/${i.id}`} className="text-sm">
                      {i.title}
                    </TextLink>
                    <SeverityBadge severity={i.severity} />
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <span className="font-mono">{i.reference}</span>
                    <span>·</span>
                    <span>{humanize(i.type)}</span>
                    <IncidentStatusBadge status={i.status} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader title="Recent stock movements" actions={<TextLink href="/stock/transactions">Open ledger</TextLink>} />
          {m.recentMovements.length === 0 ? (
            <EmptyState title="No stock movements yet" />
          ) : (
            <Table caption="Recent stock movements">
              <thead>
                <tr>
                  <Th>When</Th>
                  <Th>Medicine / batch</Th>
                  <Th>Type</Th>
                  <Th align="right">Qty</Th>
                  <Th align="right">Balance</Th>
                </tr>
              </thead>
              <TBody>
                {m.recentMovements.map((t) => (
                  <tr key={t.id}>
                    <Td className="whitespace-nowrap text-xs text-slate-500">{formatDateTime(t.createdAt)}</Td>
                    <Td>
                      <TextLink href={`/medicines/${t.batch.medicine.id}`}>{t.batch.medicine.name}</TextLink>
                      <div className="font-mono text-xs text-slate-500">{t.batch.batchNumber}</div>
                    </Td>
                    <Td>
                      <MovementBadge type={t.type} />
                    </Td>
                    <Td align="right" className={movementSign(t.type) > 0 ? "text-emerald-700" : "text-slate-900"}>
                      {movementSign(t.type) > 0 ? "+" : "−"}
                      {formatNumber(t.quantity)}
                    </Td>
                    <Td align="right">{formatNumber(t.balanceAfter)}</Td>
                  </tr>
                ))}
              </TBody>
            </Table>
          )}
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="Recent purchases" actions={<TextLink href="/purchases">History</TextLink>} />
          {m.recentPurchases.length === 0 ? (
            <EmptyState title="No purchases recorded" />
          ) : (
            <ul className="divide-y divide-slate-100">
              {m.recentPurchases.map((p) => (
                <li key={p.id} className="flex items-start justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <TextLink href={`/purchases/${p.id}`} className="text-sm">
                      {p.invoiceNumber}
                    </TextLink>
                    <p className="truncate text-xs text-slate-500">
                      {p.supplierName} · {formatDate(p.purchaseDate)}
                    </p>
                  </div>
                  <div className="tabular shrink-0 text-right text-sm">
                    <p className="font-medium text-slate-900">{formatNumber(p.totalUnits)} units</p>
                    {can(user.role, "reports:financial") ? <p className="text-xs text-slate-500">{formatCurrency(p.totalAmount)}</p> : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
