import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth/session";
import { first, type SearchParams } from "@/components/ui/list";
import { LoginForm } from "./login-form";
import { Logo } from "@/components/layout/logo";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  if (await getCurrentUser()) redirect("/dashboard");
  const params = await searchParams;
  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      <div className="hidden flex-col justify-between bg-brand-900 p-10 text-brand-50 lg:flex">
        <Logo inverted />
        <div className="max-w-md space-y-4">
          <h2 className="text-3xl font-semibold leading-tight text-white">Every batch accounted for, before it expires.</h2>
          <p className="text-brand-100">
            MediTrack tracks medicine batches from receipt to issue with First-Expiry-First-Out allocation, expiry and low-stock alerts, and a tamper-proof stock ledger.
          </p>
        </div>
        <p className="text-xs text-brand-200">DBMS Level 3 Project · PES University</p>
      </div>
      <div className="flex items-center justify-center px-4 py-12 sm:px-6">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <Logo />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Sign in</h1>
          <p className="mb-6 mt-1 text-sm text-slate-600">Use the account created by your administrator.</p>
          <LoginForm next={first(params.next)} />
        </div>
      </div>
    </main>
  );
}
