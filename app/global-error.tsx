"use client";

import { useEffect } from "react";
import { reportClientError } from "@/lib/reportClientError.client";
import { DotGrid } from "@/components/brand/DotGrid";
import { FACES, MARK_BRIGHT } from "@/components/brand/patterns";

// Rendered without the app stylesheet, so brand colours are explicit here.
const BRAND = { X: "#FFB547", O: "#18181B", ".": "#E7E6E2" };

export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    if (process.env.NODE_ENV === "development") console.error("[ui] global error", error);
    else console.error("[ui] global error");
    reportClientError("global", error);
  }, [error]);
  return (
    <html lang="en">
      <body>
        <main style={{ maxWidth: 640, margin: "clamp(2rem, 10vh, 6rem) auto", padding: "clamp(1.5rem, 5vw, 3rem)", border: "1px solid rgba(128,128,128,.28)", borderRadius: 18, textAlign: "center", fontFamily: "system-ui, sans-serif" }}>
          <p style={{ margin: "0 0 1.5rem", display: "flex", justifyContent: "center" }}>
            <DotGrid pattern={MARK_BRIGHT} dot={6} colors={BRAND} label="Yuyu" style={{ display: "inline-grid" }} />
          </p>
          <DotGrid pattern={FACES.sad} dot={96 / 8.5} colors={BRAND} style={{ display: "inline-grid" }} />
          <h1 style={{ marginBottom: ".75rem" }}>Something went wrong</h1>
          <p style={{ color: "inherit", opacity: 0.72, lineHeight: 1.55 }}>Please try again. If this keeps happening, contact the operator of this Yuyu instance.</p>
          <button type="button" onClick={() => retry()} style={{ border: 0, borderRadius: 999, padding: ".75rem 1.25rem", color: "white", background: "#18181b", fontWeight: 700, cursor: "pointer" }}>Try again</button>
        </main>
      </body>
    </html>
  );
}
