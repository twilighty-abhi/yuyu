import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ limit: vi.fn(), submit: vi.fn() }));
vi.mock("@/lib/rateLimit", () => ({ getClientIpFromHeaders: () => "203.0.113.4", checkRateLimitById: mocks.limit }));
vi.mock("@/lib/feedback", () => ({ submitFeedback: mocks.submit }));
vi.mock("@/lib/apiMonitor", () => ({ withApiMonitoring: (_label: string, handler: unknown) => handler }));

import { POST } from "@/app/api/feedback/route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.limit.mockResolvedValue(true);
  mocks.submit.mockResolvedValue({ ok: true, data: { certificateToken: "secret-capability" } });
});

describe("feedback HTTP boundary", () => {
  it("marks certificate-bearing responses no-store and rate limits a hashed email subject", async () => {
    const response = await POST(new Request("https://events.example.test/api/feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orgSlug: "org", eventSlug: "event", email: " Person@Example.Test ", answers: {} }),
    }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(mocks.limit).toHaveBeenCalledWith("feedback", expect.stringMatching(/^email:[a-f0-9]{32}$/));
  });

  it("rejects oversized bodies before parsing or submission", async () => {
    const response = await POST(new Request("https://events.example.test/api/feedback", {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": String(129 * 1024) },
      body: "{}",
    }));
    expect(response.status).toBe(413);
    expect(mocks.submit).not.toHaveBeenCalled();
  });
});
