/**
 * Send a browser crash to the server so the operator alert webhook hears about
 * it. Errors with a digest came from the server and were already reported
 * there by `onRequestError`. Best effort: failures are ignored.
 */
export function reportClientError(boundary: "route" | "global" | "panel", error: Error & { digest?: string }) {
  if (error.digest || typeof window === "undefined") return;
  try {
    void fetch("/api/client-errors", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        boundary,
        name: String(error.name ?? "Error").slice(0, 80),
        message: String(error.message ?? "").slice(0, 500),
        path: window.location.pathname.slice(0, 500),
      }),
      keepalive: true,
      credentials: "same-origin",
    }).catch(() => undefined);
  } catch {
    // Reporting must never affect the error screen.
  }
}
