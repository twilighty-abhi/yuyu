import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ checkRateLimit: vi.fn() }));

vi.mock("@/lib/rateLimit", () => ({ checkRateLimit: mocks.checkRateLimit }));

import { proxy } from "@/proxy";

beforeEach(() => {
  mocks.checkRateLimit.mockResolvedValue(true);
  process.env.ALLOWED_EMBED_ORIGINS = "https://host.example.test";
});

describe("embedding response headers", () => {
  it("permits framing only on the dedicated embed route", async () => {
    const embedded = await proxy(new NextRequest("https://events.example.test/embed/acme/launch"));
    expect(embedded.headers.get("content-security-policy")).toContain("frame-ancestors https://host.example.test");
    expect(embedded.headers.get("x-frame-options")).toBeNull();

    const eventPage = await proxy(new NextRequest("https://events.example.test/acme/launch"));
    expect(eventPage.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(eventPage.headers.get("x-frame-options")).toBe("DENY");
    expect(eventPage.headers.get("cache-control")).toContain("no-transform");
  });
});

describe("capability page caching", () => {
  it("marks ticket, team, and submission pages no-store and leaves other pages alone", async () => {
    for (const path of ["/ticket/abc123", "/team/" + "t".repeat(43), "/acme/launch/team/" + "j".repeat(43), "/submit/" + "s".repeat(43), "/account/submissions/evt_123"]) {
      const response = await proxy(new NextRequest(`https://events.example.test${path}`));
      expect(response.headers.get("cache-control"), path).toContain("no-store");
      expect(response.headers.get("cache-control"), path).toContain("private");
      expect(response.headers.get("cache-control"), path).toContain("no-transform");
    }
    for (const path of ["/acme/launch", "/acme/launch/team", "/acme/launch/schedule", "/acme/launch/results", "/acme/launch/projects", "/account"]) {
      const response = await proxy(new NextRequest(`https://events.example.test${path}`));
      expect(response.headers.get("cache-control"), path).toBe("no-transform");
    }
  });
});
