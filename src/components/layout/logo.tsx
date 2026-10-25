import { cn } from "@/lib/cn";

export function Logo({ inverted = false, compact = false }: { inverted?: boolean; compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className={cn("flex h-9 w-9 items-center justify-center rounded-lg", inverted ? "bg-white/10" : "bg-brand-600")} aria-hidden>
        <svg viewBox="0 0 24 24" className="h-5 w-5 text-white" fill="none" stroke="currentColor" strokeWidth={2}>
          <rect x="3" y="8" width="18" height="8" rx="4" />
          <path d="M12 8v8" />
        </svg>
      </span>
      {compact ? null : (
        <span className={cn("text-lg font-semibold tracking-tight", inverted ? "text-white" : "text-slate-900")}>
          Medi<span className={inverted ? "text-brand-200" : "text-brand-600"}>Track</span>
        </span>
      )}
    </div>
  );
}
