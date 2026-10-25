import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requirePageAccess } from "@/server/auth/session";
import { getOperation } from "@/server/services/stock.service";
import { NotFoundError } from "@/lib/errors";
import { formatDate, formatDateTime } from "@/lib/dates";
import { formatNumber, humanize } from "@/lib/format";
import { can } from "@/lib/permissions";
import { ButtonLink, Card, CardBody, CardHeader, DescriptionList, PageHeader, Table, TBody, Td, TextLink, Th } from "@/components/ui/primitives";
import { Badge, MovementBadge, movementSign } from "@/components/ui/status-exports";
import { Notice } from "@/components/ui/notice";
import type { SearchParams } from "@/components/ui/list";

export const metadata: Metadata = { title: "Stock operation" };

export default async function OperationPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SearchParams> }) {
  const user = await requirePageAccess("ledger:view");
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const op = await getOperation(user, id).catch((e) => (e instanceof NotFoundError ? null : Promise.reject(e)));
  if (!op) notFound();
  const total = op.transactions.reduce((s, t) => s + t.quantity, 0);
  const tone = op.type === "ISSUE" ? "info" : op.type === "WASTE" ? "danger" : "warning";

  return (
    <>
      <PageHeader
        title={`${humanize(op.type)} #${op.id}`}
        description={<Badge tone={tone}>{op.transactions.length > 1 ? `${op.transactions.length} batches used` : "Single batch"}</Badge>}
        actions={
          op.type === "ISSUE" && can(user.role, "stock:issue") ? (
            <ButtonLink href="/stock/issue" variant="secondary">
              New issue
            </ButtonLink>
          ) : op.type !== "ISSUE" && can(user.role, "stock:waste") ? (
            <ButtonLink href="/stock/waste" variant="secondary">
              Waste & adjustments
            </ButtonLink>
          ) : null
        }
      />
      <Notice params={await searchParams} />
      <Card>
        <CardBody>
          <DescriptionList
            items={[
              { label: "Recorded", value: formatDateTime(op.createdAt) },
              { label: "By", value: `${op.performedBy.name} (${humanize(op.performedBy.role)})` },
              { label: "Total quantity", value: formatNumber(total) },
              ...(op.destination ? [{ label: "Issued to", value: op.destination }] : []),
              ...(op.reason ? [{ label: "Reason", value: humanize(op.reason) }] : []),
              { label: "Notes", value: op.notes ?? "—" },
            ]}
          />
        </CardBody>
      </Card>
      <Card className="mt-6">
        <CardHeader title="Batches affected" description={op.type === "ISSUE" ? "Allocated First-Expiry-First-Out; all rows were committed in one transaction." : undefined} />
        <Table caption="Ledger rows for this operation">
          <thead>
            <tr>
              <Th>Medicine</Th>
              <Th>Batch</Th>
              <Th>Expiry</Th>
              <Th>Type</Th>
              <Th align="right">Qty</Th>
              <Th align="right">Batch balance after</Th>
            </tr>
          </thead>
          <TBody>
            {op.transactions.map((t) => (
              <tr key={t.id}>
                <Td>
                  <TextLink href={`/medicines/${t.batch.medicine.id}`}>
                    {t.batch.medicine.name} {t.batch.medicine.strength}
                  </TextLink>
                </Td>
                <Td>
                  <TextLink href={`/batches/${t.batchId}`} className="font-mono text-xs">
                    {t.batch.batchNumber}
                  </TextLink>
                </Td>
                <Td>{formatDate(t.batch.expiryDate)}</Td>
                <Td>
                  <MovementBadge type={t.type} />
                </Td>
                <Td align="right">
                  {movementSign(t.type) > 0 ? "+" : "−"}
                  {formatNumber(t.quantity)} <span className="text-xs text-slate-500">{t.batch.medicine.unit}</span>
                </Td>
                <Td align="right">{formatNumber(t.balanceAfter)}</Td>
              </tr>
            ))}
          </TBody>
        </Table>
      </Card>
    </>
  );
}
