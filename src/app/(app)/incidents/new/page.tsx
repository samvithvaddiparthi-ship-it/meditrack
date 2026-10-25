import type { Metadata } from "next";
import { requirePageAccess } from "@/server/auth/session";
import { listMedicineOptions } from "@/server/services/catalog.service";
import { prisma } from "@/lib/db";
import { Card, CardBody, PageHeader } from "@/components/ui/primitives";
import { first, type SearchParams } from "@/components/ui/list";
import { IncidentForm } from "./incident-form";

export const metadata: Metadata = { title: "Report incident" };

export default async function NewIncidentPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requirePageAccess("incident:create");
  const [medicines, batches, params] = await Promise.all([
    listMedicineOptions(),
    prisma.medicineBatch.findMany({ select: { id: true, medicineId: true, batchNumber: true }, orderBy: [{ medicineId: "asc" }, { expiryDate: "asc" }] }),
    searchParams,
  ]);
  return (
    <>
      <PageHeader title="Report an incident" description="Damaged stock, packaging problems, count discrepancies or storage excursions. Reports are stored in MongoDB and reviewed by an administrator." />
      <Card>
        <CardBody className="py-6">
          <IncidentForm medicines={medicines} batches={batches} initialMedicineId={first(params.medicine)} />
        </CardBody>
      </Card>
    </>
  );
}
