import { EventPrivacyType, RsvpStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  enqueueStatus: vi.fn(),
  enqueueTeamCreated: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: { $transaction: mocks.transaction } }));
vi.mock("@/lib/outbox", () => ({
  enqueueRsvpStatusNotification: mocks.enqueueStatus,
  enqueueTeamCreated: mocks.enqueueTeamCreated,
}));

import { countConfirmedForCapacity, countConfirmedUnits, promoteOldestWaitlistedUnit, setTeamStatusTx, settleTeamAfterMemberLeft } from "@/lib/teamUnits";
import { confirmRsvpWithinCapacity, hasCapacityToRestoreConfirmedRsvp } from "@/lib/rsvpCapacity";
import { decideRsvpStatus } from "@/lib/rsvpCore";

const tx = {
  $queryRaw: vi.fn(),
  team: { count: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn(), update: vi.fn(), delete: vi.fn() },
  rSVP: { count: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
  teamJoinRequest: { updateMany: vi.fn() },
};

const event = { id: "event_1", title: "Jam", capacity: 2, privacyType: EventPrivacyType.PUBLIC };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.transaction.mockImplementation(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx));
});

describe("countConfirmedUnits", () => {
  it("counts confirmed teams plus confirmed solo registrations", async () => {
    tx.team.count.mockResolvedValue(2);
    tx.rSVP.count.mockResolvedValue(3);
    await expect(countConfirmedUnits(tx as never, "event_1")).resolves.toBe(5);
    expect(tx.team.count).toHaveBeenCalledWith({ where: { eventId: "event_1", status: RsvpStatus.CONFIRMED } });
    expect(tx.rSVP.count).toHaveBeenCalledWith({ where: { eventId: "event_1", teamId: null, status: RsvpStatus.CONFIRMED } });
  });

  it("keeps the plain confirmed-RSVP query for INDIVIDUAL events", async () => {
    tx.rSVP.count.mockResolvedValue(7);
    await expect(countConfirmedForCapacity(tx as never, "event_1", "INDIVIDUAL")).resolves.toBe(7);
    expect(tx.rSVP.count).toHaveBeenCalledWith({ where: { eventId: "event_1", status: RsvpStatus.CONFIRMED } });
    expect(tx.team.count).not.toHaveBeenCalled();
  });

  it("decides a new team's status from units like an individual RSVP", () => {
    expect(decideRsvpStatus({ capacity: 2, confirmedCount: 1, privacyType: EventPrivacyType.PUBLIC })).toBe(RsvpStatus.CONFIRMED);
    expect(decideRsvpStatus({ capacity: 2, confirmedCount: 2, privacyType: EventPrivacyType.PUBLIC })).toBe(RsvpStatus.WAITLISTED);
    expect(decideRsvpStatus({ capacity: 2, confirmedCount: 0, privacyType: EventPrivacyType.APPROVAL_REQUIRED })).toBe(RsvpStatus.PENDING_APPROVAL);
  });
});

describe("setTeamStatusTx", () => {
  it("returns null and emits nothing when the team is no longer in a `from` status", async () => {
    tx.team.updateMany.mockResolvedValue({ count: 0 });
    await expect(setTeamStatusTx(tx as never, { teamId: "team_1", eventId: "event_1", eventTitle: "Jam", from: [RsvpStatus.PENDING_APPROVAL], to: RsvpStatus.REJECTED })).resolves.toBeNull();
    expect(tx.rSVP.updateMany).not.toHaveBeenCalled();
  });

  it("returns one status webhook per member that changed, even without emails", async () => {
    tx.team.updateMany.mockResolvedValue({ count: 1 });
    tx.team.findUnique.mockResolvedValue({ name: "Byte Me" });
    tx.rSVP.findMany.mockResolvedValue([
      { id: "m1", status: RsvpStatus.PENDING_APPROVAL, checkInToken: "ticket-1", guestEmail: "a@example.test", guestName: "A", user: null },
      { id: "m2", status: RsvpStatus.PENDING_APPROVAL, checkInToken: "ticket-2", guestEmail: null, guestName: null, user: null },
    ]);
    tx.rSVP.updateMany.mockResolvedValue({ count: 2 });
    tx.teamJoinRequest.updateMany.mockResolvedValue({ count: 0 });

    await expect(setTeamStatusTx(tx as never, { teamId: "team_1", eventId: "event_1", eventTitle: "Jam", from: [RsvpStatus.PENDING_APPROVAL], to: RsvpStatus.REJECTED, notify: false })).resolves.toEqual([
      { type: "registration.status_changed", rsvpId: "m1", status: RsvpStatus.REJECTED, previousStatus: RsvpStatus.PENDING_APPROVAL },
      { type: "registration.status_changed", rsvpId: "m2", status: RsvpStatus.REJECTED, previousStatus: RsvpStatus.PENDING_APPROVAL },
    ]);
    expect(mocks.enqueueStatus).not.toHaveBeenCalled();
  });
});

