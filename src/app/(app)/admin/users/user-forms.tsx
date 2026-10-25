"use client";

import { useActionState } from "react";
import type { ActionState } from "@/lib/action-state";
import { Checkbox, Field, FormMessage, Input, Select, SubmitButton, fieldError, previous } from "@/components/ui/form";

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

export function CreateUserForm({ action }: { action: Action }) {
  const [state, formAction] = useActionState(action, null);
  return (
    <form action={formAction} className="space-y-5" noValidate>
      <FormMessage state={state} />
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Full name" name="name" required error={fieldError(state, "name")}>
          {(p) => <Input {...p} defaultValue={previous(state, "name")} maxLength={100} />}
        </Field>
        <Field label="Email" name="email" required error={fieldError(state, "email")}>
          {(p) => <Input {...p} type="email" defaultValue={previous(state, "email")} maxLength={191} autoComplete="off" />}
        </Field>
        <Field label="Role" name="role" required error={fieldError(state, "role")}>
          {(p) => (
            <Select {...p} defaultValue={previous(state, "role", "STAFF")}>
              <option value="STAFF">Staff</option>
              <option value="ADMIN">Admin</option>
            </Select>
          )}
        </Field>
        <Field label="Initial password" name="password" required error={fieldError(state, "password")} hint="At least 10 characters with letters and numbers. Share it securely.">
          {(p) => <Input {...p} type="password" autoComplete="new-password" />}
        </Field>
      </div>
      <SubmitButton>Create account</SubmitButton>
    </form>
  );
}

export function EditUserForm({ action, initial, isSelf }: { action: Action; initial: { name: string; role: string; isActive: boolean }; isSelf: boolean }) {
  const [state, formAction] = useActionState(action, null);
  return (
    <form action={formAction} className="space-y-5" noValidate>
      <FormMessage state={state} />
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Full name" name="name" required error={fieldError(state, "name")}>
          {(p) => <Input {...p} defaultValue={previous(state, "name", initial.name)} maxLength={100} />}
        </Field>
        <Field label="Role" name="role" required error={fieldError(state, "role")} hint={isSelf ? "You cannot change your own role" : undefined}>
          {(p) => (
            <>
              <Select {...p} defaultValue={previous(state, "role", initial.role)} disabled={isSelf}>
                <option value="STAFF">Staff</option>
                <option value="ADMIN">Admin</option>
              </Select>
              {isSelf ? <input type="hidden" name="role" value={initial.role} /> : null}
            </>
          )}
        </Field>
      </div>
      {isSelf ? (
        <input type="hidden" name="isActive" value="on" />
      ) : (
        <Checkbox name="isActive" label="Account active" hint="Deactivating signs the user out immediately" defaultChecked={state?.values ? state.values.isActive === "on" : initial.isActive} />
      )}
      <SubmitButton>Save changes</SubmitButton>
    </form>
  );
}

export function ResetPasswordForm({ action }: { action: Action }) {
  const [state, formAction] = useActionState(action, null);
  return (
    <form action={formAction} className="space-y-4" noValidate>
      <FormMessage state={state} />
      <Field label="New password" name="password" required error={fieldError(state, "password")} hint="At least 10 characters with letters and numbers">
        {(p) => <Input {...p} type="password" autoComplete="new-password" />}
      </Field>
      <Field label="Confirm password" name="confirmPassword" required error={fieldError(state, "confirmPassword")}>
        {(p) => <Input {...p} type="password" autoComplete="new-password" />}
      </Field>
      <SubmitButton variant="warning">Reset password</SubmitButton>
    </form>
  );
}
