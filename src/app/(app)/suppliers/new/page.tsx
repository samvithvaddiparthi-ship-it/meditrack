import type { Metadata } from "next";
import { requirePageAccess } from "@/server/auth/session";
import { Card, CardBody, PageHeader } from "@/components/ui/primitives";
import { SupplierForm } from "../supplier-form";
import { createSupplierAction } from "../actions";

export const metadata: Metadata = { title: "Add supplier" };

export default async function NewSupplierPage() {
  await requirePageAccess("supplier:manage");
  return (
    <>
      <PageHeader title="Add supplier" />
      <Card>
        <CardBody className="py-6">
          <SupplierForm action={createSupplierAction} submitLabel="Add supplier" cancelHref="/suppliers" />
        </CardBody>
      </Card>
    </>
  );
}
