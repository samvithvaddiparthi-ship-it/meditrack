"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";

/**
 * Small, dependency-free charts. Categorical colours come from a validated
 * palette (fixed order, never cycled); every chart has a legend for 2+
 * series, hover/focus tooltips, and a table view so values are never
 * colour- or hover-only.
 */
export const SERIES_COLORS = ["#2a78d6", "#eb6834", "#1baf7a"] as const;

const fmt = new Intl.NumberFormat("en-IN");
const currencyFmt = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });

/** Props must be serialisable (server -> client), so formats are named. */
export type ValueFormat = "number" | "currency";
const formatters: Record<ValueFormat, (n: number) => string> = {
  number: (n) => fmt.format(n),
  currency: (n) => currencyFmt.format(n),
};

type Series = { name: string; values: number[] };

function niceMax(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 2.5, 5, 10].find((s) => s * magnitude >= value) ?? 10;
  return step * magnitude;
}

function Legend({ series }: { series: Series[] }) {
  if (series.length < 2) return null;
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600" aria-label="Legend">
      {series.map((s, i) => (
        <li key={s.name} className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: SERIES_COLORS[i] }} aria-hidden />
          {s.name}
        </li>
      ))}
    </ul>
  );
}

function TableView({ categories, series, categoryLabel, format }: { categories: string[]; series: Series[]; categoryLabel: string; format: (n: number) => string }) {
  return (
    <details className="mt-3 text-sm">
      <summary className="cursor-pointer text-xs font-medium text-slate-500 hover:text-slate-700">Show data table</summary>
      <div className="mt-2 overflow-x-auto">
        <table className="min-w-full text-xs">
          <thead>
            <tr className="text-left text-slate-500">
              <th className="py-1 pr-4 font-medium">{categoryLabel}</th>
              {series.map((s) => (
                <th key={s.name} className="py-1 pr-4 text-right font-medium">
                  {s.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="tabular text-slate-700">
            {categories.map((c, ci) => (
              <tr key={c} className="border-t border-slate-100">
                <td className="py-1 pr-4">{c}</td>
                {series.map((s) => (
                  <td key={s.name} className="py-1 pr-4 text-right">
                    {format(s.values[ci] ?? 0)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

/** Grouped column chart (≤ 3 series) over categorical / time buckets. */
export function ColumnChart({
  categories,
  series,
  title,
  categoryLabel = "Period",
  valueFormat = "number",
  height = 180,
  tickLabels,
}: {
  categories: string[];
  series: Series[];
  title: string;
  categoryLabel?: string;
  valueFormat?: ValueFormat;
  height?: number;
  /** Optional x-axis labels (same length as categories; "" hides a tick). */
  tickLabels?: string[];
}) {
  const format = formatters[valueFormat];
  const [active, setActive] = useState<number | null>(null);
  const max = niceMax(Math.max(0, ...series.flatMap((s) => s.values)));
  const ticks = [0, max / 2, max];
  const barWidth = Math.max(4, Math.min(24, Math.floor(160 / (categories.length * series.length))));

  return (
    <figure aria-label={title}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <Legend series={series} />
      </div>
      <div className="flex gap-2">
        {/* y-axis ticks */}
        <div className="tabular relative w-10 shrink-0 text-right text-[11px] text-slate-400" style={{ height }} aria-hidden>
          {ticks.map((t) => (
            <span key={t} className="absolute right-0 -translate-y-1/2" style={{ top: `${100 - (t / max) * 100}%` }}>
              {fmt.format(t)}
            </span>
          ))}
        </div>
        <div className="relative min-w-0 flex-1">
          {/* gridlines */}
          <div className="pointer-events-none absolute inset-x-0 top-0" style={{ height }} aria-hidden>
            {ticks.map((t) => (
              <div key={t} className="absolute inset-x-0 border-t border-slate-100" style={{ top: `${100 - (t / max) * 100}%` }} />
            ))}
          </div>
          <div className="relative flex items-end" style={{ height }} role="list">
            {categories.map((c, ci) => (
              <div
                key={c}
                role="listitem"
                tabIndex={0}
                aria-label={`${c}: ${series.map((s) => `${s.name} ${format(s.values[ci] ?? 0)}`).join(", ")}`}
                onPointerEnter={() => setActive(ci)}
                onPointerLeave={() => setActive((a) => (a === ci ? null : a))}
                onFocus={() => setActive(ci)}
                onBlur={() => setActive((a) => (a === ci ? null : a))}
                className={cn("relative flex h-full flex-1 items-end justify-center gap-[2px] rounded-md outline-none", active === ci && "bg-slate-50")}
              >
                {series.map((s, si) => {
                  const v = s.values[ci] ?? 0;
                  return (
                    <div
                      key={s.name}
                      className="rounded-t-[4px] transition-opacity"
                      style={{
                        width: barWidth,
                        height: v > 0 ? `max(${(v / max) * 100}%, 2px)` : 0,
                        background: SERIES_COLORS[si],
                        opacity: active === null || active === ci ? 1 : 0.55,
                      }}
                    />
                  );
                })}
                {active === ci ? (
                  <div className="pointer-events-none absolute bottom-full z-10 mb-2 w-max min-w-32 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg">
                    <p className="mb-1 font-medium text-slate-500">{c}</p>
                    {series.map((s, si) => (
                      <p key={s.name} className="flex items-center gap-2">
                        <span className="h-0.5 w-3 rounded" style={{ background: SERIES_COLORS[si] }} aria-hidden />
                        <span className="tabular font-semibold text-slate-900">{format(s.values[ci] ?? 0)}</span>
                        <span className="text-slate-500">{s.name}</span>
                      </p>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
          <div className="mt-1 flex border-t border-slate-200 pt-1" aria-hidden>
            {categories.map((c, ci) => (
              <span key={c} className="min-w-0 flex-1 overflow-visible whitespace-nowrap text-center text-[11px] text-slate-400">
                {tickLabels ? tickLabels[ci] : c}
              </span>
            ))}
          </div>
        </div>
      </div>
      <TableView categories={categories} series={series} categoryLabel={categoryLabel} format={format} />
    </figure>
  );
}

/** Horizontal bar list for a single series, value at the bar tip. */
export function BarList({
  rows,
  title,
  valueFormat = "number",
  categoryLabel = "Item",
  valueLabel = "Value",
}: {
  rows: { label: string; value: number; hint?: string }[];
  title: string;
  valueFormat?: ValueFormat;
  categoryLabel?: string;
  valueLabel?: string;
}) {
  const format = formatters[valueFormat];
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <figure aria-label={title}>
      <ul className="space-y-2.5">
        {rows.map((r) => (
          <li key={r.label} className="group" title={`${r.label}: ${format(r.value)}${r.hint ? ` (${r.hint})` : ""}`}>
            <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
              <span className="truncate text-slate-700">{r.label}</span>
              <span className="tabular shrink-0 font-semibold text-slate-900">{format(r.value)}</span>
            </div>
            <div className="h-2.5 w-full rounded-full bg-slate-100">
              <div
                className="h-2.5 rounded-full transition-[filter] group-hover:brightness-110"
                style={{ width: r.value > 0 ? `max(${(r.value / max) * 100}%, 4px)` : 0, background: SERIES_COLORS[0] }}
              />
            </div>
          </li>
        ))}
      </ul>
      <TableView categories={rows.map((r) => r.label)} series={[{ name: valueLabel, values: rows.map((r) => r.value) }]} categoryLabel={categoryLabel} format={format} />
    </figure>
  );
}
