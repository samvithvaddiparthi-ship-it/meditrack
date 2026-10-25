import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { formatNumber } from "@/lib/format";

export type SearchParams = Record<string, string | string[] | undefined>;

export function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function intParam(value: string | string[] | undefined): number | undefined {
  const v = first(value);
  if (!v || !/^\d{1,9}$/.test(v)) return undefined;
  const n = Number(v);
  return n > 0 ? n : undefined;
}

export function oneOf<T extends string>(value: string | string[] | undefined, allowed: readonly T[]): T | undefined {
  const v = first(value);
  return v && (allowed as readonly string[]).includes(v) ? (v as T) : undefined;
}

export function dateParam(value: string | string[] | undefined): string | undefined {
  const v = first(value);
  return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined;
}

/** Builds a URL that keeps the current filters and applies overrides. */
export function hrefWith(pathname: string, params: SearchParams, overrides: Record<string, string | number | undefined | null>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    const v = first(value);
    if (v !== undefined && v !== "" && key !== "notice") query.set(key, v);
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined || value === null || value === "") query.delete(key);
    else query.set(key, String(value));
  }
  const qs = query.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

export function Pagination({ pathname, params, page, pageSize, total }: { pathname: string; params: SearchParams; page: number; pageSize: number; total: number }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total === 0) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  const link = (target: number, label: string, disabled: boolean) =>
    disabled ? (
      <span className="rounded-lg px-3 py-1.5 text-sm text-slate-300" aria-disabled>
        {label}
      </span>
    ) : (
      <Link href={hrefWith(pathname, params, { page: target === 1 ? undefined : target })} className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-700 ring-1 ring-inset ring-slate-300 hover:bg-slate-50">
        {label}
      </Link>
    );
  return (
    <nav className="flex flex-col items-center justify-between gap-3 border-t border-slate-100 px-4 py-3 sm:flex-row" aria-label="Pagination">
      <p className="text-sm text-slate-500">
        Showing <span className="font-medium text-slate-700">{formatNumber(from)}</span>–<span className="font-medium text-slate-700">{formatNumber(to)}</span> of{" "}
        <span className="font-medium text-slate-700">{formatNumber(total)}</span>
      </p>
      <div className="flex items-center gap-2">
        {link(page - 1, "Previous", page <= 1)}
        <span className="text-sm text-slate-500">
          Page {page} of {pages}
        </span>
        {link(page + 1, "Next", page >= pages)}
      </div>
    </nav>
  );
}

/** Column header that toggles sort order via the URL (works without JS). */
export function SortHeader({
  pathname,
  params,
  column,
  label,
  defaultSort,
  align = "left",
}: {
  pathname: string;
  params: SearchParams;
  column: string;
  label: string;
  defaultSort: string;
  align?: "left" | "right";
}) {
  const sort = first(params.sort) ?? defaultSort;
  const dir = first(params.dir) === "desc" ? "desc" : "asc";
  const active = sort === column;
  const nextDir = active && dir === "asc" ? "desc" : "asc";
  return (
    <th scope="col" aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"} className={cn("bg-slate-50 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500", align === "right" ? "text-right" : "text-left")}>
      <Link href={hrefWith(pathname, params, { sort: column, dir: nextDir, page: undefined })} className="inline-flex items-center gap-1 hover:text-slate-900">
        {label}
        <span aria-hidden className={cn("text-[10px]", active ? "text-brand-600" : "text-slate-300")}>
          {active ? (dir === "asc" ? "▲" : "▼") : "↕"}
        </span>
      </Link>
    </th>
  );
}

/** GET filter form: submitting reloads the page with query parameters. */
export function FilterBar({ children, resetHref }: { children: ReactNode; resetHref: string }) {
  return (
    <form method="get" className="flex flex-col gap-3 border-b border-slate-100 px-4 py-3 lg:flex-row lg:flex-wrap lg:items-end" role="search">
      {children}
      <div className="flex gap-2">
        <button type="submit" className="inline-flex h-10 items-center rounded-lg bg-slate-800 px-4 text-sm font-medium text-white hover:bg-slate-900">
          Apply
        </button>
        <Link href={resetHref} className="inline-flex h-10 items-center rounded-lg px-3 text-sm font-medium text-slate-600 hover:bg-slate-100">
          Reset
        </Link>
      </div>
    </form>
  );
}

const filterControl =
  "block h-10 w-full rounded-lg border-0 bg-white px-3 text-sm text-slate-900 shadow-sm ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-inset focus:ring-brand-500";

export function FilterInput({ label, name, defaultValue, type = "text", placeholder, className }: { label: string; name: string; defaultValue?: string; type?: string; placeholder?: string; className?: string }) {
  return (
    <label className={cn("block min-w-0 lg:w-56", className)}>
      <span className="mb-1 block text-xs font-medium text-slate-600">{label}</span>
      <input type={type} name={name} defaultValue={defaultValue} placeholder={placeholder} className={filterControl} />
    </label>
  );
}

export function FilterSelect({
  label,
  name,
  defaultValue,
  options,
  className,
}: {
  label: string;
  name: string;
  defaultValue?: string;
  options: { value: string; label: string }[];
  className?: string;
}) {
  return (
    <label className={cn("block min-w-0 lg:w-48", className)}>
      <span className="mb-1 block text-xs font-medium text-slate-600">{label}</span>
      <select name={name} defaultValue={defaultValue ?? ""} className={cn(filterControl, "pr-8")}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
