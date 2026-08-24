"use client";

import { useEffect } from "react";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[ui] global error", error);
  }, [error]);
  return (
    <html lang="en">
      <body>
        <main style={{ maxWidth: 640, margin: "5rem auto", padding: "1rem", fontFamily: "system-ui, sans-serif" }}>
          <h1>Something went wrong</h1>
          <p>Please try again. If this keeps happening, contact support.</p>
          <button type="button" onClick={reset}>Try again</button>
        </main>
      </body>
    </html>
  );
}
