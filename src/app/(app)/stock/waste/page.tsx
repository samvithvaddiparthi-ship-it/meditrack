import type { Metadata } from "next";
import { requirePageAccess } from "@/server/auth/session";
import { listBatchesForAdjustment } from "@/server/services/stock.service";
import { businessTodayIso } from "@/lib/dates";
import { can } from "@/lib/permissions";
import { Card, CardBody, CardHeader, PageHeader } from "@/components/ui/primitives";
import { first, type SearchParams } from "@/components/ui/list";
import { AdjustmentForm, WasteForm, WriteOffExpiredForm, type BatchOption } from "./waste-forms";

export const metadata: Metadata = { title: "Waste & adjustments" };

export default async function WastePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requirePageAccess("stock:waste");
  const [rows, params] = await Promise.all([listBatchesForAdjustment(user), searchParams]);
  const today = businessTodayIso();
  const batches: BatchOption[] = rows.map((b) => ({ ...b, expired: b.expiryDate <= today }));
  const expired = batches.filter((b) => b.expired);
  const initialBatchId = first(params.batch);

  return (
    <>
      <PageHeader
        title="Waste & adjustments"
        description="Write off expired, damaged or recalled stock, and correct physical-count differences. Every change is a ledger row; quantities can never go below zero (enforced by trigger and CHECK constraint)."
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Record waste" description="Expired stock may only leave inventory this way — never through an ordinary issue." />
          <CardBody>
            <WasteForm batches={batches} initialBatchId={initialBatchId} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Stock adjustment" description="Physical count corrections with a mandatory justification." />
          <CardBody>
            <AdjustmentForm batches={batches} canIncrease={can(user.role, "stock:adjust-in")} initialBatchId={initialBatchId} />
          </CardBody>
        </Card>
      </div>
      {can(user.role, "stock:write-off-expired") ? (
        <Card className="mt-6">
          <CardHeader title="Bulk write-off (administrators)" description="Runs the MySQL stored procedure sp_write_off_expired: a cursor over expired batches, one transaction, ROLLBACK on any error." />
          <CardBody>
            <WriteOffExpiredForm expiredBatches={expired.length} expiredUnits={expired.reduce((s, b) => s + b.quantity, 0)} />
          </CardBody>
        </Card>
      ) : null}
    </>
  );
}
