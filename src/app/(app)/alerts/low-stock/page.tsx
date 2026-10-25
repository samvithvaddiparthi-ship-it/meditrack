import type { Metadata } from "next";
import { requirePageAccess } from "@/server/auth/session";
import { depletionAndWaste, lowStockAlerts } from "@/server/services/inventory.service";
import { formatDate, formatDateTime } from "@/lib/dates";
import { can } from "@/lib/permissions";
import { formatCurrency, formatNumber, humanize } from "@/lib/format";
import { ButtonLink, Card, CardHeader, EmptyState, PageHeader, StatCard, Table, TBody, Td, TextLink, Th } from "@/components/ui/primitives";
import { Badge } from "@/components/ui/status-exports";

export const metadata: Metadata = { title: "Low stock" };

export default async function LowStockPage() {
  const user = await requirePageAccess("alerts:view");
  const [low, depletion] = await Promise.all([lowStockAlerts(user), depletionAndWaste(user, 90)]);
  const financial = can(user.role, "reports:financial");
  const out = low.filter((l) => l.outOfStock);

  return (
    <>
      <PageHeader
        title="Low stock, depleted & waste"
        description="Low stock compares each active medicine's usable (unexpired) quantity with its reorder level — view v_low_stock_medicines."
        actions={can(user.role, "purchase:create") ? <ButtonLink href="/purchases/new">Receive stock</ButtonLink> : null}
      />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="At / below reorder level" value={low.length} tone="warning" />
        <StatCard label="Out of stock" value={out.length} tone="danger" hint="No usable units" />
        <StatCard label="Depleted batches" value={depletion.depletedBatches.length} tone="neutral" />
        <StatCard label={`Wasted, last ${depletion.days} days`} value={formatNumber(depletion.wasteByReason.reduce((s, w) => s + w.units, 0))} tone="danger" hint="units" />
      </div>

      <Card className="mt-6">
        <CardHeader title={`Low-stock medicines (${low.length})`} />
        {low.length === 0 ? (
          <EmptyState title="All medicines are above their reorder level" />
        ) : (
          <Table caption="Low-stock medicines">
            <thead>
              <tr>
                <Th>Medicine</Th>
                <Th align="right">Usable</Th>
                <Th align="right">Reorder level</Th>
                <Th align="right">Shortfall</Th>
                <Th>Next expiry</Th>
                <Th>Last supplier</Th>
                <Th>Action</Th>
              </tr>
            </thead>
            <TBody>
              {low.map((l) => (
                <tr key={l.medicineId}>
                  <Td>
                    <TextLink href={`/medicines/${l.medicineId}`}>
                      {l.medicineName} {l.strength}
                    </TextLink>
                    <div className="text-xs text-slate-500">{l.categoryName}</div>
                  </Td>
                  <Td align="right">
                    <span className="font-medium text-slate-900">{formatNumber(l.usableQuantity)}</span> <span className="text-xs text-slate-500">{l.unit}</span>
                    {l.expiredQuantity > 0 ? <div className="text-xs text-red-600">{formatNumber(l.expiredQuantity)} expired (not counted)</div> : null}
                  </Td>
                  <Td align="right">{formatNumber(l.reorderLevel)}</Td>
                  <Td align="right">{formatNumber(l.shortfall)}</Td>
                  <Td>{formatDate(l.nextExpiry)}</Td>
                  <Td className="text-xs">{l.lastSupplier ?? "—"}</Td>
                  <Td>{l.outOfStock ? <Badge tone="danger">Out of stock · reorder now</Badge> : <Badge tone="warning">Reorder</Badge>}</Td>
                </tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Depleted batches" description="Batches whose quantity reached zero" />
          {depletion.depletedBatches.length === 0 ? (
            <EmptyState title="No depleted batches" />
          ) : (
            <Table caption="Depleted batches">
              <thead>
                <tr>
                  <Th>Medicine</Th>
                  <Th>Batch</Th>
                  <Th>Last movement</Th>
                </tr>
              </thead>
              <TBody>
                {depletion.depletedBatches.map((d) => (
                  <tr key={d.batchId}>
                    <Td>
                      <TextLink href={`/medicines/${d.medicineId}`}>{d.medicineName}</TextLink>
                    </Td>
                    <Td>
                      <TextLink href={`/batches/${d.batchId}`} className="font-mono text-xs">
                        {d.batchNumber}
                      </TextLink>
                    </Td>
                    <Td className="text-xs text-slate-500">{formatDateTime(d.lastMovement)}</Td>
                  </tr>
                ))}
              </TBody>
            </Table>
          )}
        </Card>
        <Card>
          <CardHeader title={`Waste & damaged stock (last ${depletion.days} days)`} />
          {depletion.wasteByReason.length === 0 ? (
            <EmptyState title="No waste recorded recently" />
          ) : (
            <Table caption="Waste by reason">
              <thead>
                <tr>
                  <Th>Reason</Th>
                  <Th align="right">Write-offs</Th>
                  <Th align="right">Units</Th>
                  {financial ? <Th align="right">Value</Th> : null}
                </tr>
              </thead>
              <TBody>
                {depletion.wasteByReason.map((w) => (
                  <tr key={w.reason}>
                    <Td>{humanize(w.reason)}</Td>
                    <Td align="right">{w.operations}</Td>
                    <Td align="right">{formatNumber(w.units)}</Td>
                    {financial ? <Td align="right">{formatCurrency(w.value)}</Td> : null}
                  </tr>
                ))}
              </TBody>
            </Table>
          )}
          {depletion.recentWaste.length > 0 ? (
            <ul className="divide-y divide-slate-100 border-t border-slate-100">
              {depletion.recentWaste.map((t) => (
                <li key={t.id} className="flex items-start justify-between gap-3 px-5 py-2.5 text-sm">
                  <div>
                    <TextLink href={`/stock/operations/${t.operationId}`}>
                      {t.batch.medicine.name} {t.batch.medicine.strength}
                    </TextLink>
                    <p className="text-xs text-slate-500">
                      {t.batch.batchNumber} · {humanize(t.operation?.reason)} · {t.performedBy.name}
                    </p>
                  </div>
                  <div className="tabular shrink-0 text-right">
                    <p className="font-medium">−{formatNumber(t.quantity)}</p>
                    <p className="text-xs text-slate-500">{formatDateTime(t.createdAt)}</p>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
        </Card>
      </div>
    </>
  );
}
