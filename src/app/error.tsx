"use client";

import { Button } from "@/components/ui/primitives";

/** Generic error boundary: never shows stack traces or internal messages. */
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="max-w-md text-center">
        <p className="text-sm font-semibold text-red-600">Something went wrong</p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">The page could not be loaded.</h1>
        <p className="mt-2 text-sm text-slate-600">
          A database may be temporarily unavailable. No partial changes were saved. Please try again.
        </p>
        <Button className="mt-6" onClick={() => reset()}>
          Try again
        </Button>
      </div>
    </main>
  );
}
