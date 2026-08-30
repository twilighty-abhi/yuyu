import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventPermission } from "@prisma/client";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  orgFind: vi.fn(),
  membership: vi.fn(),
  deleteMany: vi.fn(),
  updateMany: vi.fn(),
  audit: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/permissions", () => ({ getMembership: mocks.membership, isOrgAdmin: (role: string) => role === "OWNER" || role === "ADMIN" }));
vi.mock("@/lib/audit", () => ({ recordAuditEvent: mocks.audit }));
vi.mock("@/lib/db", () => ({ prisma: {
  organisation: { findUnique: mocks.orgFind },
  eventCollaborator: { deleteMany: mocks.deleteMany, updateMany: mocks.updateMany },
} }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { revokeEventCollaborator, updateEventCollaboratorPermissions } from "@/app/actions/event-collaborators";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ user: { id: "admin_1" } });
  mocks.orgFind.mockResolvedValue({ id: "org_a", slug: "org-a" });
  mocks.membership.mockResolvedValue({ role: "ADMIN" });
  mocks.deleteMany.mockResolvedValue({ count: 1 });
  mocks.updateMany.mockResolvedValue({ count: 1 });
});

describe("event collaborator tenant binding", () => {
  it("binds event collaborator revocation to the authorised organisation", async () => {
    await expect(revokeEventCollaborator({ organisationSlug: "org-a", eventId: "event_b", collaboratorId: "grant_b" }))
      .resolves.toEqual({ ok: true });
    expect(mocks.deleteMany).toHaveBeenCalledWith({ where: {
      id: "grant_b",
      eventId: "event_b",
      event: { organisationId: "org_a" },
    } });
  });

  it("binds series collaborator permission changes to the authorised organisation", async () => {
    await expect(updateEventCollaboratorPermissions({
      organisationSlug: "org-a",
      eventSeriesId: "series_b",
      collaboratorId: "grant_b",
      permissions: [EventPermission.EDIT_DETAILS],
    })).resolves.toEqual({ ok: true });
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { id: "grant_b", eventSeriesId: "series_b", series: { organisationId: "org_a" } },
      data: { permissions: [EventPermission.EDIT_DETAILS] },
    });
  });
});
