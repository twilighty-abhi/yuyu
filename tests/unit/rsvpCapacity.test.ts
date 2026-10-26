import { RsvpStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
const outboxMock = vi.hoisted(() => ({ enqueueRsvpStatusNotification: vi.fn(), enqueueRsvpConfirmation: vi.fn() }));
vi.mock("@/lib/outbox", () => outboxMock);

import { confirmRsvpWithinCapacity, hasCapacityToRestoreConfirmedRsvp } from "@/lib/rsvpCapacity";

const tx = {
  $queryRaw: vi.fn(),
  rSVP: {
    count: vi.fn(),
    updateMany: vi.fn(),
  },
  eventInstance: { findUnique: vi.fn() },
};

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.$transaction.mockImplementation(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx));
  tx.$queryRaw.mockResolvedValue([{ capacity: 2, status: "PUBLISHED", endDateTime: new Date("2035-01-01T00:00:00.000Z") }]);
});

describe("RSVP restore capacity", () => {
  it("locks the target and rejects a confirmed restore when the replacement slot is full", async () => {
    tx.$queryRaw.mockResolvedValue([{ capacity: 1 }]);
    tx.rSVP.count.mockResolvedValue(1);
    await expect(hasCapacityToRestoreConfirmedRsvp(tx as never, { eventId: "event_1" })).resolves.toBe(false);
    expect(tx.$queryRaw).toHaveBeenCalledOnce();
    expect(tx.rSVP.count).toHaveBeenCalledWith({ where: { eventId: "event_1", status: RsvpStatus.CONFIRMED, isCrew: false } });
  });

  it("keeps event-instance capacity isolated from sibling occurrences", async () => {
    tx.$queryRaw.mockResolvedValue([]);
    tx.eventInstance.findUnique.mockResolvedValue({ series: { capacity: 2 } });
    tx.rSVP.count.mockResolvedValue(1);
    await expect(hasCapacityToRestoreConfirmedRsvp(tx as never, { eventInstanceId: "instance_1" })).resolves.toBe(true);
    expect(tx.rSVP.count).toHaveBeenCalledWith({ where: { eventInstanceId: "instance_1", status: RsvpStatus.CONFIRMED, isCrew: false } });
  });
});

describe("confirmRsvpWithinCapacity", () => {
  const params = {
    rsvpId: "rsvp_1",
    eventId: "event_1",
    expectedStatuses: [RsvpStatus.WAITLISTED],
  };

  it("locks the target and promotes only when capacity remains", async () => {
    tx.rSVP.count.mockResolvedValue(1);
    tx.rSVP.updateMany.mockResolvedValue({ count: 1 });

    await expect(confirmRsvpWithinCapacity(params)).resolves.toBe("confirmed");
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.rSVP.updateMany).toHaveBeenCalledWith({
      where: { id: "rsvp_1", eventId: "event_1", status: { in: [RsvpStatus.WAITLISTED] } },
      data: { status: RsvpStatus.CONFIRMED },
    });
  });

  it("does not update an RSVP once capacity is full", async () => {
    tx.rSVP.count.mockResolvedValue(2);

    await expect(confirmRsvpWithinCapacity(params)).resolves.toBe("full");
    expect(tx.rSVP.updateMany).not.toHaveBeenCalled();
  });

  it("does not overwrite an RSVP changed by another organiser", async () => {
    tx.rSVP.count.mockResolvedValue(0);
    tx.rSVP.updateMany.mockResolvedValue({ count: 0 });

    await expect(confirmRsvpWithinCapacity(params)).resolves.toBe("changed");
  });

  it("does not approve an RSVP after the event has closed", async () => {
    tx.$queryRaw.mockResolvedValue([{ capacity: 2, status: "CANCELLED", endDateTime: new Date("2035-01-01T00:00:00.000Z") }]);

    await expect(confirmRsvpWithinCapacity({ ...params, requireOpen: true })).resolves.toBe("closed");
    expect(tx.rSVP.updateMany).not.toHaveBeenCalled();
  });

  describe("re-accepting a declined RSVP (whenFull: waitlist)", () => {
    const reaccept = {
      rsvpId: "rsvp_1",
      eventId: "event_1",
      expectedStatuses: [RsvpStatus.REJECTED],
      requireOpen: true,
      whenFull: "waitlist" as const,
      notification: { to: "guest@example.test", eventTitle: "Meetup", checkInToken: "token_1" },
    };

    it("confirms and queues the approval email when there is room", async () => {
      tx.rSVP.count.mockResolvedValue(1);
      tx.rSVP.updateMany.mockResolvedValue({ count: 1 });

      await expect(confirmRsvpWithinCapacity(reaccept)).resolves.toBe("confirmed");
      expect(tx.rSVP.updateMany).toHaveBeenCalledWith({
        where: { id: "rsvp_1", eventId: "event_1", status: { in: [RsvpStatus.REJECTED] } },
        data: { status: RsvpStatus.CONFIRMED },
      });
      expect(outboxMock.enqueueRsvpStatusNotification).toHaveBeenCalledWith(tx, { ...reaccept.notification, approved: true });
      expect(outboxMock.enqueueRsvpConfirmation).not.toHaveBeenCalled();
    });

    it("waitlists inside the same lock and queues the waitlist email when full", async () => {
      tx.rSVP.count.mockResolvedValue(2);
      tx.rSVP.updateMany.mockResolvedValue({ count: 1 });

      await expect(confirmRsvpWithinCapacity(reaccept)).resolves.toBe("waitlisted");
      expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
      expect(tx.rSVP.updateMany).toHaveBeenCalledWith({
        where: { id: "rsvp_1", eventId: "event_1", status: { in: [RsvpStatus.REJECTED] } },
        data: { status: RsvpStatus.WAITLISTED },
      });
      expect(outboxMock.enqueueRsvpConfirmation).toHaveBeenCalledWith(tx, { ...reaccept.notification, status: RsvpStatus.WAITLISTED });
      expect(outboxMock.enqueueRsvpStatusNotification).not.toHaveBeenCalled();
    });

    it("sends nothing when another organiser changed the RSVP first", async () => {
      tx.rSVP.count.mockResolvedValue(2);
      tx.rSVP.updateMany.mockResolvedValue({ count: 0 });

      await expect(confirmRsvpWithinCapacity(reaccept)).resolves.toBe("changed");
      expect(outboxMock.enqueueRsvpConfirmation).not.toHaveBeenCalled();
    });

    it("does not re-accept after the event has closed", async () => {
      tx.$queryRaw.mockResolvedValue([{ capacity: 2, status: "PUBLISHED", endDateTime: new Date("2000-01-01T00:00:00.000Z") }]);

      await expect(confirmRsvpWithinCapacity(reaccept)).resolves.toBe("closed");
      expect(tx.rSVP.updateMany).not.toHaveBeenCalled();
    });
  });
});
