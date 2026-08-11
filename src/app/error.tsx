"use client";

import { useEffect } from "react";
import { ErrorState } from "@/components/common/error-state";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface the error for observability. Never mask it with fake data.
    console.error(error);
  }, [error]);

  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 py-24">
      <ErrorState
        title="Something went wrong"
        description="An unexpected error occurred. You can try again, or head back home."
        onRetry={reset}
      />
    </main>
  );
}
