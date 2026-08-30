import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), rateLimit: vi.fn(), organisationFindUnique: vi.fn(), eventFindFirst: vi.fn(), sessionUpdateMany: vi.fn(), sessionFindFirst: vi.fn(), canAccessEvent: vi.fn(), audit: vi.fn(), revalidatePath: vi.fn() }));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/actionRateLimit", () => ({ isActionRateLimited: mocks.rateLimit }));
vi.mock("@/lib/db", () => ({ prisma: { organisation: { findUnique: mocks.organisationFindUnique }, event: { findFirst: mocks.eventFindFirst }, eventSession: { updateMany: mocks.sessionUpdateMany, findFirst: mocks.sessionFindFirst } } }));
vi.mock("@/lib/eventAccess", () => ({ canAccessEvent: mocks.canAccessEvent }));
vi.mock("@/lib/audit", () => ({ recordAuditEvent: mocks.audit }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import { setEventSessionDelay } from "@/app/actions/event-website";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ user: { id: "user_1" } });
  mocks.rateLimit.mockResolvedValue(false);
  mocks.organisationFindUnique.mockResolvedValue({ id: "org_1", slug: "org" });
  mocks.canAccessEvent.mockResolvedValue(true);
  mocks.eventFindFirst.mockResolvedValue({ id: "event_1", slug: "event" });
  mocks.sessionUpdateMany.mockResolvedValue({ count: 1 });
  mocks.sessionFindFirst.mockResolvedValue({ slug: "opening" });
});

describe("event session delay action", () => {
  it("updates an authorised event session, audits it, and revalidates public programme pages", async () => {
    await expect(setEventSessionDelay({ organisationSlug: "org", eventId: "event_1", sessionId: "session_1", delayMinutes: 15 })).resolves.toEqual({ ok: true });
    expect(mocks.sessionUpdateMany).toHaveBeenCalledWith({ where: { id: "session_1", eventId: "event_1" }, data: { delayMinutes: 15 } });
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "EVENT_SESSION_DELAY_SET", targetId: "session_1", metadata: { delayMinutes: 15 } }));
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/org/event/sessions/opening");
  });

  it("rejects invalid delays and denied permissions without changing the schedule", async () => {
    await expect(setEventSessionDelay({ organisationSlug: "org", eventId: "event_1", sessionId: "session_1", delayMinutes: -1 })).resolves.toEqual({ ok: false, error: "Invalid programme delay." });
    mocks.canAccessEvent.mockResolvedValue(false);
    await expect(setEventSessionDelay({ organisationSlug: "org", eventId: "event_1", sessionId: "session_1", delayMinutes: 10 })).resolves.toEqual({ ok: false, error: "You do not have permission to manage the programme." });
    expect(mocks.sessionUpdateMany).not.toHaveBeenCalled();
  });
});
