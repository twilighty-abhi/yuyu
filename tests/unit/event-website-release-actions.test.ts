import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), rateLimit: vi.fn(), orgFind: vi.fn(), eventFind: vi.fn(), canAccess: vi.fn(), pageUpsert: vi.fn(), transaction: vi.fn(), lock: vi.fn(), audit: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/actionRateLimit", () => ({ isActionRateLimited: mocks.rateLimit }));
vi.mock("@/lib/db", () => ({ prisma: {
  organisation: { findUnique: mocks.orgFind }, event: { findFirst: mocks.eventFind }, eventPage: { upsert: mocks.pageUpsert }, $transaction: mocks.transaction,
} }));
vi.mock("@/lib/eventAccess", () => ({ canAccessEvent: mocks.canAccess }));
vi.mock("@/lib/audit", () => ({ recordAuditEvent: mocks.audit }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { EventPageSectionType, EventPermission } from "@prisma/client";
import { saveEventPage, setEventPagePublished } from "@/app/actions/event-website";

beforeEach(() => {
  vi.clearAllMocks(); mocks.auth.mockResolvedValue({ user: { id: "user_1" } }); mocks.rateLimit.mockResolvedValue(false); mocks.orgFind.mockResolvedValue({ id: "org_1", slug: "org" }); mocks.eventFind.mockResolvedValue({ id: "event_1", slug: "event" }); mocks.canAccess.mockResolvedValue(true); mocks.transaction.mockImplementation(async (callback: (tx: { $queryRaw: typeof mocks.lock; eventPage: { upsert: typeof mocks.pageUpsert } }) => Promise<unknown>) => callback({ $queryRaw: mocks.lock, eventPage: { upsert: mocks.pageUpsert } }));
});

describe("event website release boundary", () => {
  it("requires publish-and-schedule permission for the explicit release action", async () => {
    await expect(setEventPagePublished({ organisationSlug: "org", eventId: "event_1", isPublished: true })).resolves.toEqual({ ok: true });
    expect(mocks.canAccess).toHaveBeenCalledWith(expect.objectContaining({ permission: EventPermission.PUBLISH_AND_SCHEDULE }));
    expect(mocks.pageUpsert).toHaveBeenCalledWith(expect.objectContaining({ update: { isPublished: true } }));
  });

  it("rejects attempts to smuggle release state through the content-save action", async () => {
    const sections = Object.values(EventPageSectionType).map((type, sortOrder) => ({ type, isVisible: true, sortOrder }));
    await expect(saveEventPage({ organisationSlug: "org", eventId: "event_1", isPublished: true, tagline: "Launch", aboutHtml: "", sections }))
      .resolves.toEqual({ ok: false, error: "Invalid event page settings." });
    expect(mocks.canAccess).not.toHaveBeenCalled();
    expect(mocks.pageUpsert).not.toHaveBeenCalled();
  });
});
