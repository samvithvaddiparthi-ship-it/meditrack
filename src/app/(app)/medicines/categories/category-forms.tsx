"use client";

import { useActionState } from "react";
import type { ActionState } from "@/lib/action-state";
import { Field, FormMessage, Input, SubmitButton, fieldError, previous } from "@/components/ui/form";

export function CategoryForm({
  action,
  initial,
  submitLabel,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  initial?: { id: number; name: string; description: string | null };
  submitLabel: string;
}) {
  const [state, formAction] = useActionState(action, null);
  return (
    <form action={formAction} className="space-y-3" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="id" value={initial?.id ?? ""} />
      <div className="grid gap-3 sm:grid-cols-[1fr_2fr_auto] sm:items-end">
        <Field label="Name" name="name" required error={fieldError(state, "name")}>
          {(p) => <Input {...p} defaultValue={previous(state, "name", initial?.name)} maxLength={60} />}
        </Field>
        <Field label="Description" name="description" error={fieldError(state, "description")}>
          {(p) => <Input {...p} defaultValue={previous(state, "description", initial?.description)} maxLength={255} />}
        </Field>
        <SubmitButton variant={initial ? "secondary" : "primary"}>{submitLabel}</SubmitButton>
      </div>
    </form>
  );
}
