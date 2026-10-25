const currency = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 2,
});
const integer = new Intl.NumberFormat("en-IN");

/** Converts bigint / Prisma.Decimal / numeric strings from raw SQL to number. */
export function num(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  return Number(String(value));
}

export function formatCurrency(value: unknown): string {
  return currency.format(num(value));
}

export function formatNumber(value: unknown): string {
  return integer.format(num(value));
}

/** "ROOM_TEMPERATURE" -> "Room temperature". */
export function humanize(value: string | null | undefined): string {
  if (!value) return "—";
  const text = value.toLowerCase().replace(/_/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${formatNumber(count)} ${count === 1 ? singular : plural}`;
}
