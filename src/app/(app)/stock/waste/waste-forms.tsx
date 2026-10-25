"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import type { ActionState } from "@/lib/action-state";
import { ConfirmSubmit, Field, FormMessage, Input, Select, SubmitButton, Textarea, fieldError, previous, useIdempotencyKey } from "@/components/ui/form";
import { recordAdjustmentAction, recordWasteAction, writeOffExpiredAction } from "../actions";

export type BatchOption = { id: number; label: string; batchNumber: string; expiryDate: string; quantity: number; unit: string; expired: boolean };

function useRedirectOnSuccess(state: ActionState) {
  const router = useRouter();
  useEffect(() => {
    const href = (state?.data as { href?: string } | undefined)?.href;
    if (state?.ok && href) router.push(href);
  }, [state, router]);
}

function BatchSelect({ batches, state, value, onChange }: { batches: BatchOption[]; state: ActionState; value: string; onChange: (v: string) => void }) {
  const selected = batches.find((b) => String(b.id) === value);
  return (
    <Field
      label="Batch"
      name="batchId"
      required
      error={fieldError(state, "batchId")}
      hint={selected ? `${selected.quantity} ${selected.unit}(s) on hand · expiry ${selected.expiryDate}${selected.expired ? " (expired)" : ""}` : undefined}
    >
      {(p) => (
        <Select {...p} value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">Choose a batch</option>
          {batches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.label} · {b.quantity} {b.unit}
              {b.expired ? " · EXPIRED" : ""}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );
}

export function WasteForm({ batches, initialBatchId }: { batches: BatchOption[]; initialBatchId?: string }) {
  const [state, action] = useActionState(recordWasteAction, null);
  const [key] = useIdempotencyKey();
  const [batchId, setBatchId] = useState(previous(state, "batchId", initialBatchId) ?? "");
  useRedirectOnSuccess(state);
  const selected = batches.find((b) => String(b.id) === batchId);
  return (
    <form action={action} className="space-y-4" noValidate>
      <FormMessage state={state?.ok ? null : state} />
      <input type="hidden" name="idempotencyKey" value={key} />
      <BatchSelect batches={batches} state={state} value={batchId} onChange={setBatchId} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Quantity" name="quantity" required error={fieldError(state, "quantity")}>
          {(p) => <Input {...p} type="number" min={1} max={selected?.quantity} step={1} defaultValue={previous(state, "quantity")} />}
        </Field>
        <Field label="Reason" name="reason" required error={fieldError(state, "reason")}>
          {(p) => (
            <Select key={selected?.id ?? "none"} {...p} defaultValue={previous(state, "reason", selected?.expired ? "EXPIRED" : "DAMAGED")}>
              <option value="EXPIRED">Expired</option>
              <option value="DAMAGED">Damaged</option>
              <option value="RECALLED">Recalled</option>
              <option value="CONTAMINATED">Contaminated</option>
              <option value="OTHER">Other</option>
            </Select>
          )}
        </Field>
      </div>
      <Field label="Notes" name="notes" error={fieldError(state, "notes")}>
        {(p) => <Textarea {...p} rows={2} maxLength={500} defaultValue={previous(state, "notes")} />}
      </Field>
      <SubmitButton variant="danger" disabled={!key} pendingText="Recording…">
        Record waste
      </SubmitButton>
    </form>
  );
}

export function AdjustmentForm({ batches, canIncrease, initialBatchId }: { batches: BatchOption[]; canIncrease: boolean; initialBatchId?: string }) {
  const [state, action] = useActionState(recordAdjustmentAction, null);
  const [key] = useIdempotencyKey();
  const [batchId, setBatchId] = useState(previous(state, "batchId", initialBatchId) ?? "");
  useRedirectOnSuccess(state);
  return (
    <form action={action} className="space-y-4" noValidate>
      <FormMessage state={state?.ok ? null : state} />
      <input type="hidden" name="idempotencyKey" value={key} />
      <BatchSelect batches={batches} state={state} value={batchId} onChange={setBatchId} />
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Direction" name="direction" required error={fieldError(state, "direction")} hint={canIncrease ? undefined : "Increases require an administrator"}>
          {(p) => (
            <Select {...p} defaultValue={previous(state, "direction", "OUT")}>
              <option value="OUT">Decrease (−)</option>
              {canIncrease ? <option value="IN">Increase (+)</option> : null}
            </Select>
          )}
        </Field>
        <Field label="Quantity" name="quantity" required error={fieldError(state, "quantity")}>
          {(p) => <Input {...p} type="number" min={1} step={1} defaultValue={previous(state, "quantity")} />}
        </Field>
        <Field label="Reason" name="reason" required error={fieldError(state, "reason")}>
          {(p) => (
            <Select {...p} defaultValue={previous(state, "reason", "COUNT_CORRECTION")}>
              <option value="COUNT_CORRECTION">Count correction</option>
              <option value="DAMAGED">Damaged</option>
              <option value="OTHER">Other</option>
            </Select>
          )}
        </Field>
      </div>
      <Field label="Justification" name="notes" required error={fieldError(state, "notes")} hint="Required for every adjustment (audit trail)">
        {(p) => <Textarea {...p} rows={2} maxLength={500} defaultValue={previous(state, "notes")} />}
      </Field>
      <SubmitButton variant="warning" disabled={!key} pendingText="Recording…">
        Record adjustment
      </SubmitButton>
    </form>
  );
}

export function WriteOffExpiredForm({ expiredBatches, expiredUnits }: { expiredBatches: number; expiredUnits: number }) {
  const [state, action] = useActionState(writeOffExpiredAction, null);
  const [key] = useIdempotencyKey();
  useRedirectOnSuccess(state);
  return (
    <form id="write-off-expired" action={action} className="space-y-3">
      <FormMessage state={state} />
      <input type="hidden" name="idempotencyKey" value={key} />
      <p className="text-sm text-slate-600">
        {expiredBatches > 0
          ? `${expiredBatches} expired batch(es) still hold ${expiredUnits} unit(s).`
          : "No expired stock is waiting for write-off."}
      </p>
      <ConfirmSubmit
        formId="write-off-expired"
        label="Write off all expired stock"
        title="Write off all expired stock?"
        message={`This calls the stored procedure sp_write_off_expired, which records ${expiredUnits} unit(s) from ${expiredBatches} batch(es) as WASTE (reason: expired) in a single transaction.`}
        confirmLabel="Write off"
        variant="danger"
        size="md"
      />
    </form>
  );
}
