import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const deliverOpsAlert = vi.fn(async () => undefined);
vi.mock("@/lib/opsAlerts", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/opsAlerts")>();
  return { ...actual, deliverOpsAlert };
});

import { onRequestError } from "@/instrumentation";

const request = { path: "/org/event", method: "GET", headers: {} };
const context = { routerKind: "App Router", routePath: "/[orgSlug]/[eventSlug]", routeType: "render", renderSource: "react-server-components", revalidateReason: undefined } as const;

describe("onRequestError", () => {
  const runtime = process.env.NEXT_RUNTIME;
  beforeEach(() => {
    process.env.NEXT_RUNTIME = "nodejs";
    deliverOpsAlert.mockClear();
  });
  afterEach(() => {
    process.env.NEXT_RUNTIME = runtime;
  });

  it("does not raise an ops alert when the browser closed the stream early", async () => {
    await onRequestError(Object.assign(new Error("The destination stream closed early."), { digest: "653508159" }), request, context);
    expect(deliverOpsAlert).not.toHaveBeenCalled();
  });

  it("still reports real render failures", async () => {
    await onRequestError(new Error("Database unavailable"), request, context);
    expect(deliverOpsAlert).toHaveBeenCalledTimes(1);
    expect(deliverOpsAlert).toHaveBeenCalledWith(expect.objectContaining({ title: "Page render failed", context: expect.objectContaining({ method: "GET" }) }));
  });
});
