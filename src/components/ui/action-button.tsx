"use client";

import { useActionState, useId, type ReactNode } from "react";
import type { ActionState } from "@/lib/action-state";
import { ConfirmSubmit, SubmitButton } from "@/components/ui/form";
import { Alert } from "@/components/ui/primitives";

/**
 * A single-button form bound to a server action, optionally behind a
 * confirmation dialog. Errors returned by the action are shown inline.
 */
export function ActionButton({
  action,
  label,
  confirm,
  variant = "secondary",
  pendingText = "Working…",
}: {
  action: (prev: ActionState) => Promise<ActionState>;
  label: ReactNode;
  confirm?: { title: string; message: ReactNode; confirmLabel?: string };
  variant?: "primary" | "secondary" | "danger" | "warning";
  pendingText?: string;
}) {
  const [state, formAction] = useActionState(action, null);
  const formId = useId();
  return (
    <div className="inline-flex flex-col items-end gap-2">
      <form id={formId} action={formAction}>
        {confirm ? (
          <ConfirmSubmit formId={formId} label={label} title={confirm.title} message={confirm.message} confirmLabel={confirm.confirmLabel} variant={variant} size="md" />
        ) : (
          <SubmitButton variant={variant} pendingText={pendingText}>
            {label}
          </SubmitButton>
        )}
      </form>
      {state?.message ? (
        <Alert tone={state.ok ? "success" : "danger"} className="max-w-sm text-left">
          {state.message}
        </Alert>
      ) : null}
    </div>
  );
}
