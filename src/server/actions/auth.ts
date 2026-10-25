"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { ActionState } from "@/lib/action-state";
import { AppError, logServerError } from "@/lib/errors";
import { clearSessionCookie, readSessionToken, setSessionCookie } from "@/server/auth/session";
import { login, logout } from "@/server/services/auth.service";

function safeNext(value: FormDataEntryValue | null): string {
  const next = typeof value === "string" ? value : "";
  // Only same-site relative paths (prevents open redirects).
  return next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/login") ? next : "/dashboard";
}

export async function loginAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const email = formData.get("email");
  try {
    const userAgent = (await headers()).get("user-agent");
    const result = await login({ email, password: formData.get("password") }, { userAgent });
    await setSessionCookie(result.token, result.expiresAt);
  } catch (error) {
    if (!(error instanceof AppError)) logServerError("Login failed", error);
    const message = error instanceof AppError ? error.message : "Sign-in is temporarily unavailable. Please try again.";
    return { ok: false, message, values: { email: typeof email === "string" ? email : "" } };
  }
  redirect(safeNext(formData.get("next")));
}

export async function logoutAction(): Promise<void> {
  try {
    await logout(await readSessionToken());
  } catch (error) {
    logServerError("Logout failed", error);
  }
  await clearSessionCookie();
  redirect("/login");
}
