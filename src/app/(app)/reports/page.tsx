import type { Metadata } from "next";
import { requirePageAccess } from "@/server/auth/session";
import { inventoryReports } from "@/server/services/inventory.service";
import { incidentSummary } from "@/server/services/incidents.service";
import { logServerError } from "@/lib/errors";
import { formatCurrency, formatNumber, humanize } from "@/lib/format";
import { Alert, Badge, Card, CardBody, CardHeader, EmptyState, PageHeader, StatCard, Table, TBody, Td, TextLink, Th } from "@/components/ui/primitives";
import { BarList, ColumnChart } from "@/components/charts";

export const metadata: Metadata = { title: "Reports" };

function SqlNote({ children }: { children: React.ReactNode }) {
  return <p className="mt-0.5 font-mono text-[11px] text-slate-400">{children}</p>;
}

export default async function ReportsPage() {
  const user = await requirePageAccess("reports:view");
  const [r, incidents] = await Promise.all([
    inventoryReports(user),
    incidentSummary(user).catch((error) => {
      logServerError("Reports incident summary", error);
      return null;
    }),
  ]);
  const monthLabel = (m: string) => new Intl.DateTimeFormat("en-IN", { month: "short", year: "2-digit", timeZone: "UTC" }).format(new Date(`${m}-01T00:00:00Z`));

  return (
    <>
      <PageHeader
        title="Inventory reports"
        description={r.financial ? "Computed live from MySQL (aggregations, joins, HAVING, subqueries) and MongoDB (aggregation pipeline)." : "Computed live from the databases. Monetary values are visible to administrators only."}
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Batches checked" value={formatNumber(r.reconciliation.batches)} tone="brand" hint="v_stock_reconciliation" />
        <StatCard
          label="Ledger mismatches"
          value={formatNumber(r.reconciliation.mismatched)}
          tone={r.reconciliation.mismatched === 0 ? "success" : "danger"}
          hint={r.reconciliation.mismatched === 0 ? "Batch quantities equal the ledger" : "Investigate immediately"}
        />
        <StatCard label="Usable units" value={formatNumber(r.byCategory.reduce((s, c) => s + c.usableUnits, 0))} tone="info" />
        {r.financial ? (
          <StatCard label="Usable stock value" value={formatCurrency(r.byCategory.reduce((s, c) => s + (c.usableValue ?? 0), 0))} tone="success" />
        ) : (
          <StatCard label="Expired units on hand" value={formatNumber(r.byCategory.reduce((s, c) => s + c.expiredUnits, 0))} tone="danger" />
        )}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Monthly stock movement" description={<><span>Units in, out and wasted per month (last 6 months)</span><SqlNote>GROUP BY DATE_FORMAT(fn_business_date(created_at), &apos;%Y-%m&apos;)</SqlNote></>} />
          <CardBody>
            {r.monthlyMovements.length === 0 ? (
              <EmptyState title="No movements yet" />
            ) : (
              <ColumnChart
                title="Monthly stock movement"
                categories={r.monthlyMovements.map((m) => m.month)}
                tickLabels={r.monthlyMovements.map((m) => monthLabel(m.month))}
                categoryLabel="Month"
                series={[
                  { name: "Units in", values: r.monthlyMovements.map((m) => m.unitsIn) },
                  { name: "Units out", values: r.monthlyMovements.map((m) => m.unitsOut) },
                  { name: "Units wasted", values: r.monthlyMovements.map((m) => m.unitsWasted) },
                ]}
              />
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Most issued medicines (90 days)" description={<><span>Top 10 by units issued</span><SqlNote>JOIN batches, medicines · GROUP BY · ORDER BY SUM(quantity) DESC LIMIT 10</SqlNote></>} />
          <CardBody>
            {r.topIssued.length === 0 ? (
              <EmptyState title="Nothing issued in the last 90 days" />
            ) : (
              <BarList title="Most issued medicines" categoryLabel="Medicine" valueLabel="Units issued" rows={r.topIssued.map((t) => ({ label: t.name, value: t.unitsIssued, hint: `${t.issues} issue(s)` }))} />
            )}
          </CardBody>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader title="Stock by category" description={<><span>Active medicines only</span><SqlNote>SELECT category_name, COUNT(*), SUM(usable_quantity) … FROM v_inventory_summary GROUP BY category_name</SqlNote></>} />
        <Table caption="Stock by category">
          <thead>
            <tr>
              <Th>Category</Th>
              <Th align="right">Medicines</Th>
              <Th align="right">Usable units</Th>
              <Th align="right">Expired units</Th>
              {r.financial ? <Th align="right">Usable value</Th> : null}
            </tr>
          </thead>
          <TBody>
            {r.byCategory.map((c) => (
              <tr key={c.category}>
                <Td>{c.category}</Td>
                <Td align="right">{c.medicines}</Td>
                <Td align="right">{formatNumber(c.usableUnits)}</Td>
                <Td align="right" className={c.expiredUnits > 0 ? "text-red-600" : undefined}>
                  {formatNumber(c.expiredUnits)}
                </Td>
                {r.financial ? <Td align="right">{formatCurrency(c.usableValue)}</Td> : null}
              </tr>
            ))}
          </TBody>
        </Table>
      </Card>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Purchases by supplier" description={<><span>Suppliers above the average spend are flagged</span><SqlNote>GROUP BY supplier · HAVING COUNT(*) ≥ 1 · SUM(amount) &gt; (SELECT AVG(…) FROM (…) t)</SqlNote></>} />
          <Table caption="Purchases by supplier">
            <thead>
              <tr>
                <Th>Supplier</Th>
                <Th align="right">Purchases</Th>
                <Th align="right">Units</Th>
                {r.financial ? <Th align="right">Amount</Th> : null}
              </tr>
            </thead>
            <TBody>
              {r.supplierTotals.map((s) => (
                <tr key={s.supplierId}>
                  <Td>
                    <TextLink href={`/suppliers/${s.supplierId}`}>{s.supplierName}</TextLink>{" "}
                    {s.aboveAverage ? <Badge tone="brand">Above average</Badge> : null}
                  </Td>
                  <Td align="right">{s.purchases}</Td>
                  <Td align="right">{formatNumber(s.totalUnits)}</Td>
                  {r.financial ? <Td align="right">{formatCurrency(s.totalAmount)}</Td> : null}
                </tr>
              ))}
            </TBody>
          </Table>
        </Card>
        <Card>
          <CardHeader title="Wastage by medicine" description={<><span>All-time write-offs</span><SqlNote>JOIN … AND t.type = &apos;WASTE&apos; GROUP BY medicine HAVING SUM(t.quantity) &gt; 0</SqlNote></>} />
          {r.wasteByMedicine.length === 0 ? (
            <EmptyState title="No waste recorded" />
          ) : (
            <Table caption="Wastage by medicine">
              <thead>
                <tr>
                  <Th>Medicine</Th>
                  <Th align="right">Units</Th>
                  {r.financial ? <Th align="right">Value</Th> : null}
                </tr>
              </thead>
              <TBody>
                {r.wasteByMedicine.map((w) => (
                  <tr key={w.name}>
                    <Td>{w.name}</Td>
                    <Td align="right">{formatNumber(w.units)}</Td>
                    {r.financial ? <Td align="right">{formatCurrency(w.value)}</Td> : null}
                  </tr>
                ))}
              </TBody>
            </Table>
          )}
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Slow movers" description={<><span>In stock but not issued in 60 days</span><SqlNote>WHERE NOT EXISTS (SELECT 1 FROM stock_transactions … type = &apos;STOCK_OUT&apos; …)</SqlNote></>} />
          {r.neverIssued.length === 0 ? (
            <EmptyState title="Every stocked medicine moved recently" />
          ) : (
            <ul className="divide-y divide-slate-100">
              {r.neverIssued.map((n) => (
                <li key={n.medicineId} className="flex justify-between px-5 py-2.5 text-sm">
                  <TextLink href={`/medicines/${n.medicineId}`}>{n.name}</TextLink>
                  <span className="tabular text-slate-600">{formatNumber(n.usableQuantity)} on hand</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader title="Incident reports" description={<><span>MongoDB aggregation pipeline</span><SqlNote>$match → $facet {"{"} byStatus: [$group], monthly: [$group by $dateToString] {"}"}</SqlNote></>} />
          <CardBody>
            {incidents === null ? (
              <Alert tone="warning">MongoDB is unreachable, so incident statistics cannot be shown right now.</Alert>
            ) : (
              <>
                <BarList title="Incident reports by status" categoryLabel="Status" valueLabel="Reports" rows={incidents.byStatus.map((s) => ({ label: humanize(s.key), value: s.count }))} />
                <h3 className="mb-2 mt-6 text-xs font-semibold uppercase tracking-wide text-slate-500">Reports per month</h3>
                <ColumnChart
                  title="Incident reports per month"
                  categories={incidents.monthly.map((m) => m.month)}
                  tickLabels={incidents.monthly.map((m) => monthLabel(m.month))}
                  categoryLabel="Month"
                  height={120}
                  series={[
                    { name: "All reports", values: incidents.monthly.map((m) => m.count) },
                    { name: "High / critical", values: incidents.monthly.map((m) => m.highOrCritical) },
                  ]}
                />
              </>
            )}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
