import { randomUUID } from "node:crypto";
import { EventPrivacyType, EventStatus, MembershipRole, RsvpStatus, WebhookDeliveryStatus } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/*
 * Prisma keeps DateTime columns as UTC wall-clock `timestamp(3)`. Raw SQL that
 * passes a JS Date (sent as timestamptz) or uses now() is converted with the
 * session TimeZone, so on a database whose TimeZone is not UTC it wrote and
 * compared shifted times. These tests run the raw-SQL paths with the database
 * TimeZone set to Asia/Kolkata (UTC+5:30), the initdb default on many hosts.
 */

vi.mock("@/lib/auth", () => ({ auth: async () => null }));
vi.mock("@/lib/actionRateLimit", () => ({ isActionRateLimited: async () => false }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/outboxWorker", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/outboxWorker")>()), startOutboxWorker: vi.fn() }));

import { prisma } from "@/lib/db";
import { remindAttendanceChecksForUser } from "@/lib/core/attendanceCheck";
import { ATTENDANCE_REMINDER_INTERVAL_MS } from "@/lib/attendanceCheck";
import { hashAttendanceToken } from "@/lib/attendanceToken";
import { deliverWebhookBatch } from "@/lib/webhooks/delivery";
import { flushWebhookEmits } from "@/lib/webhooks/emit";

const suffix = randomUUID().replace(/-/g, "");
let databaseName = "";
let orgId = "";
let ownerId = "";

async function setDatabaseTimeZone(zone: string | null) {
  // Identifiers can't be parameters; the name comes from current_database().
  const quoted = `"${databaseName.replace(/"/g, '""')}"`;
  await prisma.$executeRawUnsafe(zone ? `ALTER DATABASE ${quoted} SET timezone TO '${zone}'` : `ALTER DATABASE ${quoted} RESET timezone`);
  // New sessions pick the setting up; drop the pooled ones.
  await prisma.$disconnect();
}

beforeAll(async () => {
  databaseName = (await prisma.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS "name"`)[0]!.name;
  await setDatabaseTimeZone("Asia/Kolkata");
  expect((await prisma.$queryRaw<Array<{ TimeZone: string }>>`SHOW timezone`)[0]!.TimeZone).toBe("Asia/Kolkata");
  orgId = (await prisma.organisation.create({ data: { name: "Timezone org", slug: `tz-${suffix}` } })).id;
  const owner = await prisma.user.create({ data: { email: `tz-owner-${suffix}@example.test`, emailVerified: new Date() } });
  ownerId = owner.id;
  await prisma.membership.create({ data: { userId: ownerId, organisationId: orgId, role: MembershipRole.OWNER } });
});

afterAll(async () => {
  await flushWebhookEmits().catch(() => undefined);
  await prisma.$executeRaw`DELETE FROM "OutboxMessage" WHERE "payload"->>'to' LIKE ${`%${suffix}@example.test`}`;
  await prisma.organisation.deleteMany({ where: { id: orgId } });
  await prisma.user.deleteMany({ where: { id: ownerId } });
  await setDatabaseTimeZone(null);
});

describe("raw SQL timestamps on a non-UTC database", () => {
  it("stores the attendance reminder time as now, not shifted by the session offset", async () => {
    const event = await prisma.event.create({
      data: {
        organisationId: orgId,
        title: "Timezone attendance",
        slug: `tz-attendance-${suffix}`,
        startDateTime: new Date("2035-01-01T10:00:00.000Z"),
        endDateTime: new Date("2035-01-01T12:00:00.000Z"),
        timezone: "UTC",
        status: EventStatus.PUBLISHED,
        privacyType: EventPrivacyType.PUBLIC,
        page: { create: { isPublished: true } },
      },
    });
    const email = `tz-guest-${suffix}@example.test`;
    const rsvp = await prisma.rSVP.create({ data: { eventId: event.id, attendeeKey: `guest:${email}`, guestEmail: email, guestName: "Guest", status: RsvpStatus.CONFIRMED } });
    const lastSent = new Date(Date.now() - ATTENDANCE_REMINDER_INTERVAL_MS - 60 * 60_000);
    await prisma.attendanceCheck.create({ data: { eventId: event.id, rsvpId: rsvp.id, tokenHash: hashAttendanceToken(`tz-${suffix}`), sentAt: lastSent } });

    const before = Date.now();
    expect(await remindAttendanceChecksForUser(ownerId, { organisationSlug: `tz-${suffix}`, eventId: event.id })).toMatchObject({ ok: true, data: { queued: 1 } });
    const stored = await prisma.attendanceCheck.findUniqueOrThrow({ where: { rsvpId: rsvp.id }, select: { sentAt: true, updatedAt: true } });
    expect(Math.abs(stored.sentAt.getTime() - before)).toBeLessThan(60_000);
    expect(Math.abs(stored.updatedAt.getTime() - before)).toBeLessThan(60_000);

    // The 12-hour throttle compares against the stored time correctly: an
    // immediate second reminder is refused.
    expect(await remindAttendanceChecksForUser(ownerId, { organisationSlug: `tz-${suffix}`, eventId: event.id })).toMatchObject({ ok: false });
  });

  it("does not claim a webhook delivery before its retry time", async () => {
    const endpoint = await prisma.webhookEndpoint.create({
      data: { organisationId: orgId, url: "https://hooks.example.test/tz", eventTypes: ["event.published"], secretEncrypted: "unused" },
    });
    const notYet = new Date(Date.now() + 2 * 60 * 60_000);
    const delivery = await prisma.webhookDelivery.create({
      data: { endpointId: endpoint.id, organisationId: orgId, eventId: `evt_tz_${suffix}`, eventType: "event.published", payload: {}, nextAttemptAt: notYet },
    });
    await deliverWebhookBatch(100);
    const after = await prisma.webhookDelivery.findUniqueOrThrow({ where: { id: delivery.id } });
    expect(after).toMatchObject({ status: WebhookDeliveryStatus.PENDING, attempts: 0, lockedAt: null });
  });
});
