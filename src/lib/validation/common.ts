import { z } from "zod";
import { businessTodayIso, isValidIsoDate } from "@/lib/dates";
import { ValidationError } from "@/lib/errors";

const blankToUndefined = (v: unknown) =>
  v === "" || v === null || (typeof v === "string" && v.trim() === "") ? undefined : v;

/** Required trimmed text. */
export const text = (label: string, min: number, max: number) =>
  z
    .string({ error: `${label} is required.` })
    .trim()
    .min(min, min <= 1 ? `${label} is required.` : `${label} must be at least ${min} characters.`)
    .max(max, `${label} must be at most ${max} characters.`);

/** Optional trimmed text; blank becomes null. */
export const optionalText = (label: string, max: number) =>
  z.preprocess(
    blankToUndefined,
    z.string().trim().max(max, `${label} must be at most ${max} characters.`).optional(),
  ).transform((v) => v ?? null);

/** Whole number within [min, max], accepting numeric strings from forms. */
export const int = (label: string, min: number, max: number) =>
  z.preprocess(
    blankToUndefined,
    z.coerce
      .number({ error: `${label} must be a whole number.` })
      .int(`${label} must be a whole number.`)
      .min(min, `${label} must be at least ${min}.`)
      .max(max, `${label} must be at most ${max}.`),
  );

export const id = (label: string) => int(label, 1, 2_147_483_647);

/** Money amount with at most two decimals. */
export const money = (label: string, max = 9_999_999) =>
  z.preprocess(
    blankToUndefined,
    z.coerce
      .number({ error: `${label} must be a number.` })
      .min(0, `${label} cannot be negative.`)
      .max(max, `${label} is too large.`)
      .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, `${label} can have at most 2 decimals.`),
  );

/** Calendar date "YYYY-MM-DD". */
export const isoDate = (label: string) =>
  z
    .string({ error: `${label} is required.` })
    .trim()
    .refine(isValidIsoDate, `${label} must be a valid date (YYYY-MM-DD).`);

export const notFutureDate = (label: string) =>
  isoDate(label).refine((v) => v <= businessTodayIso(), `${label} cannot be in the future.`);

/** HTML checkbox: "on" / "true" / true => true, missing => false. */
export const checkbox = z.preprocess(
  (v) => v === true || v === "on" || v === "true" || v === "1",
  z.boolean(),
);

export const email = z.preprocess(
  (v) => (typeof v === "string" ? v.trim().toLowerCase() : v),
  z.email("Enter a valid email address.").max(191, "Email must be at most 191 characters."),
);

export const optionalEmail = z.preprocess(
  (v) => {
    const b = blankToUndefined(v);
    return typeof b === "string" ? b.trim().toLowerCase() : b;
  },
  z.email("Enter a valid email address.").max(191).optional(),
).transform((v) => v ?? null);

export const idempotencyKey = z.uuid("Form token is missing or invalid; reload the page and try again.");

/**
 * Parses `input` with `schema` or throws a ValidationError carrying
 * per-field messages for the form.
 */
export function parseInput<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.length ? issue.path.join(".") : "_form";
    (fieldErrors[key] ??= []).push(issue.message);
  }
  const first = result.error.issues[0]?.message ?? "Invalid input.";
  throw new ValidationError(
    Object.keys(fieldErrors).length > 1 ? "Please correct the highlighted fields." : first,
    fieldErrors,
  );
}

/** FormData -> plain object (last value wins; use getAll for repeated keys). */
export function formToObject(form: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of form.entries()) {
    if (typeof value === "string") out[key] = value;
  }
  return out;
}
