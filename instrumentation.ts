import type { Instrumentation } from "next";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { validateRuntimeEnvironment } = await import("@/lib/env");
    validateRuntimeEnvironment();
    const { installOpsAlertForwarding, reportOpsAlert } = await import("@/lib/opsAlerts");
    installOpsAlertForwarding();
    reportOpsAlert({ level: "info", source: "lifecycle", title: "Instance started", context: { pid: process.pid, node: process.version } });
    const { startOutboxWorker } = await import("@/lib/outboxWorker");
    startOutboxWorker();
  }
}

const ROUTE_TYPE_LABEL: Record<string, string> = {
  render: "Page render failed",
  route: "API route failed",
  action: "Server action failed",
  proxy: "Proxy failed",
};

export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { deliverOpsAlert, isClientDisconnectNoise, sanitizeAlertPath } = await import("@/lib/opsAlerts");
  // A browser that navigates away or closes mid-stream makes React abort the
  // render with "The destination stream closed early." Next.js 16 logs it with
  // a digest and reports it here, but nothing failed on the server, so it is
  // not an ops alert (the console forwarding already drops the same line).
  if (isClientDisconnectNoise([error])) return;
  // The route pattern (e.g. /ticket/[token]) is used rather than the request
  // path, which can carry bearer capabilities.
  await deliverOpsAlert({
    level: "error",
    source: "request",
    title: ROUTE_TYPE_LABEL[context.routeType] ?? "Request failed",
    error,
    context: { route: sanitizeAlertPath(context.routePath), method: request.method },
  });
};
