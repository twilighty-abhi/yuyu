import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventPermission } from "@prisma/client";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  orgFind: vi.fn(),
  membership: vi.fn(),
  deleteMany: vi.fn(),
  updateMany: vi.fn(),
  inviteDeleteMany: vi.fn(),
  rateLimited: vi.fn(),
  audit: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/permissions", () => ({ getMembership: mocks.membership, isOrgAdmin: (role: string) => role === "OWNER" || role === "ADMIN" }));
vi.mock("@/lib/audit", () => ({ recordAuditEvent: mocks.audit }));
vi.mock("@/lib/actionRateLimit", () => ({ isActionRateLimited: mocks.rateLimited }));
vi.mock("@/lib/db", () => ({ prisma: {
  organisation: { findUnique: mocks.orgFind },
  eventCollaborator: { deleteMany: mocks.deleteMany, updateMany: mocks.updateMany },
  eventCollaboratorInvite: { deleteMany: mocks.inviteDeleteMany },
} }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { cancelEventCollaboratorInvite, revokeEventCollaborator, updateEventCollaboratorPermissions } from "@/app/actions/event-collaborators";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ user: { id: "admin_1" } });
  mocks.orgFind.mockResolvedValue({ id: "org_a", slug: "org-a" });
  mocks.membership.mockResolvedValue({ role: "ADMIN" });
  mocks.deleteMany.mockResolvedValue({ count: 1 });
  mocks.updateMany.mockResolvedValue({ count: 1 });
  mocks.inviteDeleteMany.mockResolvedValue({ count: 1 });
  mocks.rateLimited.mockResolvedValue(false);
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

  it("grants JUDGE on a one-off event but never on a series, and refuses duplicates", async () => {
    await expect(updateEventCollaboratorPermissions({
      organisationSlug: "org-a",
      eventId: "event_a",
      collaboratorId: "grant_a",
      permissions: [EventPermission.JUDGE],
    })).resolves.toEqual({ ok: true });
    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { permissions: [EventPermission.JUDGE] } }));

    mocks.updateMany.mockClear();
    await expect(updateEventCollaboratorPermissions({
      organisationSlug: "org-a",
      eventSeriesId: "series_a",
      collaboratorId: "grant_a",
      permissions: [EventPermission.JUDGE],
    })).resolves.toEqual({ ok: false, error: "Invalid collaborator permissions." });
    await expect(updateEventCollaboratorPermissions({
      organisationSlug: "org-a",
      eventId: "event_a",
      collaboratorId: "grant_a",
      permissions: [EventPermission.CHECK_IN, EventPermission.CHECK_IN],
    })).resolves.toEqual({ ok: false, error: "Invalid collaborator permissions." });
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("cancels only unused invites of an event in the authorised organisation", async () => {
    await expect(cancelEventCollaboratorInvite({ organisationSlug: "org-a", eventId: "event_b", inviteId: "invite_b" }))
      .resolves.toEqual({ ok: true });
    expect(mocks.inviteDeleteMany).toHaveBeenCalledWith({ where: {
      id: "invite_b",
      usedAt: null,
      eventId: "event_b",
      event: { organisationId: "org_a" },
    } });
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "EVENT_COLLABORATOR_INVITE_CANCELLED", targetId: "invite_b" }));
  });

  it("refuses to cancel invites for non-admins and reports invites that are gone", async () => {
    mocks.membership.mockResolvedValueOnce({ role: "MEMBER" });
    await expect(cancelEventCollaboratorInvite({ organisationSlug: "org-a", eventId: "event_b", inviteId: "invite_b" }))
      .resolves.toEqual({ ok: false, error: "You do not have permission." });
    expect(mocks.inviteDeleteMany).not.toHaveBeenCalled();

    mocks.inviteDeleteMany.mockResolvedValueOnce({ count: 0 });
    await expect(cancelEventCollaboratorInvite({ organisationSlug: "org-a", eventSeriesId: "series_b", inviteId: "used_invite" }))
      .resolves.toEqual({ ok: false, error: "Invite not found or already accepted." });
  });
});
