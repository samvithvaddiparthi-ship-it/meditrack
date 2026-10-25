import type { Metadata } from "next";
import { ButtonLink } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "Access denied" };

export default function ForbiddenPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="max-w-md text-center">
        <p className="text-sm font-semibold text-red-600">403 · Access denied</p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">You don&apos;t have permission to view this page.</h1>
        <p className="mt-2 text-sm text-slate-600">This area is limited to administrators. If you need access, ask an administrator to update your role.</p>
        <ButtonLink href="/dashboard" className="mt-6">
          Back to dashboard
        </ButtonLink>
      </div>
    </main>
  );
}