describe("promoteOldestWaitlistedUnit", () => {
  it("does nothing on approval-required events", async () => {
    await expect(promoteOldestWaitlistedUnit(tx as never, { ...event, privacyType: EventPrivacyType.APPROVAL_REQUIRED })).resolves.toBeNull();
    expect(tx.team.findFirst).not.toHaveBeenCalled();
  });

  it("does nothing while all units are still taken", async () => {
    tx.team.count.mockResolvedValue(1);
    tx.rSVP.count.mockResolvedValue(1);
    await expect(promoteOldestWaitlistedUnit(tx as never, event)).resolves.toBeNull();
    expect(tx.team.findFirst).not.toHaveBeenCalled();
  });

  it("promotes an older waitlisted team as one unit and emails each member", async () => {
    tx.team.count.mockResolvedValue(0);
    tx.rSVP.count.mockResolvedValue(1);
    tx.team.findFirst.mockResolvedValue({ id: "team_1", createdAt: new Date("2030-01-01") });
    tx.rSVP.findFirst.mockResolvedValue({ id: "solo_1", createdAt: new Date("2030-02-01"), checkInToken: "t", guestEmail: "s@example.test", user: null });
    tx.team.updateMany.mockResolvedValue({ count: 1 });
    tx.team.findUnique.mockResolvedValue({ name: "Byte Me" });
    tx.rSVP.findMany.mockResolvedValue([
      { id: "m1", status: RsvpStatus.WAITLISTED, checkInToken: "ticket-1", guestEmail: "a@example.test", guestName: "A", user: null },
      { id: "m2", status: RsvpStatus.WAITLISTED, checkInToken: "ticket-2", guestEmail: null, guestName: null, user: { email: "b@example.test", name: "B" } },
    ]);
    tx.rSVP.updateMany.mockResolvedValue({ count: 2 });

    // One registration.status_changed per member, for the caller to emit after commit.
    await expect(promoteOldestWaitlistedUnit(tx as never, event)).resolves.toEqual({
      kind: "team",
      teamId: "team_1",
      webhooks: [
        { type: "registration.status_changed", rsvpId: "m1", status: RsvpStatus.CONFIRMED, previousStatus: RsvpStatus.WAITLISTED },
        { type: "registration.status_changed", rsvpId: "m2", status: RsvpStatus.CONFIRMED, previousStatus: RsvpStatus.WAITLISTED },
      ],
    });
    expect(tx.team.updateMany).toHaveBeenCalledWith({
      where: { id: "team_1", eventId: "event_1", status: { in: [RsvpStatus.WAITLISTED] } },
      data: { status: RsvpStatus.CONFIRMED },
    });
    expect(tx.rSVP.updateMany).toHaveBeenCalledWith({
      where: { teamId: "team_1", eventId: "event_1", status: { not: RsvpStatus.CONFIRMED } },
      data: { status: RsvpStatus.CONFIRMED },
    });
    expect(mocks.enqueueStatus).toHaveBeenCalledTimes(2);
    expect(mocks.enqueueStatus).toHaveBeenCalledWith(tx, expect.objectContaining({ to: "b@example.test", approved: true, checkInToken: "ticket-2", teamName: "Byte Me" }));
  });

  it("promotes an older waitlisted solo registrant only if still waitlisted and solo", async () => {
    tx.team.count.mockResolvedValue(0);
    tx.rSVP.count.mockResolvedValue(1);
    tx.team.findFirst.mockResolvedValue({ id: "team_1", createdAt: new Date("2030-03-01") });
    tx.rSVP.findFirst.mockResolvedValue({ id: "solo_1", createdAt: new Date("2030-02-01"), checkInToken: "ticket-s", guestEmail: "s@example.test", user: null });
    tx.rSVP.updateMany.mockResolvedValue({ count: 1 });

    await expect(promoteOldestWaitlistedUnit(tx as never, event)).resolves.toEqual({
      kind: "rsvp",
      rsvpId: "solo_1",
      webhooks: [{ type: "registration.status_changed", rsvpId: "solo_1", status: RsvpStatus.CONFIRMED, previousStatus: RsvpStatus.WAITLISTED }],
    });
    expect(tx.rSVP.updateMany).toHaveBeenCalledWith({
      where: { id: "solo_1", eventId: "event_1", teamId: null, status: RsvpStatus.WAITLISTED },
      data: { status: RsvpStatus.CONFIRMED },
    });
    expect(tx.team.updateMany).not.toHaveBeenCalled();
  });
});

