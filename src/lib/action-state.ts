/** Result returned by server actions to client forms. */
export type ActionState = {
  ok: boolean;
  message?: string;
  /** Extra non-blocking note, e.g. audit log delivery delayed. */
  warning?: string;
  fieldErrors?: Record<string, string[]>;
  /** Submitted values echoed back so a failed form keeps the user's input. */
  values?: Record<string, string>;
  data?: unknown;
} | null;

export const AUDIT_DELAYED_WARNING =
  "Saved. The activity log entry will be delivered when the MongoDB service is reachable.";
