import { RsvpStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/outbox", () => ({ enqueueRsvpStatusNotification: vi.fn() }));

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
});

describe("RSVP restore capacity", () => {
  it("locks the target and rejects a confirmed restore when the replacement slot is full", async () => {
    tx.$queryRaw.mockResolvedValue([{ capacity: 1 }]);
    tx.rSVP.count.mockResolvedValue(1);
    await expect(hasCapacityToRestoreConfirmedRsvp(tx as never, { eventId: "event_1" })).resolves.toBe(false);
    expect(tx.$queryRaw).toHaveBeenCalledOnce();
    expect(tx.rSVP.count).toHaveBeenCalledWith({ where: { eventId: "event_1", status: RsvpStatus.CONFIRMED } });
  });

  it("keeps event-instance capacity isolated from sibling occurrences", async () => {
    tx.$queryRaw.mockResolvedValue([]);
    tx.eventInstance.findUnique.mockResolvedValue({ series: { capacity: 2 } });
    tx.rSVP.count.mockResolvedValue(1);
    await expect(hasCapacityToRestoreConfirmedRsvp(tx as never, { eventInstanceId: "instance_1" })).resolves.toBe(true);
    expect(tx.rSVP.count).toHaveBeenCalledWith({ where: { eventInstanceId: "instance_1", status: RsvpStatus.CONFIRMED } });
  });
});

describe("confirmRsvpWithinCapacity", () => {
  const params = {
    rsvpId: "rsvp_1",
    eventId: "event_1",
    capacity: 2,
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
});
