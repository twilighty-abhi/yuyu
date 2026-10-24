import { describe, expect, it } from "vitest";
import { classifyActionError, mobileActionError, mobileError, mobileOk } from "@/lib/mobile/http";

describe("mobile envelope", () => {
  it("wraps success and failures with no-store", async () => {
    const ok = mobileOk({ a: 1 });
    expect(ok.headers.get("cache-control")).toBe("no-store");
    await expect(ok.json()).resolves.toEqual({ ok: true, data: { a: 1 } });
    const limited = mobileError("RATE_LIMITED");
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("60");
    const unauth = mobileError("UNAUTHENTICATED");
    expect(unauth.status).toBe(401);
    expect(unauth.headers.get("www-authenticate")).toContain("Bearer");
    await expect(unauth.json()).resolves.toEqual({ ok: false, error: { code: "UNAUTHENTICATED", message: expect.any(String) } });
  });

  it.each([
    [{ ok: false as const, error: "You must be signed in." }, "UNAUTHENTICATED"],
    [{ ok: false as const, error: "Too many check-in requests. Please try again shortly." }, "RATE_LIMITED"],
    [{ ok: false as const, error: "Invalid input.", fieldErrors: { rsvpId: ["Required"] } }, "INVALID_REQUEST"],
    [{ ok: false as const, error: "Event not found." }, "NOT_FOUND"],
    [{ ok: false as const, error: "RSVP not found." }, "NOT_FOUND"],
    [{ ok: false as const, error: "This ticket is not for this event." }, "NOT_FOUND"],
    [{ ok: false as const, error: "You do not have permission to operate check-in." }, "FORBIDDEN"],
    [{ ok: false as const, error: "You can only cancel your own registration." }, "FORBIDDEN"],
    [{ ok: false as const, error: "Guest is on the waitlist — use “Override” to check in at the door.", needsForce: true }, "NEEDS_FORCE"],
    [{ ok: false as const, error: "Only pending requests can be approved." }, "CONFLICT"],
    [{ ok: false as const, error: "Event is at capacity. Free a spot or promote from waitlist first." }, "CONFLICT"],
    [{ ok: false as const, error: "Could not queue the email. Please try again." }, "INTERNAL_ERROR"],
    [{ ok: false as const, error: "This event registers teams only. Create a team or join one with a team link.", code: "TEAM_REQUIRED" as const }, "TEAM_REQUIRED"],
  ])("classifies %j as %s", (result, code) => {
    expect(classifyActionError(result)).toBe(code);
  });

  it("answers TEAM_REQUIRED with 409 and the core's message", async () => {
    const response = mobileActionError({ ok: false, error: "This event registers teams only.", code: "TEAM_REQUIRED" });
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ ok: false, error: { code: "TEAM_REQUIRED", message: "This event registers teams only." } });
  });

  it("passes the UI-safe action message and field errors through", async () => {
    const response = mobileActionError({ ok: false, error: "Invalid input.", fieldErrors: { name: ["Required"] } });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ ok: false, error: { code: "INVALID_REQUEST", message: "Invalid input.", fieldErrors: { name: ["Required"] } } });
  });
});
