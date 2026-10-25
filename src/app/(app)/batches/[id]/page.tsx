import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requirePageAccess } from "@/server/auth/session";
import { getBatch } from "@/server/services/inventory.service";
import { listTransactions } from "@/server/services/stock.service";
import { NotFoundError } from "@/lib/errors";
import { daysUntil, formatDate, formatDateTime } from "@/lib/dates";
import { can } from "@/lib/permissions";
import { formatCurrency, formatNumber, num } from "@/lib/format";
import { ButtonLink, Card, CardBody, CardHeader, DescriptionList, EmptyState, PageHeader, Table, TBody, Td, TextLink, Th } from "@/components/ui/primitives";
import { BatchStatusBadge, MovementBadge, daysLabel, movementSign } from "@/components/ui/status";
import { Pagination, intParam, type SearchParams } from "@/components/ui/list";

export const metadata: Metadata = { title: "Batch details" };

export default async function BatchPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SearchParams> }) {
  const user = await requirePageAccess("batch:view");
  const id = Number((await params).id);
  const sp = await searchParams;
  if (!Number.isInteger(id) || id <= 0) notFound();
  const data = await getBatch(user, id).catch((e) => (e instanceof NotFoundError ? null : Promise.reject(e)));
  if (!data) notFound();
  const { batch: b, status } = data;
  const ledger = await listTransactions(user, { batchId: id, page: intParam(sp.page) ?? 1, pageSize: 20 });
  const financial = can(user.role, "reports:financial");

  return (
    <>
      <PageHeader
        title={`Batch ${b.batchNumber}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <BatchStatusBadge status={status} />
            <TextLink href={`/medicines/${b.medicineId}`}>
              {b.medicine.name} {b.medicine.strength}
            </TextLink>
          </span>
        }
        actions={
          b.quantity > 0 && can(user.role, "stock:waste") ? (
            <ButtonLink href={`/stock/waste?batch=${b.id}`} variant="secondary">
              Record waste / adjustment
            </ButtonLink>
          ) : null
        }
      />
      <Card>
        <CardBody>
          <DescriptionList
            items={[
              { label: "On hand", value: <span className="text-lg font-semibold">{`${formatNumber(b.quantity)} ${b.medicine.unit}`}</span> },
              { label: "Manufactured", value: formatDate(b.manufactureDate) },
              { label: "Expiry", value: `${formatDate(b.expiryDate)} · ${daysLabel(daysUntil(b.expiryDate))}` },
              { label: "Category", value: b.medicine.category.name },
              ...(financial ? [{ label: "Unit cost (first receipt)", value: formatCurrency(num(b.unitCost)) }] : []),
              { label: "Received", value: formatDateTime(b.createdAt) },
            ]}
          />
        </CardBody>
      </Card>
      <Card className="mt-6">
        <CardHeader title="Received through" />
        <Table caption="Purchases for this batch">
          <thead>
            <tr>
              <Th>Invoice</Th>
              <Th>Supplier</Th>
              <Th>Purchase date</Th>
              <Th align="right">Quantity</Th>
              {financial ? <Th align="right">Unit cost</Th> : null}
            </tr>
          </thead>
          <TBody>
            {b.purchaseItems.map((pi) => (
              <tr key={pi.id}>
                <Td>
                  <TextLink href={`/purchases/${pi.purchaseId}`}>{pi.purchase.invoiceNumber}</TextLink>
                </Td>
                <Td>{pi.purchase.supplier.name}</Td>
                <Td>{formatDate(pi.purchase.purchaseDate)}</Td>
                <Td align="right">{formatNumber(pi.quantity)}</Td>
                {financial ? <Td align="right">{formatCurrency(num(pi.unitCost))}</Td> : null}
              </tr>
            ))}
          </TBody>
        </Table>
      </Card>
      <Card className="mt-6">
        <CardHeader title="Ledger for this batch" description="Each row was validated and applied by the trg_stock_transactions_before_insert trigger; balance_after is stamped by the trigger." />
        {ledger.rows.length === 0 ? (
          <EmptyState title="No movements" />
        ) : (
          <Table caption="Batch ledger">
            <thead>
              <tr>
                <Th>When</Th>
                <Th>Type</Th>
                <Th align="right">Qty</Th>
                <Th align="right">Balance after</Th>
                <Th>Reference</Th>
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
                  <Td align="right">
                    {movementSign(t.type) > 0 ? "+" : "−"}
                    {formatNumber(t.quantity)}
                  </Td>
                  <Td align="right" className="font-medium text-slate-900">
                    {formatNumber(t.balanceAfter)}
                  </Td>
                  <Td className="text-xs">
                    {t.purchaseItem ? (
                      <TextLink href={`/purchases/${t.purchaseItem.purchaseId}`}>{t.purchaseItem.purchase.invoiceNumber}</TextLink>
                    ) : t.operation ? (
                      <TextLink href={`/stock/operations/${t.operation.id}`}>{`Operation #${t.operation.id}`}</TextLink>
                    ) : (
                      "—"
                    )}
                  </Td>
                  <Td className="text-xs">{t.performedBy.name}</Td>
                </tr>
              ))}
            </TBody>
          </Table>
        )}
        <Pagination pathname={`/batches/${b.id}`} params={sp} page={ledger.page} pageSize={ledger.pageSize} total={ledger.total} />
      </Card>
    </>
  );
}
