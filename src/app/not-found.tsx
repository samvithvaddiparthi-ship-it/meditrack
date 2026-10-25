import { ButtonLink } from "@/components/ui/primitives";

export default function NotFound() {
  return (
    <main className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="max-w-md text-center">
        <p className="text-sm font-semibold text-brand-600">404</p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">Page or record not found</h1>
        <p className="mt-2 text-sm text-slate-600">It may have been removed, or the link is incorrect.</p>
        <ButtonLink href="/dashboard" className="mt-6">
          Go to dashboard
        </ButtonLink>
      </div>
    </main>
  );
}
