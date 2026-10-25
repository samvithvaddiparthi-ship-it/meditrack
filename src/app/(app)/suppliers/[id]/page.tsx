import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requirePageAccess } from "@/server/auth/session";
import { getSupplier } from "@/server/services/catalog.service";
import { listPurchases } from "@/server/services/purchases.service";
import { NotFoundError } from "@/lib/errors";
import { formatDate, formatDateTime } from "@/lib/dates";
import { can } from "@/lib/permissions";
import { formatCurrency, formatNumber } from "@/lib/format";
import { Card, CardBody, CardHeader, DescriptionList, EmptyState, PageHeader, Table, TBody, Td, TextLink, Th } from "@/components/ui/primitives";
import { ActiveBadge } from "@/components/ui/status";
import { ActionButton } from "@/components/ui/action-button";
import { Notice } from "@/components/ui/notice";
import type { SearchParams } from "@/components/ui/list";
import { SupplierForm } from "../supplier-form";
import { deleteSupplierAction, updateSupplierAction } from "../actions";

export const metadata: Metadata = { title: "Supplier" };

export default async function SupplierPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SearchParams> }) {
  const user = await requirePageAccess("supplier:view");
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const s = await getSupplier(user, id).catch((e) => (e instanceof NotFoundError ? null : Promise.reject(e)));
  if (!s) notFound();
  const purchases = await listPurchases(user, { supplierId: id, pageSize: 10 });
  const manage = can(user.role, "supplier:manage");
  const financial = can(user.role, "reports:financial");

  return (
    <>
      <PageHeader
        title={s.name}
        description={<ActiveBadge active={s.isActive} />}
        actions={
          manage && s._count.purchases === 0 ? (
            <ActionButton action={deleteSupplierAction.bind(null, s.id)} label="Delete" variant="danger" confirm={{ title: `Delete ${s.name}?`, message: "This supplier has no purchases and will be removed permanently.", confirmLabel: "Delete" }} />
          ) : null
        }
      />
      <Notice params={await searchParams} />
      {manage ? (
        <Card>
          <CardHeader title="Supplier details" description={s._count.purchases > 0 ? "This supplier has purchase history: mark it inactive instead of deleting it." : undefined} />
          <CardBody className="py-6">
            <SupplierForm
              action={updateSupplierAction.bind(null, s.id)}
              submitLabel="Save changes"
              cancelHref="/suppliers"
              initial={{ name: s.name, contactPerson: s.contactPerson, phone: s.phone, email: s.email, address: s.address, licenseNumber: s.licenseNumber, isActive: s.isActive }}
            />
          </CardBody>
        </Card>
      ) : (
        <Card>
          <CardBody>
            <DescriptionList
              items={[
                { label: "Contact person", value: s.contactPerson ?? "—" },
                { label: "Phone", value: s.phone },
                { label: "Email", value: s.email ?? "—" },
                { label: "Licence", value: s.licenseNumber ?? "—" },
                { label: "Address", value: s.address },
                { label: "Added", value: formatDateTime(s.createdAt) },
              ]}
            />
          </CardBody>
        </Card>
      )}
      <Card className="mt-6">
        <CardHeader title={`Purchases (${s._count.purchases})`} actions={<TextLink href={`/purchases?supplier=${s.id}`}>View all</TextLink>} />
        {purchases.rows.length === 0 ? (
          <EmptyState title="No purchases from this supplier" />
        ) : (
          <Table caption="Recent purchases">
            <thead>
              <tr>
                <Th>Invoice</Th>
                <Th>Date</Th>
                <Th align="right">Units</Th>
                {financial ? <Th align="right">Amount</Th> : null}
              </tr>
            </thead>
            <TBody>
              {purchases.rows.map((p) => (
                <tr key={p.id}>
                  <Td>
                    <TextLink href={`/purchases/${p.id}`}>{p.invoiceNumber}</TextLink>
                  </Td>
                  <Td>{formatDate(p.purchaseDate)}</Td>
                  <Td align="right">{formatNumber(p.totalUnits)}</Td>
                  {financial ? <Td align="right">{formatCurrency(p.totalAmount)}</Td> : null}
                </tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </>
  );
}
