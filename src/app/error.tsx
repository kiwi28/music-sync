"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

interface ErrorBoundaryProps {
  error: Error & { digest?: string };
  reset: () => void;
}

/**
 * Next.js App Router error boundary.
 * Rendered when a page or layout throws during render.
 * Catches both server-component and client-component render errors.
 */
export default function ErrorPage({ error, reset }: ErrorBoundaryProps) {
  useEffect(() => {
    console.error("[error-boundary] Unhandled render error:", error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-red-500/10">
        <svg
          className="h-7 w-7 text-red-400"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <circle cx="8" cy="8" r="6" />
          <path d="M8 5v3M8 11h.01" strokeLinecap="round" />
        </svg>
      </div>
      <h1 className="mt-5 text-lg font-semibold tracking-tight">
        Something went wrong
      </h1>
      <p className="mt-2 max-w-md text-sm text-white/40">
        {error.message || "An unexpected error occurred. Please try again."}
      </p>
      <div className="mt-6 flex gap-3">
        <Button onClick={reset} variant="secondary" size="sm">
          Try again
        </Button>
        <Button
          onClick={() => (window.location.href = "/")}
          variant="secondary"
          size="sm"
        >
          Go home
        </Button>
      </div>
    </div>
  );
}
