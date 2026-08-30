import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), canAccess: vi.fn(), userFind: vi.fn(), eventInviteFind: vi.fn(), seriesInviteFind: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/eventAccess", () => ({ canAccessEvent: mocks.canAccess }));
vi.mock("@/lib/db", () => ({ prisma: {
  user: { findUnique: mocks.userFind }, eventInvite: { findUnique: mocks.eventInviteFind }, seriesInvite: { findUnique: mocks.seriesInviteFind },
} }));

import { EventPrivacyType, EventStatus } from "@prisma/client";
import { resolvePublicEventAccess } from "@/lib/publicEventAccess";

beforeEach(() => {
  vi.clearAllMocks(); mocks.auth.mockResolvedValue(null); mocks.canAccess.mockResolvedValue(false);
});

describe("public event access", () => {
  it("denies anonymous access to draft, hidden, and unreleased websites", async () => {
    const base = { organisationId: "org_1", eventId: "event_1", privacyType: EventPrivacyType.PUBLIC };
    await expect(resolvePublicEventAccess({ ...base, status: EventStatus.DRAFT, websiteReleased: true })).resolves.toEqual({ allowed: false, preview: false });
    await expect(resolvePublicEventAccess({ ...base, status: EventStatus.HIDDEN, websiteReleased: true })).resolves.toEqual({ allowed: false, preview: false });
    await expect(resolvePublicEventAccess({ ...base, status: EventStatus.PUBLISHED, websiteReleased: false })).resolves.toEqual({ allowed: false, preview: false });
  });

  it("allows an authorized organizer to preview an unreleased event", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "organizer_1" } }); mocks.canAccess.mockResolvedValue(true);
    await expect(resolvePublicEventAccess({ organisationId: "org_1", eventId: "event_1", status: EventStatus.DRAFT, privacyType: EventPrivacyType.INVITE_ONLY, websiteReleased: false })).resolves.toEqual({ allowed: true, preview: true });
  });

  it("matches invite-only access against the verified current database email", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "attendee_1", email: "stale@example.test" } });
    mocks.userFind.mockResolvedValue({ email: "invited@example.test", emailVerified: new Date() }); mocks.eventInviteFind.mockResolvedValue({ id: "invite_1" });
    await expect(resolvePublicEventAccess({ organisationId: "org_1", eventId: "event_1", status: EventStatus.PUBLISHED, privacyType: EventPrivacyType.INVITE_ONLY, websiteReleased: true })).resolves.toEqual({ allowed: true, preview: false });
    expect(mocks.eventInviteFind).toHaveBeenCalledWith({ where: { eventId_email: { eventId: "event_1", email: "invited@example.test" } }, select: { id: true } });
  });
});
