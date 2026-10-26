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
    for (const path of ["/acme/launch", "/acme/launch/team", "/acme/launch/schedule", "/acme/launch/results", "/acme/launch/projects", "/accounting", "/joined"]) {
      const response = await proxy(new NextRequest(`https://events.example.test${path}`));
      expect(response.headers.get("cache-control"), path).toBe("no-transform");
    }
  });

  it("marks signed-in areas, invitations, and reset/verify links no-store", async () => {
    for (const path of [
      "/dashboard/acme",
      "/dashboard",
      "/account",
      "/super-admin/users",
      "/super-admin-mfa",
      "/join/org/" + "o".repeat(43),
      "/join/event-collaborator/" + "c".repeat(43),
      "/reset-password?token=x",
      "/verify-email?token=x",
      "/login",
    ]) {
      const response = await proxy(new NextRequest(`https://events.example.test${path}`));
      expect(response.headers.get("cache-control"), path).toContain("private");
      expect(response.headers.get("cache-control"), path).toContain("no-store");
    }
  });

  it("marks any page no-store for a signed-in request", async () => {
    for (const cookie of ["yuyu.session-token.v2=abc", "__Secure-yuyu.session-token.v2.0=abc"]) {
      const response = await proxy(new NextRequest("https://events.example.test/acme/launch", { headers: { cookie } }));
      expect(response.headers.get("cache-control"), cookie).toContain("no-store");
    }
    const other = await proxy(new NextRequest("https://events.example.test/acme/launch", { headers: { cookie: "theme=dark" } }));
    expect(other.headers.get("cache-control")).toBe("no-transform");
  });
});
