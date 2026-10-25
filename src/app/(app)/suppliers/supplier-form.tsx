"use client";

import { useActionState } from "react";
import Link from "next/link";
import type { ActionState } from "@/lib/action-state";
import { Checkbox, Field, FormMessage, Input, SubmitButton, Textarea, fieldError, previous } from "@/components/ui/form";
import { buttonClass } from "@/components/ui/primitives";

export type SupplierValues = {
  name: string;
  contactPerson: string | null;
  phone: string;
  email: string | null;
  address: string;
  licenseNumber: string | null;
  isActive: boolean;
};

export function SupplierForm({
  action,
  initial,
  submitLabel,
  cancelHref,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  initial?: SupplierValues;
  submitLabel: string;
  cancelHref: string;
}) {
  const [state, formAction] = useActionState(action, null);
  const v = (name: keyof SupplierValues) => previous(state, name, initial ? (initial[name] as string | null) : undefined);
  return (
    <form action={formAction} className="space-y-6" noValidate>
      <FormMessage state={state} />
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Supplier name" name="name" required error={fieldError(state, "name")}>
          {(p) => <Input {...p} defaultValue={v("name")} maxLength={120} />}
        </Field>
        <Field label="Contact person" name="contactPerson" error={fieldError(state, "contactPerson")}>
          {(p) => <Input {...p} defaultValue={v("contactPerson")} maxLength={100} />}
        </Field>
        <Field label="Phone" name="phone" required error={fieldError(state, "phone")}>
          {(p) => <Input {...p} type="tel" defaultValue={v("phone")} maxLength={20} placeholder="+91 80 1234 5678" />}
        </Field>
        <Field label="Email" name="email" error={fieldError(state, "email")}>
          {(p) => <Input {...p} type="email" defaultValue={v("email")} maxLength={191} />}
        </Field>
        <Field label="Drug licence number" name="licenseNumber" error={fieldError(state, "licenseNumber")} hint="Unique across suppliers">
          {(p) => <Input {...p} defaultValue={v("licenseNumber")} maxLength={50} />}
        </Field>
        <div className="flex items-end pb-2">
          <Checkbox name="isActive" label="Active" hint="Inactive suppliers cannot be used for new receipts" defaultChecked={state?.values ? state.values.isActive === "on" : (initial?.isActive ?? true)} />
        </div>
        <Field label="Address" name="address" required error={fieldError(state, "address")} className="sm:col-span-2">
          {(p) => <Textarea {...p} defaultValue={v("address")} maxLength={255} rows={2} />}
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
