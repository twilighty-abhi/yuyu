import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventPermission } from "@prisma/client";

const mocks = vi.hoisted(() => ({
  eventFind: vi.fn(),
  seriesFind: vi.fn(),
  grantFind: vi.fn(),
  membership: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: {
  event: { findFirst: mocks.eventFind },
  eventSeries: { findFirst: mocks.seriesFind },
  eventCollaborator: { findFirst: mocks.grantFind },
} }));
vi.mock("@/lib/permissions", () => ({
  getMembership: mocks.membership,
  isOrgAdmin: (role: string) => role === "OWNER" || role === "ADMIN",
}));

import { canAccessEvent, canViewEventDashboard } from "@/lib/eventAccess";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.eventFind.mockResolvedValue({ id: "event_a" });
  mocks.seriesFind.mockResolvedValue({ id: "series_a" });
  mocks.grantFind.mockResolvedValue(null);
  mocks.membership.mockResolvedValue({ role: "ADMIN" });
});

describe("event access tenant binding", () => {
  it("rejects an organisation admin when the event is outside that organisation", async () => {
    mocks.eventFind.mockResolvedValue(null);
    await expect(canAccessEvent({
      userId: "admin_a",
      organisationId: "org_a",
      eventId: "event_b",
      permission: EventPermission.EDIT_DETAILS,
    })).resolves.toBe(false);
    expect(mocks.membership).not.toHaveBeenCalled();
    expect(mocks.grantFind).not.toHaveBeenCalled();
  });

  it("rejects dashboard access before considering membership for a foreign series", async () => {
    mocks.seriesFind.mockResolvedValue(null);
    await expect(canViewEventDashboard({ userId: "member_a", organisationId: "org_a", eventSeriesId: "series_b" }))
      .resolves.toBe(false);
    expect(mocks.membership).not.toHaveBeenCalled();
  });

  it("allows an admin only after the target ownership check succeeds", async () => {
    await expect(canAccessEvent({
      userId: "admin_a",
      organisationId: "org_a",
      eventId: "event_a",
      permission: EventPermission.EDIT_DETAILS,
    })).resolves.toBe(true);
    expect(mocks.eventFind).toHaveBeenCalledWith({ where: { id: "event_a", organisationId: "org_a" }, select: { id: true } });
  });
});
