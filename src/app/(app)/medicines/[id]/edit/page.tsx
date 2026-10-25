import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requirePageAccess } from "@/server/auth/session";
import { getMedicine, listCategories } from "@/server/services/catalog.service";
import { NotFoundError } from "@/lib/errors";
import { Card, CardBody, PageHeader } from "@/components/ui/primitives";
import { MedicineForm } from "../../medicine-form";
import { updateMedicineAction } from "../../actions";

export const metadata: Metadata = { title: "Edit medicine" };

export default async function EditMedicinePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePageAccess("medicine:manage");
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const [data, categories] = await Promise.all([getMedicine(user, id).catch((e) => (e instanceof NotFoundError ? null : Promise.reject(e))), listCategories()]);
  if (!data) notFound();
  const m = data.medicine;
  return (
    <>
      <PageHeader title={`Edit ${m.name} ${m.strength}`} />
      <Card>
        <CardBody className="py-6">
          <MedicineForm
            action={updateMedicineAction.bind(null, m.id)}
            categories={categories}
            submitLabel="Save changes"
            cancelHref={`/medicines/${m.id}`}
            initial={{
              name: m.name,
              genericName: m.genericName,
              categoryId: m.categoryId,
              manufacturer: m.manufacturer,
              dosageForm: m.dosageForm,
              strength: m.strength,
              unit: m.unit,
              storageCondition: m.storageCondition,
              description: m.description,
              reorderLevel: m.reorderLevel,
              isActive: m.isActive,
            }}
          />
        </CardBody>
      </Card>
    </>
  );
}
