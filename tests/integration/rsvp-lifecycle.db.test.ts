import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EventPrivacyType, EventStatus, RsvpStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { submitRsvpCore } from "@/lib/rsvpCore";

const suffix = randomUUID().replaceAll("-", "");
let organisationId = "";
const orgSlug = `rsvp-lifecycle-${suffix}`;

async function createEvent(input: { capacity?: number; privacyType?: EventPrivacyType; released?: boolean }) {
  return prisma.event.create({ data: {
    organisationId,
    title: `RSVP ${suffix}`,
    slug: `rsvp-${suffix}-${randomUUID().slice(0, 8)}`,
    startDateTime: new Date("2035-01-01T10:00:00.000Z"),
    endDateTime: new Date("2035-01-01T12:00:00.000Z"),
    timezone: "UTC",
    status: EventStatus.PUBLISHED,
    privacyType: input.privacyType ?? EventPrivacyType.PUBLIC,
    capacity: input.capacity,
    page: { create: { isPublished: input.released ?? true } },
  } });
}

describe.sequential("RSVP lifecycle integration", () => {
  beforeAll(async () => {
    const org = await prisma.organisation.create({ data: { name: `RSVP ${suffix}`, slug: orgSlug } });
    organisationId = org.id;
  });

  afterAll(async () => {
    if (organisationId) await prisma.organisation.delete({ where: { id: organisationId } });
    await prisma.$disconnect();
  });

  it("rejects direct registration for an unreleased standalone website", async () => {
    const event = await createEvent({ released: false });
    const result = await submitRsvpCore({ orgSlug, eventSlug: event.slug, guestEmail: `unreleased-${suffix}@example.test`, name: "Unreleased guest", answers: {} }, { userId: null });
    expect(result).toEqual({ ok: false, error: "This event is not open for RSVP." });
    await expect(prisma.rSVP.count({ where: { eventId: event.id } })).resolves.toBe(0);
  });

  it("serializes final-slot races into one confirmation and one waitlist entry", async () => {
    const event = await createEvent({ capacity: 1 });
    const results = await Promise.all([
      submitRsvpCore({ orgSlug, eventSlug: event.slug, guestEmail: `race-a-${suffix}@example.test`, name: "Race A", answers: {} }, { userId: null }),
      submitRsvpCore({ orgSlug, eventSlug: event.slug, guestEmail: `race-b-${suffix}@example.test`, name: "Race B", answers: {} }, { userId: null }),
    ]);
    expect(results.every((result) => result.ok)).toBe(true);
    expect(results.map((result) => result.ok ? result.data!.status : null).sort()).toEqual([RsvpStatus.CONFIRMED, RsvpStatus.WAITLISTED].sort());
    await expect(prisma.rSVP.count({ where: { eventId: event.id, status: RsvpStatus.CONFIRMED } })).resolves.toBe(1);
  });

  it("keeps approval mandatory even while the event is full", async () => {
    const event = await createEvent({ capacity: 1, privacyType: EventPrivacyType.APPROVAL_REQUIRED });
    await prisma.rSVP.create({ data: { eventId: event.id, attendeeKey: `existing:${suffix}`, guestEmail: `existing-${suffix}@example.test`, guestName: "Existing", status: RsvpStatus.CONFIRMED } });
    const result = await submitRsvpCore({ orgSlug, eventSlug: event.slug, guestEmail: `approval-${suffix}@example.test`, name: "Approval guest", answers: {} }, { userId: null });
    expect(result.ok && result.data?.status).toBe(RsvpStatus.PENDING_APPROVAL);
  });

  it("applies capacity independently to each recurring occurrence", async () => {
    const series = await prisma.eventSeries.create({ data: { organisationId, title: "Instances", slug: `instances-${suffix}`, recurrenceRule: "DTSTART:20350101T100000Z\nRRULE:FREQ=DAILY;COUNT=2", instanceDurationMs: 3_600_000, timezone: "UTC", status: EventStatus.PUBLISHED, capacity: 1 } });
    const [first, second] = await Promise.all([
      prisma.eventInstance.create({ data: { eventSeriesId: series.id, startDateTime: new Date("2035-01-01T10:00:00Z"), endDateTime: new Date("2035-01-01T11:00:00Z") } }),
      prisma.eventInstance.create({ data: { eventSeriesId: series.id, startDateTime: new Date("2035-01-02T10:00:00Z"), endDateTime: new Date("2035-01-02T11:00:00Z") } }),
    ]);
    const [a, b] = await Promise.all([
      submitRsvpCore({ orgSlug, eventInstanceId: first.id, guestEmail: `instance-a-${suffix}@example.test`, name: "Instance A" }, { userId: null }),
      submitRsvpCore({ orgSlug, eventInstanceId: second.id, guestEmail: `instance-b-${suffix}@example.test`, name: "Instance B" }, { userId: null }),
    ]);
    expect(a.ok && a.data?.status).toBe(RsvpStatus.CONFIRMED);
    expect(b.ok && b.data?.status).toBe(RsvpStatus.CONFIRMED);
  });
});
