import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requirePageAccess } from "@/server/auth/session";
import { getMedicine } from "@/server/services/catalog.service";
import { expiryWindowDays } from "@/server/services/inventory.service";
import { listTransactions } from "@/server/services/stock.service";
import { listIncidents } from "@/server/services/incidents.service";
import { NotFoundError, logServerError } from "@/lib/errors";
import { batchStatus, daysUntil, formatDate, formatDateTime } from "@/lib/dates";
import { can } from "@/lib/permissions";
import { formatCurrency, formatNumber, humanize, num } from "@/lib/format";
import { Alert, ButtonLink, Card, CardBody, CardHeader, DescriptionList, EmptyState, PageHeader, StatCard, Table, TBody, Td, TextLink, Th } from "@/components/ui/primitives";
import { ActiveBadge, BatchStatusBadge, IncidentStatusBadge, MovementBadge, SeverityBadge, daysLabel, movementSign } from "@/components/ui/status";
import { ActionButton } from "@/components/ui/action-button";
import { Pagination, intParam, type SearchParams } from "@/components/ui/list";
import { Notice } from "@/components/ui/notice";
import { deleteMedicineAction, toggleMedicineAction } from "../actions";

export const metadata: Metadata = { title: "Medicine details" };

export default async function MedicinePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SearchParams> }) {
  const user = await requirePageAccess("medicine:view");
  const id = Number((await params).id);
  const sp = await searchParams;
  if (!Number.isInteger(id) || id <= 0) notFound();
  const data = await getMedicine(user, id).catch((e) => (e instanceof NotFoundError ? null : Promise.reject(e)));
  if (!data) notFound();
  const { medicine: m, summary } = data;
  const window = expiryWindowDays();
  const page = intParam(sp.page) ?? 1;
  const [ledger, incidents] = await Promise.all([
    listTransactions(user, { medicineId: id, page, pageSize: 15 }),
    listIncidents(user, { medicineId: id, pageSize: 5 }).catch((error) => {
      logServerError("Medicine incidents", error);
      return null;
    }),
  ]);
  const manage = can(user.role, "medicine:manage");

  return (
    <>
      <PageHeader
        title={`${m.name} ${m.strength}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <ActiveBadge active={m.isActive} />
            <span>
              {humanize(m.dosageForm)} · {m.manufacturer} · {m.category.name}
            </span>
          </span>
        }
        actions={
          manage ? (
            <>
              <ButtonLink href={`/medicines/${m.id}/edit`} variant="secondary">
                Edit
              </ButtonLink>
              <ActionButton
                action={toggleMedicineAction.bind(null, m.id, !m.isActive)}
                label={m.isActive ? "Deactivate" : "Reactivate"}
                variant={m.isActive ? "warning" : "primary"}
                confirm={{
                  title: m.isActive ? "Deactivate this medicine?" : "Reactivate this medicine?",
                  message: m.isActive
                    ? "It will no longer be available for receipts or issues. All batches and stock history are kept."
                    : "It will be available again for receipts and issues.",
                  confirmLabel: m.isActive ? "Deactivate" : "Reactivate",
                }}
              />
              {m.batches.length === 0 ? (
                <ActionButton
                  action={deleteMedicineAction.bind(null, m.id)}
                  label="Delete"
                  variant="danger"
                  confirm={{ title: "Delete this medicine?", message: "It has no batches or history, so it can be permanently removed.", confirmLabel: "Delete" }}
                />
              ) : null}
            </>
          ) : null
        }
      />
      <Notice params={sp} />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Usable stock" value={`${formatNumber(summary.usableQuantity)} ${m.unit}`} tone={summary.isLowStock ? "warning" : "success"} hint={summary.isLowStock ? "At or below reorder level" : "Above reorder level"} />
        <StatCard label="Reorder level" value={formatNumber(m.reorderLevel)} tone="neutral" />
        <StatCard label="Expired stock" value={formatNumber(summary.expiredQuantity)} tone={summary.expiredQuantity > 0 ? "danger" : "neutral"} hint="Must be written off as waste" />
        <StatCard label="Next expiry" value={formatDate(summary.nextExpiry)} tone="info" hint={summary.nextExpiry ? daysLabel(daysUntil(summary.nextExpiry)) : "No usable stock"} />
      </div>

      <Card className="mt-6">
        <CardHeader title="Details" />
        <CardBody>
          <DescriptionList
            items={[
              { label: "Generic name", value: m.genericName ?? "—" },
              { label: "Stock unit", value: m.unit },
              { label: "Storage", value: humanize(m.storageCondition) },
              { label: "Description", value: m.description ?? "—" },
              { label: "Created", value: formatDateTime(m.createdAt) },
              { label: "Last updated", value: formatDateTime(m.updatedAt) },
            ]}
          />
        </CardBody>
      </Card>

      <Card className="mt-6">
        <CardHeader title="Batches" description={`Status is derived from today's date (expiring-soon window: ${window} days)`} actions={<TextLink href={`/batches?medicine=${m.id}`}>Open in batch inventory</TextLink>} />
        {m.batches.length === 0 ? (
          <EmptyState title="No batches yet" description="Batches are created when stock is received." action={can(user.role, "purchase:create") && m.isActive ? <ButtonLink href="/purchases/new">Receive stock</ButtonLink> : undefined} />
        ) : (
          <Table caption="Batches">
            <thead>
              <tr>
                <Th>Batch</Th>
                <Th>Manufactured</Th>
                <Th>Expiry</Th>
                <Th align="right">Quantity</Th>
                {can(user.role, "reports:financial") ? <Th align="right">Unit cost</Th> : null}
                <Th>Status</Th>
              </tr>
            </thead>
            <TBody>
              {m.batches.map((b) => {
                const status = batchStatus(b.quantity, b.expiryDate, window);
                return (
                  <tr key={b.id}>
                    <Td>
                      <TextLink href={`/batches/${b.id}`} className="font-mono">
                        {b.batchNumber}
                      </TextLink>
                    </Td>
                    <Td>{formatDate(b.manufactureDate)}</Td>
                    <Td>
                      {formatDate(b.expiryDate)}
                      <div className="text-xs text-slate-500">{daysLabel(daysUntil(b.expiryDate))}</div>
                    </Td>
                    <Td align="right" className="font-medium text-slate-900">
                      {formatNumber(b.quantity)}
                    </Td>
                    {can(user.role, "reports:financial") ? <Td align="right">{formatCurrency(num(b.unitCost))}</Td> : null}
                    <Td>
                      <BatchStatusBadge status={status} />
                    </Td>
                  </tr>
                );
              })}
            </TBody>
          </Table>
        )}
      </Card>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Stock movement history" description="From the append-only stock ledger" />
          {ledger.rows.length === 0 ? (
            <EmptyState title="No stock movements" />
          ) : (
            <Table caption="Stock movements">
              <thead>
                <tr>
                  <Th>When</Th>
                  <Th>Type</Th>
                  <Th>Batch</Th>
                  <Th align="right">Qty</Th>
                  <Th align="right">Balance</Th>
                  <Th>By</Th>
                </tr>
              </thead>
              <TBody>
                {ledger.rows.map((t) => (
                  <tr key={t.id}>
                    <Td className="whitespace-nowrap text-xs text-slate-500">{formatDateTime(t.createdAt)}</Td>
                    <Td>
                      <MovementBadge type={t.type} />
                    </Td>
                    <Td className="font-mono text-xs">{t.batch.batchNumber}</Td>
                    <Td align="right">
                      {movementSign(t.type) > 0 ? "+" : "−"}
                      {formatNumber(t.quantity)}
                    </Td>
                    <Td align="right">{formatNumber(t.balanceAfter)}</Td>
                    <Td className="text-xs">{t.performedBy.name}</Td>
                  </tr>
                ))}
              </TBody>
            </Table>
          )}
          <Pagination pathname={`/medicines/${m.id}`} params={sp} page={ledger.page} pageSize={ledger.pageSize} total={ledger.total} />
        </Card>

        <Card>
          <CardHeader title="Incident reports" description="From MongoDB" actions={<TextLink href={`/incidents?medicine=${m.id}`}>All</TextLink>} />
          {incidents === null ? (
            <div className="p-5">
              <Alert tone="warning">Incident reports are unavailable (MongoDB unreachable).</Alert>
            </div>
          ) : incidents.rows.length === 0 ? (
            <EmptyState title="No incidents reported" />
          ) : (
            <ul className="divide-y divide-slate-100">
              {incidents.rows.map((i) => (
                <li key={i.id} className="px-5 py-3">
                  <TextLink href={`/incidents/${i.id}`} className="text-sm">
                    {i.title}
                  </TextLink>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    <SeverityBadge severity={i.severity} />
                    <IncidentStatusBadge status={i.status} />
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
