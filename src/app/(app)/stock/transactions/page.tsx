import type { Metadata } from "next";
import { requirePageAccess } from "@/server/auth/session";
import { listTransactions } from "@/server/services/stock.service";
import { listMedicineOptions } from "@/server/services/catalog.service";
import { listUserOptions } from "@/server/services/users.service";
import { formatDateTime } from "@/lib/dates";
import { formatNumber, humanize } from "@/lib/format";
import { Card, EmptyState, PageHeader, Table, TBody, Td, TextLink, Th } from "@/components/ui/primitives";
import { FilterBar, FilterInput, FilterSelect, Pagination, dateParam, intParam, oneOf, type SearchParams } from "@/components/ui/list";
import { MovementBadge, movementSign } from "@/components/ui/status";

export const metadata: Metadata = { title: "Stock ledger" };

const TYPES = ["STOCK_IN", "STOCK_OUT", "WASTE", "ADJUSTMENT_IN", "ADJUSTMENT_OUT"] as const;

export default async function TransactionsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requirePageAccess("ledger:view");
  const params = await searchParams;
  const filters = {
    type: oneOf(params.type, TYPES),
    medicineId: intParam(params.medicine),
    batchId: intParam(params.batch),
    operationId: intParam(params.operation),
    userId: intParam(params.user),
    from: dateParam(params.from),
    to: dateParam(params.to),
    page: intParam(params.page) ?? 1,
  };
  const [result, medicines, users] = await Promise.all([listTransactions(user, filters), listMedicineOptions(), listUserOptions()]);

  return (
    <>
      <PageHeader
        title="Stock ledger"
        description="The permanent, append-only record of every stock movement (table stock_transactions). UPDATE and DELETE are blocked by triggers; corrections are new adjustment rows."
      />
      <Card>
        <FilterBar resetHref="/stock/transactions">
          <FilterSelect label="Type" name="type" defaultValue={filters.type ?? ""} options={[{ value: "", label: "All types" }, ...TYPES.map((t) => ({ value: t, label: humanize(t) }))]} className="lg:w-40" />
          <FilterSelect label="Medicine" name="medicine" defaultValue={filters.medicineId ? String(filters.medicineId) : ""} options={[{ value: "", label: "All medicines" }, ...medicines.map((m) => ({ value: String(m.id), label: m.label }))]} className="lg:w-56" />
          <FilterSelect label="User" name="user" defaultValue={filters.userId ? String(filters.userId) : ""} options={[{ value: "", label: "Anyone" }, ...users.map((u) => ({ value: String(u.id), label: u.label }))]} className="lg:w-44" />
          <FilterInput label="From" name="from" type="date" defaultValue={filters.from} className="lg:w-40" />
          <FilterInput label="To" name="to" type="date" defaultValue={filters.to} className="lg:w-40" />
        </FilterBar>
        {filters.batchId || filters.operationId ? (
          <p className="border-b border-slate-100 px-4 py-2 text-xs text-slate-500">
            Filtered to {filters.batchId ? `batch #${filters.batchId}` : `operation #${filters.operationId}`} ·{" "}
            <TextLink href="/stock/transactions">clear</TextLink>
          </p>
        ) : null}
        {result.rows.length === 0 ? (
          <EmptyState title="No movements match these filters" />
        ) : (
          <Table caption="Stock ledger">
            <thead>
              <tr>
                <Th>#</Th>
                <Th>When</Th>
                <Th>Type</Th>
                <Th>Medicine / batch</Th>
                <Th align="right">Qty</Th>
                <Th align="right">Balance after</Th>
                <Th>Reference</Th>
                <Th>By</Th>
              </tr>
            </thead>
            <TBody>
              {result.rows.map((t) => (
                <tr key={t.id} className="hover:bg-slate-50/60">
                  <Td className="tabular text-xs text-slate-400">{t.id}</Td>
                  <Td className="whitespace-nowrap text-xs text-slate-500">{formatDateTime(t.createdAt)}</Td>
                  <Td>
                    <MovementBadge type={t.type} />
                  </Td>
                  <Td>
                    <TextLink href={`/medicines/${t.batch.medicine.id}`}>
                      {t.batch.medicine.name} {t.batch.medicine.strength}
                    </TextLink>
                    <div>
                      <TextLink href={`/batches/${t.batchId}`} className="font-mono text-xs font-normal">
                        {t.batch.batchNumber}
                      </TextLink>
                    </div>
                  </Td>
                  <Td align="right" className={movementSign(t.type) > 0 ? "text-emerald-700" : "text-slate-900"}>
                    {movementSign(t.type) > 0 ? "+" : "−"}
                    {formatNumber(t.quantity)}
                  </Td>
                  <Td align="right">{formatNumber(t.balanceAfter)}</Td>
                  <Td className="text-xs">
                    {t.purchaseItem ? (
                      <TextLink href={`/purchases/${t.purchaseItem.purchaseId}`}>Invoice {t.purchaseItem.purchase.invoiceNumber}</TextLink>
                    ) : t.operation ? (
                      <>
                        <TextLink href={`/stock/operations/${t.operation.id}`}>
                          {humanize(t.operation.type)} #{t.operation.id}
                        </TextLink>
                        <div className="text-slate-500">{t.operation.destination ?? humanize(t.operation.reason)}</div>
                      </>
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
        <Pagination pathname="/stock/transactions" params={params} page={result.page} pageSize={result.pageSize} total={result.total} />
      </Card>
    </>
  );
}
