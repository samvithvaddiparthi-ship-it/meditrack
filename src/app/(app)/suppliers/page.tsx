import type { Metadata } from "next";
import { requirePageAccess } from "@/server/auth/session";
import { listSuppliers } from "@/server/services/catalog.service";
import { can } from "@/lib/permissions";
import { ButtonLink, Card, EmptyState, PageHeader, Table, TBody, Td, TextLink, Th } from "@/components/ui/primitives";
import { FilterBar, FilterInput, FilterSelect, Pagination, first, intParam, oneOf, type SearchParams } from "@/components/ui/list";
import { ActiveBadge } from "@/components/ui/status";
import { Notice } from "@/components/ui/notice";

export const metadata: Metadata = { title: "Suppliers" };

export default async function SuppliersPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requirePageAccess("supplier:view");
  const params = await searchParams;
  const filters = { q: first(params.q)?.trim().slice(0, 100), status: oneOf(params.status, ["active", "inactive", "all"] as const), page: intParam(params.page) ?? 1 };
  const result = await listSuppliers(user, filters);
  return (
    <>
      <PageHeader
        title="Suppliers"
        description="Distributors that deliver stock. Suppliers with purchase history are deactivated rather than deleted."
        actions={can(user.role, "supplier:manage") ? <ButtonLink href="/suppliers/new">Add supplier</ButtonLink> : null}
      />
      <Notice params={params} />
      <Card>
        <FilterBar resetHref="/suppliers">
          <FilterInput label="Search" name="q" defaultValue={filters.q} placeholder="Name, contact or phone" />
          <FilterSelect
            label="Status"
            name="status"
            defaultValue={filters.status ?? "all"}
            options={[
              { value: "all", label: "All" },
              { value: "active", label: "Active" },
              { value: "inactive", label: "Inactive" },
            ]}
          />
        </FilterBar>
        {result.rows.length === 0 ? (
          <EmptyState title="No suppliers found" />
        ) : (
          <Table caption="Suppliers">
            <thead>
              <tr>
                <Th>Supplier</Th>
                <Th>Contact</Th>
                <Th>Licence</Th>
                <Th align="right">Purchases</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <TBody>
              {result.rows.map((s) => (
                <tr key={s.id} className="hover:bg-slate-50/60">
                  <Td>
                    <TextLink href={`/suppliers/${s.id}`}>{s.name}</TextLink>
                    <div className="max-w-xs truncate text-xs text-slate-500">{s.address}</div>
                  </Td>
                  <Td className="text-xs">
                    <div className="text-slate-700">{s.contactPerson ?? "—"}</div>
                    <div className="text-slate-500">{s.phone}</div>
                    {s.email ? <div className="text-slate-500">{s.email}</div> : null}
                  </Td>
                  <Td className="font-mono text-xs">{s.licenseNumber ?? "—"}</Td>
                  <Td align="right">
                    <TextLink href={`/purchases?supplier=${s.id}`}>{s._count.purchases}</TextLink>
                  </Td>
                  <Td>
                    <ActiveBadge active={s.isActive} />
                  </Td>
                </tr>
              ))}
            </TBody>
          </Table>
        )}
        <Pagination pathname="/suppliers" params={params} page={result.page} pageSize={result.pageSize} total={result.total} />
      </Card>
    </>
  );
}
