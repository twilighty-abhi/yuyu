import { randomUUID } from "node:crypto";
import { EventStatus, EventPrivacyType, RsvpStatus } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { confirmRsvpWithinCapacity } from "@/lib/rsvpCapacity";

const suffix = randomUUID().replace(/-/g, "");
let organisationId: string;

async function createCapacityScenario(capacity: number, firstStatus: RsvpStatus, secondStatus: RsvpStatus) {
  const event = await prisma.event.create({
    data: {
      organisationId,
      title: `Capacity test ${suffix}`,
      slug: `capacity-test-${suffix}-${Math.random().toString(36).slice(2, 8)}`,
      startDateTime: new Date("2030-01-01T10:00:00.000Z"),
      endDateTime: new Date("2030-01-01T11:00:00.000Z"),
      timezone: "UTC",
      capacity,
      status: EventStatus.PUBLISHED,
      privacyType: EventPrivacyType.PUBLIC,
    },
  });
  const first = await prisma.rSVP.create({
    data: {
      eventId: event.id,
      attendeeKey: `first:${suffix}:${event.id}`,
      guestEmail: `first-${suffix}@example.test`,
      guestName: "First attendee",
      status: firstStatus,
    },
  });
  const second = await prisma.rSVP.create({
    data: {
      eventId: event.id,
      attendeeKey: `second:${suffix}:${event.id}`,
      guestEmail: `second-${suffix}@example.test`,
      guestName: "Second attendee",
      status: secondStatus,
    },
  });
  return { event, first, second };
}

describe.sequential("RSVP capacity integration", () => {
  beforeAll(async () => {
    const organisation = await prisma.organisation.create({
      data: { name: `Capacity test ${suffix}`, slug: `capacity-test-${suffix}` },
    });
    organisationId = organisation.id;
  });

  afterAll(async () => {
    if (organisationId) await prisma.organisation.delete({ where: { id: organisationId } });
    await prisma.$disconnect();
  });

  it("does not oversell an event that has reached capacity", async () => {
    const { event, second } = await createCapacityScenario(1, RsvpStatus.CONFIRMED, RsvpStatus.WAITLISTED);

    await expect(confirmRsvpWithinCapacity({
      rsvpId: second.id,
      eventId: event.id,
      capacity: event.capacity,
      expectedStatuses: [RsvpStatus.WAITLISTED],
    })).resolves.toBe("full");

    await expect(prisma.rSVP.findUniqueOrThrow({ where: { id: second.id } })).resolves.toMatchObject({ status: RsvpStatus.WAITLISTED });
  });

  it("promotes a waiter when capacity remains", async () => {
    const { event, second } = await createCapacityScenario(2, RsvpStatus.CONFIRMED, RsvpStatus.WAITLISTED);

    await expect(confirmRsvpWithinCapacity({
      rsvpId: second.id,
      eventId: event.id,
      capacity: event.capacity,
      expectedStatuses: [RsvpStatus.WAITLISTED],
    })).resolves.toBe("confirmed");

    await expect(prisma.rSVP.count({ where: { eventId: event.id, status: RsvpStatus.CONFIRMED } })).resolves.toBe(2);
  });

  it("does not overwrite an RSVP that changed status before promotion", async () => {
    const { event, second } = await createCapacityScenario(2, RsvpStatus.CONFIRMED, RsvpStatus.REJECTED);

    await expect(confirmRsvpWithinCapacity({
      rsvpId: second.id,
      eventId: event.id,
      capacity: event.capacity,
      expectedStatuses: [RsvpStatus.WAITLISTED],
    })).resolves.toBe("changed");
  });
});
