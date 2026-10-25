import type { Metadata } from "next";
import { requirePageAccess } from "@/server/auth/session";
import { listBatches } from "@/server/services/inventory.service";
import { listMedicineOptions } from "@/server/services/catalog.service";
import { can } from "@/lib/permissions";
import { formatDate } from "@/lib/dates";
import { formatCurrency, formatNumber } from "@/lib/format";
import { Card, EmptyState, PageHeader, Table, TBody, Td, TextLink, Th } from "@/components/ui/primitives";
import { FilterBar, FilterInput, FilterSelect, Pagination, SortHeader, first, intParam, oneOf, type SearchParams } from "@/components/ui/list";
import { BatchStatusBadge, daysLabel } from "@/components/ui/status";

export const metadata: Metadata = { title: "Batch inventory" };

const STATUSES = ["AVAILABLE", "EXPIRING_SOON", "EXPIRED", "DEPLETED"] as const;

export default async function BatchesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requirePageAccess("batch:view");
  const params = await searchParams;
  const filters = {
    q: first(params.q)?.trim().slice(0, 100),
    status: oneOf(params.status, STATUSES),
    medicineId: intParam(params.medicine),
    sort: oneOf(params.sort, ["expiry", "medicine", "quantity", "received"] as const),
    dir: oneOf(params.dir, ["asc", "desc"] as const),
    page: intParam(params.page) ?? 1,
  };
  const [result, medicines] = await Promise.all([listBatches(user, filters), listMedicineOptions()]);
  const financial = can(user.role, "reports:financial");
  const sortProps = { pathname: "/batches", params, defaultSort: "expiry" };

  return (
    <>
      <PageHeader
        title="Batch inventory"
        description={`Every batch with its live status, computed from the expiry date and today's date (expiring-soon window ${result.windowDays} days). Source: view v_batch_stock.`}
      />
      <Card>
        <FilterBar resetHref="/batches">
          <FilterInput label="Search" name="q" defaultValue={filters.q} placeholder="Medicine or batch number" />
          <FilterSelect
            label="Medicine"
            name="medicine"
            defaultValue={filters.medicineId ? String(filters.medicineId) : ""}
            options={[{ value: "", label: "All medicines" }, ...medicines.map((m) => ({ value: String(m.id), label: m.label }))]}
            className="lg:w-64"
          />
          <FilterSelect
            label="Status"
            name="status"
            defaultValue={filters.status ?? ""}
            options={[
              { value: "", label: "All statuses" },
              { value: "AVAILABLE", label: "Available" },
              { value: "EXPIRING_SOON", label: "Expiring soon" },
              { value: "EXPIRED", label: "Expired (with stock)" },
              { value: "DEPLETED", label: "Depleted" },
            ]}
          />
        </FilterBar>
        {result.rows.length === 0 ? (
          <EmptyState title="No batches found" description="Batches are created by stock receipts." />
        ) : (
          <Table caption="Batches">
            <thead>
              <tr>
                <SortHeader {...sortProps} column="medicine" label="Medicine" />
                <Th>Batch</Th>
                <SortHeader {...sortProps} column="expiry" label="Expiry" />
                <SortHeader {...sortProps} column="quantity" label="Quantity" align="right" />
                {financial ? <Th align="right">Value</Th> : null}
                <Th>Supplier</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <TBody>
              {result.rows.map((b) => (
                <tr key={b.id} className="hover:bg-slate-50/60">
                  <Td>
                    <TextLink href={`/medicines/${b.medicineId}`}>
                      {b.medicineName} {b.strength}
                    </TextLink>
                    <div className="text-xs text-slate-500">{b.categoryName}</div>
                  </Td>
                  <Td>
                    <TextLink href={`/batches/${b.id}`} className="font-mono text-xs">
                      {b.batchNumber}
                    </TextLink>
                    <div className="text-xs text-slate-500">Mfg {formatDate(b.manufactureDate)}</div>
                  </Td>
                  <Td className="whitespace-nowrap">
                    {formatDate(b.expiryDate)}
                    <div className={b.daysToExpiry <= 0 ? "text-xs text-red-600" : "text-xs text-slate-500"}>{daysLabel(b.daysToExpiry)}</div>
                  </Td>
                  <Td align="right">
                    <span className="font-medium text-slate-900">{formatNumber(b.quantity)}</span> <span className="text-xs text-slate-500">{b.unit}</span>
                  </Td>
                  {financial ? <Td align="right">{formatCurrency(b.stockValue)}</Td> : null}
                  <Td className="text-xs text-slate-600">{b.supplierName ?? "—"}</Td>
                  <Td>
                    <BatchStatusBadge status={b.status} />
                  </Td>
                </tr>
              ))}
            </TBody>
          </Table>
        )}
        <Pagination pathname="/batches" params={params} page={result.page} pageSize={result.pageSize} total={result.total} />
      </Card>
    </>
  );
}
