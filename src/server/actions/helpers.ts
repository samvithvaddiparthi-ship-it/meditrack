import "server-only";
import { AppError, AuthenticationError, logServerError, toUserMessage } from "@/lib/errors";
import { AUDIT_DELAYED_WARNING, type ActionState } from "@/lib/action-state";

const SECRET_FIELDS = /password|token/i;

function echoValues(input?: FormData | Record<string, unknown>): Record<string, string> | undefined {
  if (!input) return undefined;
  const entries = input instanceof FormData ? [...input.entries()] : Object.entries(input);
  const values: Record<string, string> = {};
  for (const [key, value] of entries) {
    if (SECRET_FIELDS.test(key) || key.startsWith("$ACTION")) continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") values[key] = String(value);
  }
  return values;
}

/** Converts a thrown error into form state without leaking internals. */
export function actionError(error: unknown, input?: FormData | Record<string, unknown>): ActionState {
  if (error instanceof AuthenticationError) {
    return { ok: false, message: "Your session has expired. Please sign in again." };
  }
  if (!(error instanceof AppError)) {
    const message = toUserMessage(error, "");
    if (!message) logServerError("Server action failed", error);
    return { ok: false, message: message || "The operation could not be completed. No changes were saved.", values: echoValues(input) };
  }
  return { ok: false, message: error.message, fieldErrors: error.fieldErrors, values: echoValues(input) };
}

export function success(message: string, auditDelivered = true, data?: unknown): ActionState {
  return { ok: true, message, warning: auditDelivered ? undefined : AUDIT_DELAYED_WARNING, data };
}
