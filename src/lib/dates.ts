/**
 * Date strategy (mirrors fn_business_today() / fn_business_date() in MySQL):
 *
 *  - Timestamps (created_at, updated_at, ...) are DATETIME(3) in UTC.
 *  - Calendar facts (manufacture / expiry / purchase dates) are DATE values.
 *    Prisma represents a DATE as a JS Date at 00:00:00 UTC of that day.
 *  - "Today" is the calendar date in the business time zone, India Standard
 *    Time (UTC+05:30, no daylight saving).
 *  - A batch is EXPIRED on and after its expiry date (expiry_date <= today):
 *    stock is never issued on its expiry day.
 */

export const BUSINESS_TIME_ZONE = "Asia/Kolkata";
const BUSINESS_OFFSET_MINUTES = 330; // +05:30
const DAY_MS = 86_400_000;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** "YYYY-MM-DD" for the current business date (or for `now`). */
export function businessTodayIso(now: Date = new Date()): string {
  return new Date(now.getTime() + BUSINESS_OFFSET_MINUTES * 60_000).toISOString().slice(0, 10);
}

/** Today's business date as a DATE-compatible value (UTC midnight). */
export function businessToday(now: Date = new Date()): Date {
  return dateOnly(businessTodayIso(now));
}

/** Parses "YYYY-MM-DD" into a UTC-midnight Date; throws on invalid input. */
export function dateOnly(iso: string): Date {
  if (!ISO_DATE.test(iso)) throw new Error(`Invalid calendar date: ${iso}`);
  const d = new Date(`${iso}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso) {
    throw new Error(`Invalid calendar date: ${iso}`);
  }
  return d;
}

export function isValidIsoDate(value: string): boolean {
  try {
    dateOnly(value);
    return true;
  } catch {
    return false;
  }
}

/** "YYYY-MM-DD" of a DATE value returned by Prisma (or a driver string). */
export function toIsoDate(value: Date | string): string {
  if (typeof value === "string") return value.slice(0, 10);
  return value.toISOString().slice(0, 10);
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

/** Whole days from today (business date) until `expiry`; 0 = expires today. */
export function daysUntil(expiry: Date | string, today: Date = businessToday()): number {
  const target = typeof expiry === "string" ? dateOnly(expiry.slice(0, 10)) : expiry;
  return Math.round((target.getTime() - today.getTime()) / DAY_MS);
}

export type BatchStatus = "DEPLETED" | "EXPIRED" | "EXPIRING_SOON" | "AVAILABLE";

/** Same rules as fn_batch_status() in MySQL. */
export function batchStatus(
  quantity: number,
  expiry: Date | string,
  windowDays: number,
  today: Date = businessToday(),
): BatchStatus {
  if (quantity === 0) return "DEPLETED";
  const days = daysUntil(expiry, today);
  if (days <= 0) return "EXPIRED";
  if (days <= windowDays) return "EXPIRING_SOON";
  return "AVAILABLE";
}

const dateFormatter = new Intl.DateTimeFormat("en-IN", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

const dateTimeFormatter = new Intl.DateTimeFormat("en-IN", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: BUSINESS_TIME_ZONE,
});

/** Formats a DATE value (calendar date, no time-zone shift). */
export function formatDate(value: Date | string | null | undefined): string {
  if (!value) return "—";
  const d = typeof value === "string" ? dateOnly(value.slice(0, 10)) : value;
  return dateFormatter.format(d);
}

/** Formats a UTC timestamp in the business time zone. */
export function formatDateTime(value: Date | string | null | undefined): string {
  if (!value) return "—";
  return dateTimeFormatter.format(typeof value === "string" ? new Date(value) : value);
}
