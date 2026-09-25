"use client";

import { useEffect } from "react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-start justify-center gap-4">
      <h1 className="text-[22px] font-medium tracking-tight">Something broke</h1>
      <p className="max-w-lg text-[13.5px] leading-relaxed text-muted">
        {error.message || "An unexpected error occurred while talking to YouTube."}
      </p>
      <button
        onClick={reset}
        className="rounded-md border border-line px-3.5 py-2 text-[13px] transition-colors hover:border-accent hover:text-accent"
      >
        Try again
      </button>
    </div>
  );
}
