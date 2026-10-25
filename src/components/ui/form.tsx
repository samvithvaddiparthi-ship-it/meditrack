"use client";

import { useEffect, useId, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { cn } from "@/lib/cn";
import { Alert, buttonClass } from "@/components/ui/primitives";
import type { ActionState } from "@/lib/action-state";

const controlClass =
  "block w-full rounded-lg border-0 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm ring-1 ring-inset ring-slate-300 placeholder:text-slate-400 focus:ring-2 focus:ring-inset focus:ring-brand-500 disabled:bg-slate-50 disabled:text-slate-500 aria-[invalid=true]:ring-red-400";

type FieldProps = {
  label: string;
  name: string;
  error?: string[] | string;
  hint?: ReactNode;
  required?: boolean;
  className?: string;
  children: (props: { id: string; name: string; "aria-invalid"?: boolean; "aria-describedby"?: string; required?: boolean }) => ReactNode;
};

/** Label + control + hint + error, wired together for screen readers. */
export function Field({ label, name, error, hint, required, className, children }: FieldProps) {
  const id = useId();
  const errors = Array.isArray(error) ? error : error ? [error] : [];
  const describedBy = [hint ? `${id}-hint` : null, errors.length ? `${id}-error` : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-slate-700">
        {label}
        {required ? <span className="ml-0.5 text-red-600" aria-hidden>*</span> : null}
      </label>
      {children({ id, name, "aria-invalid": errors.length ? true : undefined, "aria-describedby": describedBy, required })}
      {hint ? (
        <p id={`${id}-hint`} className="mt-1 text-xs text-slate-500">
          {hint}
        </p>
      ) : null}
      {errors.length ? (
        <p id={`${id}-error`} className="mt-1 text-xs font-medium text-red-600">
          {errors[0]}
        </p>
      ) : null}
    </div>
  );
}

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn(controlClass, className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cn(controlClass, "min-h-20", className)} {...props} />;
}

export function Select({ className, children, ...props }: ComponentProps<"select">) {
  return (
    <select className={cn(controlClass, "pr-8", className)} {...props}>
      {children}
    </select>
  );
}

export function Checkbox({ label, hint, ...props }: ComponentProps<"input"> & { label: string; hint?: string }) {
  const id = useId();
  return (
    <div className="flex items-start gap-3">
      <input id={id} type="checkbox" className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500" {...props} />
      <label htmlFor={id} className="text-sm">
        <span className="font-medium text-slate-700">{label}</span>
        {hint ? <span className="block text-xs text-slate-500">{hint}</span> : null}
      </label>
    </div>
  );
}

/** Submit button that disables itself while its form's action is pending. */
export function SubmitButton({
  children,
  pendingText = "Saving…",
  variant = "primary",
  size = "md",
  className,
  disabled,
  ...props
}: ComponentProps<"button"> & { pendingText?: string; variant?: "primary" | "secondary" | "danger" | "warning"; size?: "sm" | "md" }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending || disabled} aria-disabled={pending || disabled} className={buttonClass(variant, size, className)} {...props}>
      {pending ? (
        <>
          <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-r-transparent" aria-hidden />
          {pendingText}
        </>
      ) : (
        children
      )}
    </button>
  );
}

/** Form-level success / error message from a server action. */
export function FormMessage({ state }: { state: ActionState }) {
  if (!state?.message) return null;
  return (
    <Alert tone={state.ok ? "success" : "danger"} className="mb-4">
      {state.message}
      {state.ok && state.warning ? <p className="mt-1 text-xs">{state.warning}</p> : null}
    </Alert>
  );
}

/**
 * Wraps a destructive / important form submit in a confirmation dialog.
 * The dialog is a native <dialog>, so focus is trapped and Esc cancels.
 */
export function ConfirmSubmit({
  label,
  title,
  message,
  confirmLabel = "Confirm",
  variant = "danger",
  size = "sm",
  formId,
}: {
  label: ReactNode;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  variant?: "primary" | "secondary" | "danger" | "warning";
  size?: "sm" | "md";
  formId?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const { pending } = useFormStatus();
  return (
    <>
      <button type="button" className={buttonClass(variant, size)} disabled={pending} onClick={() => dialog.current?.showModal()}>
        {pending ? "Working…" : label}
      </button>
      <dialog ref={dialog} className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-xl p-0 shadow-xl" aria-labelledby={`${formId ?? "confirm"}-title`}>
        <div className="p-5">
          <h2 id={`${formId ?? "confirm"}-title`} className="text-base font-semibold text-slate-900">
            {title}
          </h2>
          <div className="mt-2 text-sm text-slate-600">{message}</div>
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 bg-slate-50 px-5 py-3">
          <button type="button" className={buttonClass("secondary", "sm")} onClick={() => dialog.current?.close()} autoFocus>
            Cancel
          </button>
          <button type="submit" form={formId} className={buttonClass(variant === "secondary" ? "primary" : variant, "sm")} onClick={() => dialog.current?.close()}>
            {confirmLabel}
          </button>
        </div>
      </dialog>
    </>
  );
}

/** A per-render idempotency token for duplicate-submission protection. */
export function useIdempotencyKey(): [string, () => void] {
  const [key, setKey] = useState("");
  useEffect(() => {
    // Generated after mount so server and client HTML match (no hydration mismatch).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setKey(crypto.randomUUID());
  }, []);
  return [key, () => setKey(crypto.randomUUID())];
}

export function fieldError(state: ActionState, name: string): string[] | undefined {
  return state?.fieldErrors?.[name];
}

export function previous(state: ActionState, name: string, fallback?: string | number | null): string | undefined {
  const v = state?.values?.[name];
  if (v !== undefined) return v;
  return fallback === null || fallback === undefined ? undefined : String(fallback);
}