describe("settleTeamAfterMemberLeft", () => {
  it("deletes an emptied team and reports a freed confirmed unit", async () => {
    tx.team.findFirst.mockResolvedValue({ id: "team_1", status: RsvpStatus.CONFIRMED, leaderRsvpId: null });
    tx.rSVP.findFirst.mockResolvedValue(null);
    await expect(settleTeamAfterMemberLeft(tx as never, { teamId: "team_1", eventId: "event_1", leftRsvpId: "r1" }))
      .resolves.toEqual({ teamDeleted: true, freedConfirmedUnit: true, newLeaderRsvpId: null });
    expect(tx.team.delete).toHaveBeenCalledWith({ where: { id: "team_1" } });
  });

  it("passes leadership to the longest-standing member and rotates the management link", async () => {
    tx.team.findFirst.mockResolvedValue({ id: "team_1", status: RsvpStatus.CONFIRMED, leaderRsvpId: null });
    tx.rSVP.findFirst.mockResolvedValue({ id: "r2" });
    tx.rSVP.findUnique.mockResolvedValue({ guestEmail: "next@example.test", user: null });
    await expect(settleTeamAfterMemberLeft(tx as never, { teamId: "team_1", eventId: "event_1", leftRsvpId: "r1" }))
      .resolves.toEqual({ teamDeleted: false, freedConfirmedUnit: false, newLeaderRsvpId: "r2" });
    expect(tx.rSVP.findFirst).toHaveBeenCalledWith(expect.objectContaining({ orderBy: [{ createdAt: "asc" }, { id: "asc" }] }));
    expect(tx.team.update).toHaveBeenCalledWith({ where: { id: "team_1" }, data: { leaderRsvpId: "r2", manageTokenHash: expect.stringMatching(/^[a-f0-9]{64}$/) } });
    expect(mocks.enqueueTeamCreated).toHaveBeenCalledWith(tx, expect.objectContaining({ to: "next@example.test", teamId: "team_1", reason: "leader" }));
  });
});

describe("capacity helpers on TEAM events", () => {
  it("confirms only solo RSVPs and counts units", async () => {
    tx.$queryRaw.mockResolvedValue([{ capacity: 3, status: "PUBLISHED", endDateTime: new Date("2035-01-01"), registrationMode: "TEAM" }]);
    tx.team.count.mockResolvedValue(2);
    tx.rSVP.count.mockResolvedValue(0);
    tx.rSVP.updateMany.mockResolvedValue({ count: 1 });
    await expect(confirmRsvpWithinCapacity({ rsvpId: "r1", eventId: "event_1", expectedStatuses: [RsvpStatus.WAITLISTED] })).resolves.toBe("confirmed");
    expect(tx.rSVP.updateMany).toHaveBeenCalledWith({
      where: { id: "r1", eventId: "event_1", status: { in: [RsvpStatus.WAITLISTED] }, teamId: null },
      data: { status: RsvpStatus.CONFIRMED },
    });
  });

  it("refuses when confirmed units fill the capacity", async () => {
    tx.$queryRaw.mockResolvedValue([{ capacity: 3, status: "PUBLISHED", endDateTime: new Date("2035-01-01"), registrationMode: "TEAM" }]);
    tx.team.count.mockResolvedValue(2);
    tx.rSVP.count.mockResolvedValue(1);
    await expect(confirmRsvpWithinCapacity({ rsvpId: "r1", eventId: "event_1", expectedStatuses: [RsvpStatus.WAITLISTED] })).resolves.toBe("full");
    await expect(hasCapacityToRestoreConfirmedRsvp(tx as never, { eventId: "event_1" })).resolves.toBe(false);
  });
});
