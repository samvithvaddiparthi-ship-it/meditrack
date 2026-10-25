"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { Logo } from "@/components/layout/logo";

export type NavItem = { href: string; label: string; badge?: number; badgeTone?: "danger" | "warning" };
export type NavGroup = { title: string; items: NavItem[] };

function isActive(pathname: string, href: string) {
  if (href === "/dashboard") return pathname === "/dashboard";
  if (href === "/purchases") return pathname === "/purchases" || /^\/purchases\/\d+/.test(pathname);
  return pathname === href || pathname.startsWith(`${href}/`);
}

function Nav({ groups, onNavigate }: { groups: NavGroup[]; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="space-y-6">
      {groups.map((group) => (
        <div key={group.title}>
          <p className="px-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{group.title}</p>
          <ul className="mt-2 space-y-0.5">
            {group.items.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex items-center justify-between rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                      active ? "bg-brand-50 text-brand-800" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
                    )}
                  >
                    {item.label}
                    {item.badge ? (
                      <span
                        className={cn(
                          "tabular ml-2 rounded-full px-1.5 py-0.5 text-[11px] font-semibold",
                          item.badgeTone === "danger" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-800",
                        )}
                        aria-label={`${item.badge} alerts`}
                      >
                        {item.badge}
                      </span>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

export function Sidebar({ groups, footer }: { groups: NavGroup[]; footer: React.ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Mobile top bar */}
      <div className="sticky top-0 z-30 flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 lg:hidden">
        <Logo />
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="mobile-nav"
          className="rounded-lg p-2 text-slate-600 hover:bg-slate-100"
        >
          <span className="sr-only">{open ? "Close menu" : "Open menu"}</span>
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
            {open ? <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" /> : <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />}
          </svg>
        </button>
      </div>
      {open ? (
        <div id="mobile-nav" className="fixed inset-0 top-[61px] z-20 overflow-y-auto bg-white px-3 py-4 lg:hidden">
          <Nav groups={groups} onNavigate={() => setOpen(false)} />
          <div className="mt-6 border-t border-slate-100 pt-4">{footer}</div>
        </div>
      ) : null}

      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-64 flex-col border-r border-slate-200 bg-white lg:flex">
        <div className="px-5 py-5">
          <Logo />
        </div>
        <div className="flex-1 overflow-y-auto px-3 pb-6">
          <Nav groups={groups} />
        </div>
        <div className="border-t border-slate-100 p-3">{footer}</div>
      </aside>
    </>
  );
}
