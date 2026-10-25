"use client";

import { useActionState } from "react";
import Link from "next/link";
import type { ActionState } from "@/lib/action-state";
import { Checkbox, Field, FormMessage, Input, Select, SubmitButton, Textarea, fieldError, previous } from "@/components/ui/form";
import { buttonClass } from "@/components/ui/primitives";
import { humanize } from "@/lib/format";

const DOSAGE_FORMS = ["TABLET", "CAPSULE", "SYRUP", "SUSPENSION", "INJECTION", "OINTMENT", "CREAM", "DROPS", "INHALER", "POWDER", "OTHER"];
const STORAGE = ["ROOM_TEMPERATURE", "COOL_DRY", "REFRIGERATED", "FROZEN"];

export type MedicineFormValues = {
  name: string;
  genericName: string | null;
  categoryId: number | null;
  manufacturer: string;
  dosageForm: string;
  strength: string;
  unit: string;
  storageCondition: string;
  description: string | null;
  reorderLevel: number;
  isActive: boolean;
};

export function MedicineForm({
  action,
  categories,
  initial,
  submitLabel,
  cancelHref,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  categories: { id: number; name: string }[];
  initial?: MedicineFormValues;
  submitLabel: string;
  cancelHref: string;
}) {
  const [state, formAction] = useActionState(action, null);
  const v = (name: keyof MedicineFormValues, fallback?: string | number | null) => previous(state, name, fallback ?? (initial ? (initial[name] as string | number | null) : undefined));

  return (
    <form action={formAction} className="space-y-6" noValidate>
      <FormMessage state={state} />
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Medicine name" name="name" required error={fieldError(state, "name")}>
          {(p) => <Input {...p} defaultValue={v("name")} maxLength={120} placeholder="e.g. Paracetamol" />}
        </Field>
        <Field label="Generic name" name="genericName" error={fieldError(state, "genericName")} hint="Optional; searchable">
          {(p) => <Input {...p} defaultValue={v("genericName")} maxLength={120} />}
        </Field>
        <Field label="Category" name="categoryId" required error={fieldError(state, "categoryId")}>
          {(p) => (
            <Select {...p} defaultValue={v("categoryId") ?? ""}>
              <option value="" disabled>
                Choose a category
              </option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Manufacturer" name="manufacturer" required error={fieldError(state, "manufacturer")}>
          {(p) => <Input {...p} defaultValue={v("manufacturer")} maxLength={120} />}
        </Field>
        <Field label="Dosage form" name="dosageForm" required error={fieldError(state, "dosageForm")}>
          {(p) => (
            <Select {...p} defaultValue={v("dosageForm") ?? "TABLET"}>
              {DOSAGE_FORMS.map((f) => (
                <option key={f} value={f}>
                  {humanize(f)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Strength" name="strength" required error={fieldError(state, "strength")} hint="e.g. 500 mg, 100 IU/mL">
          {(p) => <Input {...p} defaultValue={v("strength")} maxLength={40} />}
        </Field>
        <Field label="Stock unit" name="unit" required error={fieldError(state, "unit")} hint="The unit stock is counted in: strip, bottle, vial…">
          {(p) => <Input {...p} defaultValue={v("unit", initial?.unit ?? "strip")} maxLength={20} />}
        </Field>
        <Field label="Storage condition" name="storageCondition" required error={fieldError(state, "storageCondition")}>
          {(p) => (
            <Select {...p} defaultValue={v("storageCondition") ?? "ROOM_TEMPERATURE"}>
              {STORAGE.map((s) => (
                <option key={s} value={s}>
                  {humanize(s)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Reorder level" name="reorderLevel" required error={fieldError(state, "reorderLevel")} hint="Low-stock alert when usable stock is at or below this level">
          {(p) => <Input {...p} type="number" min={0} step={1} inputMode="numeric" defaultValue={v("reorderLevel", initial?.reorderLevel ?? 0)} />}
        </Field>
        <div className="flex items-end pb-2">
          <Checkbox
            name="isActive"
            label="Active"
            hint="Inactive medicines cannot be received or issued"
            defaultChecked={state?.values ? state.values.isActive === "on" : (initial?.isActive ?? true)}
          />
        </div>
        <Field label="Description" name="description" className="sm:col-span-2" error={fieldError(state, "description")}>
          {(p) => <Textarea {...p} defaultValue={v("description")} maxLength={1000} rows={3} />}
        </Field>
      </div>
      <div className="flex gap-3 border-t border-slate-100 pt-5">
        <SubmitButton>{submitLabel}</SubmitButton>
        <Link href={cancelHref} className={buttonClass("secondary")}>
          Cancel
        </Link>
      </div>
    </form>
  );
}
