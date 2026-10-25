import type { Metadata } from "next";
import { requirePageAccess } from "@/server/auth/session";
import { listIssuableMedicines } from "@/server/services/stock.service";
import { Card, CardBody, PageHeader } from "@/components/ui/primitives";
import { first, type SearchParams } from "@/components/ui/list";
import { IssueForm } from "./issue-form";

export const metadata: Metadata = { title: "Issue stock" };

export default async function IssuePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requirePageAccess("stock:issue");
  const [medicines, params] = await Promise.all([listIssuableMedicines(user), searchParams]);
  return (
    <>
      <PageHeader
        title="Issue stock"
        description="Dispense stock to a ward or counter. Batches are chosen First-Expiry-First-Out inside a MySQL transaction with row locks (SELECT … FOR UPDATE), so concurrent issues cannot oversell."
      />
      <Card>
        <CardBody className="py-6">
          <IssueForm medicines={medicines} initialMedicineId={first(params.medicine)} />
        </CardBody>
      </Card>
    </>
  );
}
