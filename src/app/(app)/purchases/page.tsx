import type { Metadata } from "next";
import { requirePageAccess } from "@/server/auth/session";
import { listPurchases } from "@/server/services/purchases.service";
import { listSupplierOptions } from "@/server/services/catalog.service";
import { can } from "@/lib/permissions";
import { formatDate } from "@/lib/dates";
import { formatCurrency, formatNumber } from "@/lib/format";
import { ButtonLink, Card, EmptyState, PageHeader, Table, TBody, Td, TextLink, Th } from "@/components/ui/primitives";
import { FilterBar, FilterInput, FilterSelect, Pagination, dateParam, first, intParam, type SearchParams } from "@/components/ui/list";

export const metadata: Metadata = { title: "Purchase history" };

export default async function PurchasesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requirePageAccess("purchase:view");
  const params = await searchParams;
  const filters = {
    supplierId: intParam(params.supplier),
    q: first(params.q)?.trim().slice(0, 50),
    from: dateParam(params.from),
    to: dateParam(params.to),
    page: intParam(params.page) ?? 1,
  };
  const [result, suppliers] = await Promise.all([listPurchases(user, filters), listSupplierOptions()]);
  const financial = can(user.role, "reports:financial");

  return (
    <>
      <PageHeader
        title="Purchase history"
        description="Supplier deliveries with totals derived from purchase items (view v_purchase_summary)."
        actions={can(user.role, "purchase:create") ? <ButtonLink href="/purchases/new">Receive stock</ButtonLink> : null}
      />
      <Card>
        <FilterBar resetHref="/purchases">
          <FilterInput label="Invoice" name="q" defaultValue={filters.q} placeholder="Invoice number" />
          <FilterSelect
            label="Supplier"
            name="supplier"
            defaultValue={filters.supplierId ? String(filters.supplierId) : ""}
            options={[{ value: "", label: "All suppliers" }, ...suppliers.map((s) => ({ value: String(s.id), label: s.label }))]}
            className="lg:w-64"
          />
          <FilterInput label="From" name="from" type="date" defaultValue={filters.from} className="lg:w-44" />
          <FilterInput label="To" name="to" type="date" defaultValue={filters.to} className="lg:w-44" />
        </FilterBar>
        {result.rows.length === 0 ? (
          <EmptyState title="No purchases found" />
        ) : (
          <Table caption="Purchases">
            <thead>
              <tr>
                <Th>Invoice</Th>
                <Th>Supplier</Th>
                <Th>Date</Th>
                <Th align="right">Items</Th>
                <Th align="right">Units</Th>
                {financial ? <Th align="right">Amount</Th> : null}
                <Th>Received by</Th>
              </tr>
            </thead>
            <TBody>
              {result.rows.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50/60">
                  <Td>
                    <TextLink href={`/purchases/${p.id}`}>{p.invoiceNumber}</TextLink>
                  </Td>
                  <Td>{p.supplierName}</Td>
                  <Td className="whitespace-nowrap">{formatDate(p.purchaseDate)}</Td>
                  <Td align="right">{p.itemCount}</Td>
                  <Td align="right">{formatNumber(p.totalUnits)}</Td>
                  {financial ? <Td align="right">{formatCurrency(p.totalAmount)}</Td> : null}
                  <Td className="text-xs">{p.receivedBy}</Td>
                </tr>
              ))}
            </TBody>
          </Table>
        )}
        <Pagination pathname="/purchases" params={params} page={result.page} pageSize={result.pageSize} total={result.total} />
      </Card>
    </>
  );
}
