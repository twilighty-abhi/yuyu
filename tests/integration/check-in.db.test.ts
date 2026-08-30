import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EventPrivacyType, EventStatus, RsvpStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { commitCheckInProjection, commitUndoCheckInProjection } from "@/lib/checkInMutations";

const suffix = randomUUID().replaceAll("-", "");
let organisationId = "";
let eventId = "";

describe.sequential("check-in projection integration", () => {
  beforeAll(async () => {
    const organisation = await prisma.organisation.create({ data: { name: `Check-in ${suffix}`, slug: `check-in-${suffix}` } });
    organisationId = organisation.id;
    const event = await prisma.event.create({ data: {
      organisationId,
      title: "Check-in race",
      slug: `check-in-race-${suffix}`,
      startDateTime: new Date("2035-01-01T10:00:00Z"),
      endDateTime: new Date("2035-01-01T12:00:00Z"),
      timezone: "UTC",
      status: EventStatus.PUBLISHED,
      privacyType: EventPrivacyType.PUBLIC,
    } });
    eventId = event.id;
  });

  afterAll(async () => {
    if (organisationId) await prisma.organisation.delete({ where: { id: organisationId } });
    await prisma.$disconnect();
  });

  it("records exactly one history entry for concurrent scans and concurrent undo", async () => {
    const rsvp = await prisma.rSVP.create({ data: {
      eventId,
      attendeeKey: `guest:race-${suffix}@example.test`,
      guestEmail: `race-${suffix}@example.test`,
      status: RsvpStatus.CONFIRMED,
    } });
    const checkedInAt = new Date("2035-01-01T10:05:00Z");
    const scans = await Promise.all([
      commitCheckInProjection({ rsvpId: rsvp.id, actorUserId: null, source: "venue-station", checkedInAt, force: false }),
      commitCheckInProjection({ rsvpId: rsvp.id, actorUserId: null, source: "venue-station", checkedInAt, force: false }),
    ]);
    expect(scans.map((result) => result.state).sort()).toEqual(["already-checked-in", "checked-in"]);
    await expect(prisma.checkInEvent.count({ where: { rsvpId: rsvp.id, action: "CHECKED_IN" } })).resolves.toBe(1);

    const undos = await Promise.all([
      commitUndoCheckInProjection({ rsvpId: rsvp.id, actorUserId: null, source: "venue-station" }),
      commitUndoCheckInProjection({ rsvpId: rsvp.id, actorUserId: null, source: "venue-station" }),
    ]);
    expect(undos.sort()).toEqual([false, true]);
    await expect(prisma.checkInEvent.count({ where: { rsvpId: rsvp.id, action: "CHECK_IN_UNDONE" } })).resolves.toBe(1);
  });

  it("keeps eligibility in the conditional write", async () => {
    const rsvp = await prisma.rSVP.create({ data: {
      eventId,
      attendeeKey: `guest:rejected-${suffix}@example.test`,
      guestEmail: `rejected-${suffix}@example.test`,
      status: RsvpStatus.REJECTED,
    } });
    await expect(commitCheckInProjection({ rsvpId: rsvp.id, actorUserId: null, source: "online", checkedInAt: new Date(), force: true }))
      .resolves.toEqual({ state: "ineligible", status: RsvpStatus.REJECTED });
    await expect(prisma.checkInEvent.count({ where: { rsvpId: rsvp.id } })).resolves.toBe(0);
  });
});
