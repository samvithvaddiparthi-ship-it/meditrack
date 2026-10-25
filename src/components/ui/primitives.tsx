import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";

// ------------------------------------------------------------------ buttons

type Variant = "primary" | "secondary" | "danger" | "ghost" | "warning";
type Size = "sm" | "md";

const variants: Record<Variant, string> = {
  primary: "bg-brand-600 text-white hover:bg-brand-700 shadow-sm disabled:bg-brand-300",
  secondary: "bg-white text-slate-700 ring-1 ring-inset ring-slate-300 hover:bg-slate-50 shadow-sm disabled:text-slate-400",
  danger: "bg-red-600 text-white hover:bg-red-700 shadow-sm disabled:bg-red-300",
  warning: "bg-amber-500 text-white hover:bg-amber-600 shadow-sm disabled:bg-amber-300",
  ghost: "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
};
const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-xs gap-1.5",
  md: "h-10 px-4 text-sm gap-2",
};

export function buttonClass(variant: Variant = "primary", size: Size = "md", className?: string) {
  return cn(
    "inline-flex items-center justify-center rounded-lg font-medium transition-colors disabled:cursor-not-allowed whitespace-nowrap",
    variants[variant],
    sizes[size],
    className,
  );
}

export function Button({ variant = "primary", size = "md", className, type = "button", ...props }: ComponentProps<"button"> & { variant?: Variant; size?: Size }) {
  return <button type={type} className={buttonClass(variant, size, className)} {...props} />;
}

export function ButtonLink({ variant = "primary", size = "md", className, ...props }: ComponentProps<typeof Link> & { variant?: Variant; size?: Size }) {
  return <Link className={buttonClass(variant, size, className)} {...props} />;
}

// ------------------------------------------------------------------ layout

export function PageHeader({ title, description, actions, children }: { title: string; description?: ReactNode; actions?: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-6 space-y-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
          {description ? <p className="mt-1 max-w-3xl text-sm text-slate-600">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      </div>
      {children}
    </div>
  );
}

export function Card({ className, children, ...props }: ComponentProps<"section">) {
  return (
    <section className={cn("rounded-xl border border-slate-200 bg-white shadow-sm", className)} {...props}>
      {children}
    </section>
  );
}

export function CardHeader({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 border-b border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h2 className="text-base font-semibold text-slate-900">{title}</h2>
        {description ? <p className="mt-0.5 text-sm text-slate-500">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function CardBody({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("px-5 py-4", className)}>{children}</div>;
}

export function DescriptionList({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((item) => (
        <div key={item.label}>
          <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{item.label}</dt>
          <dd className="mt-1 text-sm text-slate-900">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

// ------------------------------------------------------------------ feedback

type Tone = "neutral" | "success" | "warning" | "danger" | "info" | "brand";

const badgeTones: Record<Tone, string> = {
  neutral: "bg-slate-100 text-slate-700 ring-slate-200",
  success: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  warning: "bg-amber-50 text-amber-800 ring-amber-200",
  danger: "bg-red-50 text-red-700 ring-red-200",
  info: "bg-sky-50 text-sky-700 ring-sky-200",
  brand: "bg-brand-50 text-brand-700 ring-brand-200",
};

export function Badge({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", badgeTones[tone], className)}>
      {children}
    </span>
  );
}

const alertTones: Record<Exclude<Tone, "neutral" | "brand">, string> = {
  success: "border-emerald-200 bg-emerald-50 text-emerald-800",
  warning: "border-amber-200 bg-amber-50 text-amber-900",
  danger: "border-red-200 bg-red-50 text-red-800",
  info: "border-sky-200 bg-sky-50 text-sky-800",
};

export function Alert({ tone = "info", title, children, className }: { tone?: keyof typeof alertTones; title?: string; children?: ReactNode; className?: string }) {
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cn("rounded-lg border px-4 py-3 text-sm", alertTones[tone], className)}>
      {title ? <p className="font-semibold">{title}</p> : null}
      {children ? <div className={title ? "mt-1" : undefined}>{children}</div> : null}
    </div>
  );
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-400" aria-hidden>
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8}>
          <path d="M4 7h16M4 12h16M4 17h10" strokeLinecap="round" />
        </svg>
      </div>
      <p className="text-sm font-medium text-slate-900">{title}</p>
      {description ? <p className="mt-1 max-w-sm text-sm text-slate-500">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function StatCard({ label, value, hint, tone = "neutral", href }: { label: string; value: ReactNode; hint?: ReactNode; tone?: Tone; href?: string }) {
  const accent: Record<Tone, string> = {
    neutral: "before:bg-slate-300",
    brand: "before:bg-brand-500",
    success: "before:bg-emerald-500",
    warning: "before:bg-amber-500",
    danger: "before:bg-red-500",
    info: "before:bg-sky-500",
  };
  const body = (
    <div
      className={cn(
        "relative h-full overflow-hidden rounded-xl border border-slate-200 bg-white p-4 shadow-sm before:absolute before:inset-y-0 before:left-0 before:w-1",
        accent[tone],
        href && "transition-colors hover:border-brand-300",
      )}
    >
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="tabular mt-2 text-2xl font-semibold text-slate-900">{value}</p>
      {hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
  return href ? (
    <Link href={href} className="block h-full rounded-xl">
      {body}
    </Link>
  ) : (
    body
  );
}

// ------------------------------------------------------------------ tables

export function Table({ children, caption }: { children: ReactNode; caption?: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        {children}
      </table>
    </div>
  );
}

export function Th({ children, className, align = "left" }: { children?: ReactNode; className?: string; align?: "left" | "right" | "center" }) {
  return (
    <th
      scope="col"
      className={cn(
        "bg-slate-50 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500",
        align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left",
        className,
      )}
    >
      {children}
    </th>
  );
}

export function Td({ children, className, align = "left" }: { children?: ReactNode; className?: string; align?: "left" | "right" | "center" }) {
  return (
    <td className={cn("px-4 py-3 align-top text-slate-700", align === "right" ? "tabular text-right" : align === "center" ? "text-center" : "", className)}>
      {children}
    </td>
  );
}

export function TBody({ children }: { children: ReactNode }) {
  return <tbody className="divide-y divide-slate-100 bg-white">{children}</tbody>;
}

export function TextLink({ className, ...props }: ComponentProps<typeof Link>) {
  return <Link className={cn("font-medium text-brand-700 hover:text-brand-900 hover:underline", className)} {...props} />;
}
