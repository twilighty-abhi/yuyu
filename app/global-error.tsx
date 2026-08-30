"use client";

import { useEffect } from "react";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    if (process.env.NODE_ENV === "development") console.error("[ui] global error", error);
    else console.error("[ui] global error");
  }, [error]);
  return (
    <html lang="en">
      <body>
        <main style={{ maxWidth: 640, margin: "clamp(2rem, 10vh, 6rem) auto", padding: "clamp(1.5rem, 5vw, 3rem)", border: "1px solid rgba(128,128,128,.28)", borderRadius: 18, textAlign: "center", fontFamily: "system-ui, sans-serif" }}>
          <p style={{ margin: 0, color: "#0a84ff", fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase" }}>Yuyu</p>
          <h1 style={{ marginBottom: ".75rem" }}>Something went wrong</h1>
          <p style={{ color: "inherit", opacity: 0.72, lineHeight: 1.55 }}>Please try again. If this keeps happening, contact the operator of this Yuyu instance.</p>
          <button type="button" onClick={reset} style={{ border: 0, borderRadius: 9, padding: ".7rem 1rem", color: "white", background: "#0a84ff", fontWeight: 700, cursor: "pointer" }}>Try again</button>
        </main>
      </body>
    </html>
  );
}
