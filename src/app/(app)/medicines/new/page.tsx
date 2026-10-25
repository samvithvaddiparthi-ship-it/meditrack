import type { Metadata } from "next";
import { requirePageAccess } from "@/server/auth/session";
import { listCategories } from "@/server/services/catalog.service";
import { Card, CardBody, PageHeader } from "@/components/ui/primitives";
import { MedicineForm } from "../medicine-form";
import { createMedicineAction } from "../actions";

export const metadata: Metadata = { title: "Add medicine" };

export default async function NewMedicinePage() {
  await requirePageAccess("medicine:manage");
  const categories = await listCategories();
  return (
    <>
      <PageHeader title="Add medicine" description="Stock is not entered here — it arrives through stock receipts so every unit has a batch and a ledger entry." />
      <Card>
        <CardBody className="py-6">
          <MedicineForm action={createMedicineAction} categories={categories} submitLabel="Add medicine" cancelHref="/medicines" />
        </CardBody>
      </Card>
    </>
  );
}
