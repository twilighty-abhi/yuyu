"use client";

import { useEffect } from "react";
import { reportClientError } from "@/lib/reportClientError.client";
import { Button } from "@/components/ui/button";
import { DotFace } from "@/components/brand/DotFace";

// `retry` re-fetches the segment; `reset` would re-render the same failed
// payload (e.g. a stream cut mid-way) and fail again.
export default function ErrorBoundary({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    if (process.env.NODE_ENV === "development") console.error("[ui] route error", error);
    else console.error("[ui] route error");
    reportClientError("route", error);
  }, [error]);
  return (
    <div className="mx-auto flex max-w-[520px] flex-col items-center gap-4 px-4 py-16 text-center">
      <DotFace mood="sad" size={96} />
      <h1 className="text-h1 text-ink">Something went wrong</h1>
      <p className="text-body-ui text-ink-secondary">Please try again. If this keeps happening, contact the operator of this Yuyu instance.</p>
      <Button variant="primary" onClick={() => retry()}>Try again</Button>
    </div>
  );
}
