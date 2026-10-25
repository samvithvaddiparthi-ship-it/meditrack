import type { Metadata } from "next";
import { requirePageAccess } from "@/server/auth/session";
import { listMedicineOptions, listSupplierOptions } from "@/server/services/catalog.service";
import { businessTodayIso } from "@/lib/dates";
import { Alert, Card, CardBody, PageHeader } from "@/components/ui/primitives";
import { PurchaseForm } from "./purchase-form";

export const metadata: Metadata = { title: "Receive stock" };

export default async function NewPurchasePage() {
  await requirePageAccess("purchase:create");
  const [suppliers, medicines] = await Promise.all([listSupplierOptions(), listMedicineOptions({ activeOnly: true })]);
  return (
    <>
      <PageHeader
        title="Receive stock"
        description="Record a supplier delivery. Each item creates (or adds to) a batch and writes a STOCK_IN row to the ledger; the database trigger updates the batch quantity."
      />
      {suppliers.length === 0 || medicines.length === 0 ? (
        <Alert tone="warning" className="mb-4">
          You need at least one active supplier and one active medicine before stock can be received.
        </Alert>
      ) : null}
      <Card>
        <CardBody className="py-6">
          <PurchaseForm suppliers={suppliers} medicines={medicines} today={businessTodayIso()} />
        </CardBody>
      </Card>
    </>
  );
}
