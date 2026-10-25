"use client";

import { useActionState } from "react";
import { loginAction } from "@/server/actions/auth";
import { Field, Input, SubmitButton } from "@/components/ui/form";
import { Alert } from "@/components/ui/primitives";

export function LoginForm({ next }: { next?: string }) {
  const [state, action] = useActionState(loginAction, null);
  return (
    <form action={action} className="space-y-4" noValidate>
      {state?.message ? <Alert tone="danger">{state.message}</Alert> : null}
      <input type="hidden" name="next" value={next ?? ""} />
      <Field label="Email" name="email" required>
        {(p) => <Input {...p} type="email" autoComplete="username" defaultValue={state?.values?.email ?? ""} placeholder="you@hospital.org" />}
      </Field>
      <Field label="Password" name="password" required>
        {(p) => <Input {...p} type="password" autoComplete="current-password" />}
      </Field>
      <SubmitButton className="w-full" pendingText="Signing in…">
        Sign in
      </SubmitButton>
    </form>
  );
}
