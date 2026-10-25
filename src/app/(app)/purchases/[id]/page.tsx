import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requirePageAccess } from "@/server/auth/session";
import { getPurchase } from "@/server/services/purchases.service";
import { NotFoundError } from "@/lib/errors";
import { formatDate, formatDateTime } from "@/lib/dates";
import { can } from "@/lib/permissions";
import { formatCurrency, formatNumber, num } from "@/lib/format";
import { Card, CardBody, CardHeader, DescriptionList, PageHeader, Table, TBody, Td, TextLink, Th } from "@/components/ui/primitives";
import { Notice } from "@/components/ui/notice";
import type { SearchParams } from "@/components/ui/list";

export const metadata: Metadata = { title: "Purchase details" };

export default async function PurchasePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SearchParams> }) {
  const user = await requirePageAccess("purchase:view");
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const p = await getPurchase(user, id).catch((e) => (e instanceof NotFoundError ? null : Promise.reject(e)));
  if (!p) notFound();
  const financial = can(user.role, "reports:financial");
  return (
    <>
      <PageHeader title={`Invoice ${p.invoiceNumber}`} description={`Purchase #${p.id} from ${p.supplier.name}`} />
      <Notice params={await searchParams} />
      <Card>
        <CardBody>
          <DescriptionList
            items={[
              { label: "Supplier", value: <TextLink href={`/suppliers/${p.supplierId}`}>{p.supplier.name}</TextLink> },
              { label: "Purchase date", value: formatDate(p.purchaseDate) },
              { label: "Received by", value: p.receivedBy.name },
              { label: "Recorded at", value: formatDateTime(p.createdAt) },
              { label: "Total units", value: formatNumber(p.totalUnits) },
              ...(financial ? [{ label: "Total amount", value: formatCurrency(p.totalAmount) }] : []),
              { label: "Notes", value: p.notes ?? "—" },
            ]}
          />
        </CardBody>
      </Card>
      <Card className="mt-6">
        <CardHeader title="Items and batches" description="Each line produced exactly one STOCK_IN ledger row (unique purchase_item_id)." />
        <Table caption="Purchase items">
          <thead>
            <tr>
              <Th>Medicine</Th>
              <Th>Batch</Th>
              <Th>Expiry</Th>
              <Th align="right">Quantity</Th>
              {financial ? <Th align="right">Unit cost</Th> : null}
              {financial ? <Th align="right">Line total</Th> : null}
              <Th>Ledger</Th>
            </tr>
          </thead>
          <TBody>
            {p.items.map((i) => (
              <tr key={i.id}>
                <Td>
                  <TextLink href={`/medicines/${i.batch.medicine.id}`}>
                    {i.batch.medicine.name} {i.batch.medicine.strength}
                  </TextLink>
                </Td>
                <Td>
                  <TextLink href={`/batches/${i.batchId}`} className="font-mono text-xs">
                    {i.batch.batchNumber}
                  </TextLink>
                </Td>
                <Td>{formatDate(i.batch.expiryDate)}</Td>
                <Td align="right">
                  {formatNumber(i.quantity)} <span className="text-xs text-slate-500">{i.batch.medicine.unit}</span>
                </Td>
                {financial ? <Td align="right">{formatCurrency(num(i.unitCost))}</Td> : null}
                {financial ? <Td align="right">{formatCurrency(i.quantity * num(i.unitCost))}</Td> : null}
                <Td className="text-xs text-slate-500">{i.stockIn ? `Txn #${i.stockIn.id} · balance ${formatNumber(i.stockIn.balanceAfter)}` : "—"}</Td>
              </tr>
            ))}
          </TBody>
        </Table>
      </Card>
    </>
  );
}
