import { RsvpStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/outbox", () => ({ enqueueRsvpStatusNotification: vi.fn() }));

import { confirmRsvpWithinCapacity } from "@/lib/rsvpCapacity";

const tx = {
  $queryRaw: vi.fn(),
  rSVP: {
    count: vi.fn(),
    updateMany: vi.fn(),
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.$transaction.mockImplementation(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx));
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
