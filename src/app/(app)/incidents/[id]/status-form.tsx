"use client";

import { useActionState } from "react";
import type { ActionState } from "@/lib/action-state";
import { Field, FormMessage, Select, SubmitButton, Textarea, fieldError, previous } from "@/components/ui/form";
import { humanize } from "@/lib/format";

export function StatusForm({ action, options }: { action: (prev: ActionState, formData: FormData) => Promise<ActionState>; options: string[] }) {
  const [state, formAction] = useActionState(action, null);
  return (
    <form action={formAction} className="space-y-4" noValidate>
      <FormMessage state={state} />
      <Field label="New status" name="status" required error={fieldError(state, "status")}>
        {(p) => (
          <Select {...p} defaultValue={previous(state, "status", options[0])}>
            {options.map((o) => (
              <option key={o} value={o}>
                {humanize(o)}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="Review note" name="note" required error={fieldError(state, "note")} hint="Added to the report's timeline">
        {(p) => <Textarea {...p} rows={3} maxLength={1000} defaultValue={previous(state, "note")} />}
      </Field>
      <SubmitButton pendingText="Updating…">Update status</SubmitButton>
    </form>
  );
}
