import { RsvpStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    organisation: { findUnique: vi.fn() },
    event: { findFirst: vi.fn() },
    eventInstance: { findFirst: vi.fn() },
    rSVP: { findFirst: vi.fn() },
  },
  canManageRegistrationsFor: vi.fn(),
  isActionRateLimited: vi.fn(),
  recordAuditEvent: vi.fn(),
  confirmRsvpWithinCapacity: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/eventAccess", () => ({ canManageRegistrationsFor: mocks.canManageRegistrationsFor }));
vi.mock("@/lib/actionRateLimit", () => ({ isActionRateLimited: mocks.isActionRateLimited }));
vi.mock("@/lib/audit", () => ({ recordAuditEvent: mocks.recordAuditEvent }));
vi.mock("@/lib/rsvpCapacity", () => ({ confirmRsvpWithinCapacity: mocks.confirmRsvpWithinCapacity }));
vi.mock("@/lib/outbox", () => ({ enqueueRsvpStatusNotification: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { reacceptRsvpForUser } from "@/lib/core/rsvpLifecycle";

const input = { organisationSlug: "acme", eventId: "event_1", rsvpId: "rsvp_1" };
const rejected = { id: "rsvp_1", status: RsvpStatus.REJECTED, checkInToken: "token_1", guestEmail: "guest@example.test", guestName: "Guest", user: null };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isActionRateLimited.mockResolvedValue(false);
  mocks.prisma.organisation.findUnique.mockResolvedValue({ id: "org_1", slug: "acme" });
  mocks.canManageRegistrationsFor.mockResolvedValue(true);
  mocks.prisma.event.findFirst.mockResolvedValue({ id: "event_1", slug: "meetup", title: "Meetup" });
  mocks.prisma.rSVP.findFirst.mockResolvedValue(rejected);
});

describe("reacceptRsvpForUser", () => {
  it("requires a signed-in actor and valid input before touching data", async () => {
    await expect(reacceptRsvpForUser(null, input)).resolves.toEqual({ ok: false, error: "You must be signed in." });
    const invalid = await reacceptRsvpForUser("user_1", { organisationSlug: "acme", rsvpId: "rsvp_1" });
    expect(invalid).toMatchObject({ ok: false, error: "Invalid input." });
    const both = await reacceptRsvpForUser("user_1", { ...input, eventInstanceId: "instance_1" });
    expect(both).toMatchObject({ ok: false, error: "Invalid input." });
    expect(mocks.confirmRsvpWithinCapacity).not.toHaveBeenCalled();
  });

  it("is rate limited with the other attendee updates", async () => {
    mocks.isActionRateLimited.mockResolvedValue(true);
    await expect(reacceptRsvpForUser("user_1", input)).resolves.toEqual({ ok: false, error: "Too many attendee updates. Try again shortly." });
    expect(mocks.isActionRateLimited).toHaveBeenCalledWith("rsvp", "user_1");
  });

  it("uses the approval permission (owner/admin or the MANAGE_REGISTRATIONS grant)", async () => {
    mocks.canManageRegistrationsFor.mockResolvedValue(false);
    await expect(reacceptRsvpForUser("user_1", input)).resolves.toEqual({ ok: false, error: "You do not have permission to manage attendees." });
    expect(mocks.canManageRegistrationsFor).toHaveBeenCalledWith(expect.objectContaining({ userId: "user_1", organisationId: "org_1", eventId: "event_1" }));
    expect(mocks.confirmRsvpWithinCapacity).not.toHaveBeenCalled();
  });

  it("scopes the event lookup to the resolved organisation", async () => {
    mocks.prisma.event.findFirst.mockResolvedValue(null);
    await expect(reacceptRsvpForUser("user_1", input)).resolves.toEqual({ ok: false, error: "Event not found." });
    expect(mocks.prisma.event.findFirst).toHaveBeenCalledWith({ where: { id: "event_1", organisationId: "org_1" } });
  });

  it.each([RsvpStatus.CONFIRMED, RsvpStatus.WAITLISTED, RsvpStatus.PENDING_APPROVAL])("refuses a %s RSVP", async (status) => {
    mocks.prisma.rSVP.findFirst.mockResolvedValue({ ...rejected, status });
    await expect(reacceptRsvpForUser("user_1", input)).resolves.toEqual({ ok: false, error: "Only declined registrations can be re-accepted." });
    expect(mocks.confirmRsvpWithinCapacity).not.toHaveBeenCalled();
  });

  it.each([
    ["confirmed", RsvpStatus.CONFIRMED],
    ["waitlisted", RsvpStatus.WAITLISTED],
  ] as const)("reports %s and audits the outcome", async (outcome, status) => {
    mocks.confirmRsvpWithinCapacity.mockResolvedValue(outcome);
    await expect(reacceptRsvpForUser("user_1", input)).resolves.toEqual({ ok: true, data: { status } });
    expect(mocks.confirmRsvpWithinCapacity).toHaveBeenCalledWith({
      rsvpId: "rsvp_1",
      eventId: "event_1",
      expectedStatuses: [RsvpStatus.REJECTED],
      requireOpen: true,
      whenFull: "waitlist",
      notification: { to: "guest@example.test", eventTitle: "Meetup", checkInToken: "token_1" },
    });
    expect(mocks.recordAuditEvent).toHaveBeenCalledWith({
      action: "RSVP_REACCEPTED",
      actorUserId: "user_1",
      organisationId: "org_1",
      targetType: "RSVP",
      targetId: "rsvp_1",
      metadata: { status },
    });
  });

  it("maps a closed event and a concurrent change to UI-safe errors without an audit row", async () => {
    mocks.confirmRsvpWithinCapacity.mockResolvedValue("closed");
    await expect(reacceptRsvpForUser("user_1", input)).resolves.toEqual({ ok: false, error: "This event is no longer open for approvals." });
    mocks.confirmRsvpWithinCapacity.mockResolvedValue("changed");
    await expect(reacceptRsvpForUser("user_1", input)).resolves.toEqual({ ok: false, error: "This RSVP was changed by another organiser." });
    expect(mocks.recordAuditEvent).not.toHaveBeenCalled();
  });

  it("re-accepts a series occurrence against that occurrence's capacity", async () => {
    mocks.prisma.eventInstance.findFirst.mockResolvedValue({ id: "instance_1", series: { title: "Weekly" } });
    mocks.confirmRsvpWithinCapacity.mockResolvedValue("confirmed");
    const result = await reacceptRsvpForUser("user_1", { organisationSlug: "acme", eventInstanceId: "instance_1", rsvpId: "rsvp_1" });
    expect(result).toEqual({ ok: true, data: { status: RsvpStatus.CONFIRMED } });
    expect(mocks.prisma.eventInstance.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "instance_1", series: { organisationId: "org_1" } } }));
    expect(mocks.confirmRsvpWithinCapacity).toHaveBeenCalledWith(expect.objectContaining({ eventInstanceId: "instance_1", notification: expect.objectContaining({ eventTitle: "Weekly" }) }));
  });
});
