import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), submit: vi.fn(), limit: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/rsvpCore", () => ({ submitRsvpCore: mocks.submit }));
vi.mock("@/lib/rateLimit", () => ({
  getClientIpFromHeaders: () => "203.0.113.7",
  checkRateLimitById: mocks.limit,
}));

import { POST } from "@/app/api/rsvp/route";

beforeEach(() => {
  vi.clearAllMocks(); mocks.limit.mockResolvedValue(true); mocks.auth.mockResolvedValue(null); mocks.submit.mockResolvedValue({ ok: true, data: { count: 1 } });
});

describe("public RSVP route", () => {
  it("applies IP and privacy-safe guest-subject limits before RSVP work", async () => {
    mocks.limit.mockResolvedValue(false);
    const response = await POST(new Request("https://events.example.test/api/rsvp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orgSlug: "org", eventSlug: "event", guestEmail: " Guest@Example.Test ", name: "Guest" }),
    }));
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(mocks.limit).toHaveBeenCalledWith("rsvp", "ip:203.0.113.7");
    expect(mocks.limit).toHaveBeenCalledWith("rsvp", expect.stringMatching(/^subject:[a-f0-9]{32}$/));
    expect(mocks.submit).not.toHaveBeenCalled();
  });
});
