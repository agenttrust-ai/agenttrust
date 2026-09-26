"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function ErrorPage({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto flex max-w-md flex-1 flex-col items-center justify-center gap-4 px-6 py-24 text-center">
      <h1 className="text-heading">Something went wrong</h1>
      <p className="text-sm text-muted">
        An unexpected error occurred. You can try again, or come back later.
      </p>
      <Button onClick={() => retry()}>Try again</Button>
    </div>
  );
}
