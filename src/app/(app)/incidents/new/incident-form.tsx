"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { Field, FormMessage, Input, Select, SubmitButton, Textarea, fieldError, previous } from "@/components/ui/form";
import { buttonClass } from "@/components/ui/primitives";
import { createIncidentAction } from "../actions";

type Option = { id: number; label: string };
type BatchOption = { id: number; medicineId: number; batchNumber: string };

const TYPES = [
  ["DAMAGED_MEDICINE", "Damaged medicine"],
  ["DAMAGED_PACKAGING", "Damaged packaging"],
  ["STOCK_DISCREPANCY", "Stock discrepancy"],
  ["STORAGE_TEMPERATURE", "Storage temperature excursion"],
  ["OTHER", "Other inventory issue"],
] as const;

export function IncidentForm({ medicines, batches, initialMedicineId }: { medicines: Option[]; batches: BatchOption[]; initialMedicineId?: string }) {
  const [state, action] = useActionState(createIncidentAction, null);
  const [type, setType] = useState(previous(state, "type", "DAMAGED_MEDICINE") ?? "DAMAGED_MEDICINE");
  const [medicineId, setMedicineId] = useState(previous(state, "medicineId", initialMedicineId) ?? "");
  const medicineBatches = batches.filter((b) => String(b.medicineId) === medicineId);
  const e = (n: string) => fieldError(state, n);
  const v = (n: string) => previous(state, n);

  return (
    <form action={action} className="space-y-6" noValidate>
      <FormMessage state={state} />
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Incident type" name="type" required error={e("type")}>
          {(p) => (
            <Select {...p} value={type} onChange={(ev) => setType(ev.target.value)}>
              {TYPES.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Severity" name="severity" required error={e("severity")}>
          {(p) => (
            <Select {...p} defaultValue={v("severity") ?? "MEDIUM"}>
              <option value="LOW">Low</option>
              <option value="MEDIUM">Medium</option>
              <option value="HIGH">High</option>
              <option value="CRITICAL">Critical</option>
            </Select>
          )}
        </Field>
        <Field label="Title" name="title" required error={e("title")} className="sm:col-span-2">
          {(p) => <Input {...p} defaultValue={v("title")} maxLength={120} placeholder="Short summary" />}
        </Field>
        <Field label="Description" name="description" required error={e("description")} className="sm:col-span-2">
          {(p) => <Textarea {...p} defaultValue={v("description")} maxLength={2000} rows={4} placeholder="What happened, where, and what you observed" />}
        </Field>
        <Field label="Medicine" name="medicineId" error={e("medicineId")} required={type === "DAMAGED_MEDICINE" || type === "DAMAGED_PACKAGING" || type === "STOCK_DISCREPANCY"}>
          {(p) => (
            <Select {...p} value={medicineId} onChange={(ev) => setMedicineId(ev.target.value)}>
              <option value="">Not specific to a medicine</option>
              {medicines.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Batch" name="batchId" error={e("batchId")} required={type === "STOCK_DISCREPANCY"} hint={medicineId ? undefined : "Choose a medicine first"}>
          {(p) => (
            <Select key={medicineId} {...p} defaultValue={v("batchId") ?? ""} disabled={!medicineId}>
              <option value="">No specific batch</option>
              {medicineBatches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.batchNumber}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>

      <fieldset className="rounded-xl border border-slate-200 p-4">
        <legend className="px-1 text-sm font-semibold text-slate-900">Type-specific details</legend>
        <p className="mb-4 text-xs text-slate-500">Stored as flexible metadata in the MongoDB document — each incident type records different fields.</p>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Location" name="location" error={e("location")}>
            {(p) => <Input {...p} defaultValue={v("location")} maxLength={120} placeholder="Rack, room or bay" />}
          </Field>
          {type === "DAMAGED_MEDICINE" || type === "DAMAGED_PACKAGING" || type === "OTHER" ? (
            <Field label="Affected quantity" name="affectedQuantity" error={e("affectedQuantity")}>
              {(p) => <Input {...p} type="number" min={1} step={1} defaultValue={v("affectedQuantity")} />}
            </Field>
          ) : null}
          {type === "DAMAGED_MEDICINE" ? (
            <Field label="Cause of damage" name="damageCause" error={e("damageCause")}>
              {(p) => <Input {...p} defaultValue={v("damageCause")} maxLength={200} />}
            </Field>
          ) : null}
          {type === "DAMAGED_PACKAGING" ? (
            <>
              <Field label="Packaging type" name="packagingType" error={e("packagingType")}>
                {(p) => <Input {...p} defaultValue={v("packagingType")} maxLength={60} placeholder="Blister, bottle, carton…" />}
              </Field>
              <Field label="Seal intact?" name="sealIntact" error={e("sealIntact")}>
                {(p) => (
                  <Select {...p} defaultValue={v("sealIntact") ?? ""}>
                    <option value="">Unknown</option>
                    <option value="yes">Yes</option>
                    <option value="no">No</option>
                  </Select>
                )}
              </Field>
            </>
          ) : null}
          {type === "STOCK_DISCREPANCY" ? (
            <>
              <Field label="Expected (system) quantity" name="expectedQuantity" required error={e("expectedQuantity")}>
                {(p) => <Input {...p} type="number" min={0} step={1} defaultValue={v("expectedQuantity")} />}
              </Field>
              <Field label="Counted quantity" name="countedQuantity" required error={e("countedQuantity")}>
                {(p) => <Input {...p} type="number" min={0} step={1} defaultValue={v("countedQuantity")} />}
              </Field>
            </>
          ) : null}
          {type === "STORAGE_TEMPERATURE" ? (
            <>
              <Field label="Recorded temperature (°C)" name="recordedTemperatureC" required error={e("recordedTemperatureC")}>
                {(p) => <Input {...p} type="number" step="0.1" defaultValue={v("recordedTemperatureC")} />}
              </Field>
              <Field label="Duration (minutes)" name="durationMinutes" error={e("durationMinutes")}>
                {(p) => <Input {...p} type="number" min={1} step={1} defaultValue={v("durationMinutes")} />}
              </Field>
            </>
          ) : null}
        </div>
      </fieldset>

      <div className="flex gap-3 border-t border-slate-100 pt-5">
        <SubmitButton pendingText="Submitting…">Submit report</SubmitButton>
        <Link href="/incidents" className={buttonClass("secondary")}>
          Cancel
        </Link>
      </div>
    </form>
  );
}
