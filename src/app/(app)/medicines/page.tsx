import type { Metadata } from "next";
import { requirePageAccess } from "@/server/auth/session";
import { listCategories, listMedicines, type MedicineSort } from "@/server/services/catalog.service";
import { can } from "@/lib/permissions";
import { formatDate } from "@/lib/dates";
import { formatNumber, humanize } from "@/lib/format";
import { ButtonLink, Card, EmptyState, PageHeader, Table, TBody, Td, TextLink, Th } from "@/components/ui/primitives";
import { FilterBar, FilterInput, FilterSelect, Pagination, SortHeader, first, intParam, oneOf, type SearchParams } from "@/components/ui/list";
import { ActiveBadge, Badge } from "@/components/ui/status-exports";
import { Notice } from "@/components/ui/notice";

export const metadata: Metadata = { title: "Medicines" };

const SORTS = ["name", "stock", "reorder", "expiry", "updated"] as const;

export default async function MedicinesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requirePageAccess("medicine:view");
  const params = await searchParams;
  const filters = {
    q: first(params.q)?.trim().slice(0, 100),
    categoryId: intParam(params.category),
    status: oneOf(params.status, ["active", "inactive", "all"] as const),
    stock: oneOf(params.stock, ["low", "out", "all"] as const),
    sort: oneOf(params.sort, SORTS) as MedicineSort | undefined,
    dir: oneOf(params.dir, ["asc", "desc"] as const),
    page: intParam(params.page) ?? 1,
  };
  const [result, categories] = await Promise.all([listMedicines(user, filters), listCategories()]);
  const sortProps = { pathname: "/medicines", params, defaultSort: "name" };

  return (
    <>
      <PageHeader
        title="Medicines"
        description="Catalogue with live stock aggregated across batches. Search uses the MySQL FULLTEXT index on name, generic name and manufacturer."
        actions={
          can(user.role, "medicine:manage") ? (
            <>
              <ButtonLink href="/medicines/categories" variant="secondary">
                Categories
              </ButtonLink>
              <ButtonLink href="/medicines/new">Add medicine</ButtonLink>
            </>
          ) : null
        }
      />
      <Notice params={params} />
      <Card>
        <FilterBar resetHref="/medicines">
          <FilterInput label="Search" name="q" defaultValue={filters.q} placeholder="Name, generic name or manufacturer" className="lg:w-72" />
          <FilterSelect
            label="Category"
            name="category"
            defaultValue={filters.categoryId ? String(filters.categoryId) : ""}
            options={[{ value: "", label: "All categories" }, ...categories.map((c) => ({ value: String(c.id), label: c.name }))]}
          />
          <FilterSelect
            label="Status"
            name="status"
            defaultValue={filters.status ?? "active"}
            options={[
              { value: "active", label: "Active" },
              { value: "inactive", label: "Inactive" },
              { value: "all", label: "All" },
            ]}
          />
          <FilterSelect
            label="Stock"
            name="stock"
            defaultValue={filters.stock ?? ""}
            options={[
              { value: "", label: "Any stock level" },
              { value: "low", label: "At / below reorder level" },
              { value: "out", label: "Out of stock" },
            ]}
          />
        </FilterBar>
        {result.rows.length === 0 ? (
          <EmptyState
            title="No medicines match these filters"
            description="Try a different search term or reset the filters."
            action={can(user.role, "medicine:manage") ? <ButtonLink href="/medicines/new">Add medicine</ButtonLink> : undefined}
          />
        ) : (
          <Table caption="Medicines">
            <thead>
              <tr>
                <SortHeader {...sortProps} column="name" label="Medicine" />
                <Th>Category</Th>
                <SortHeader {...sortProps} column="stock" label="Usable stock" align="right" />
                <SortHeader {...sortProps} column="reorder" label="Reorder level" align="right" />
                <SortHeader {...sortProps} column="expiry" label="Next expiry" />
                <Th>Status</Th>
              </tr>
            </thead>
            <TBody>
              {result.rows.map((m) => (
                <tr key={m.id} className="hover:bg-slate-50/60">
                  <Td>
                    <TextLink href={`/medicines/${m.id}`}>
                      {m.name} {m.strength}
                    </TextLink>
                    <div className="text-xs text-slate-500">
                      {humanize(m.dosageForm)} · {m.manufacturer}
                      {m.genericName ? ` · ${m.genericName}` : ""}
                    </div>
                  </Td>
                  <Td className="text-slate-600">{m.categoryName}</Td>
                  <Td align="right">
                    <span className="font-medium text-slate-900">{formatNumber(m.usableQuantity)}</span> <span className="text-xs text-slate-500">{m.unit}</span>
                    {m.expiredQuantity > 0 ? <div className="text-xs text-red-600">+{formatNumber(m.expiredQuantity)} expired</div> : null}
                  </Td>
                  <Td align="right">{formatNumber(m.reorderLevel)}</Td>
                  <Td className="whitespace-nowrap">{formatDate(m.nextExpiry)}</Td>
                  <Td>
                    <div className="flex flex-wrap gap-1">
                      <ActiveBadge active={m.isActive} />
                      {m.isActive && m.usableQuantity === 0 ? <Badge tone="danger">Out of stock</Badge> : m.isLowStock ? <Badge tone="warning">Low stock</Badge> : null}
                    </div>
                  </Td>
                </tr>
              ))}
            </TBody>
          </Table>
        )}
        <Pagination pathname="/medicines" params={params} page={result.page} pageSize={result.pageSize} total={result.total} />
      </Card>
    </>
  );
}
