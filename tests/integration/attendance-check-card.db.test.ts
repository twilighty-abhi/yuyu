import { randomUUID } from "node:crypto";
import { AttendanceResponse, EventPrivacyType, EventStatus, MembershipRole, RsvpStatus } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const identity = vi.hoisted(() => ({ id: "" }));
vi.mock("@/lib/auth", () => ({ auth: async () => (identity.id ? { user: { id: identity.id } } : null) }));
vi.mock("@/lib/actionRateLimit", () => ({ isActionRateLimited: async () => false }));
vi.mock("@/lib/outboxWorker", () => ({ startOutboxWorker: () => {} }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { prisma } from "@/lib/db";
import { sendAttendanceChecksForUser } from "@/lib/core/attendanceCheck";
import { loadAttendanceCheckCard } from "@/lib/eventDashboard/attendanceCheckCard";
import { loadAttendanceReplyCounts } from "@/lib/eventDashboard/overview";
import { cloneEvent } from "@/app/actions/event";

/*
 * The Emails tab's "Attendance confirmation" card loader
 * (lib/eventDashboard/attendanceCheckCard.ts) and the clone rule for the
 * release-on-decline setting.
 */

const suffix = randomUUID().replace(/-/g, "");
let orgId: string;
let orgSlug: string;
let ownerId: string;
const userIds: string[] = [];
const eventIds: string[] = [];
let counter = 0;

async function makeEvent(overrides: { status?: EventStatus; start?: Date; releaseOnDecline?: boolean } = {}) {
  counter += 1;
  const start = overrides.start ?? new Date(Date.now() + 3 * 86_400_000);
  const event = await prisma.event.create({
    data: {
      organisationId: orgId,
      title: `Card event ${counter}`,
      slug: `card-event-${counter}-${suffix}`,
      startDateTime: start,
      endDateTime: new Date(start.getTime() + 2 * 3_600_000),
      timezone: "Asia/Kolkata",
      status: overrides.status ?? EventStatus.PUBLISHED,
      privacyType: EventPrivacyType.PUBLIC,
      attendanceCheckReleaseOnDecline: overrides.releaseOnDecline ?? false,
      page: { create: { isPublished: true } },
    },
  });
  eventIds.push(event.id);
  return event;
}

async function addGuest(eventId: string, status: RsvpStatus) {
  counter += 1;
  const email = `card-guest-${counter}-${suffix}@example.test`;
  return prisma.rSVP.create({
    data: { eventId, status, attendeeKey: `guest:${email}`, guestName: `Guest ${counter}`, guestEmail: email },
  });
}

beforeAll(async () => {
  orgSlug = `card-${suffix}`;
  orgId = (await prisma.organisation.create({ data: { name: "Card org", slug: orgSlug } })).id;
  const owner = await prisma.user.create({
    data: {
      email: `card-owner-${suffix}@example.test`,
      name: "Card Owner",
      emailVerified: new Date(),
      memberships: { create: { organisationId: orgId, role: MembershipRole.OWNER } },
    },
  });
  ownerId = owner.id;
  userIds.push(owner.id);
});

afterAll(async () => {
  await prisma.outboxMessage.deleteMany({ where: { kind: "attendance-check", payload: { path: ["to"], string_contains: suffix } } }).catch(() => undefined);
  await prisma.event.deleteMany({ where: { organisationId: orgId } });
  await prisma.auditEvent.deleteMany({ where: { organisationId: orgId } });
  await prisma.organisation.deleteMany({ where: { id: orgId } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
});

describe("loadAttendanceCheckCard", () => {
  it("starts as not sent, counting only confirmed guests as unasked", async () => {
    const event = await makeEvent();
    await addGuest(event.id, RsvpStatus.CONFIRMED);
    await addGuest(event.id, RsvpStatus.CONFIRMED);
    await addGuest(event.id, RsvpStatus.WAITLISTED);
    await addGuest(event.id, RsvpStatus.PENDING_APPROVAL);

    const card = await loadAttendanceCheckCard(event);
    expect(card).toMatchObject({ asked: 0, notAsked: 2, coming: 0, notComing: 0, noReply: 0, remindable: 0, released: 0, closed: null, lastSent: null, releaseOnDecline: false });
    expect(card.eventStartLabel).toContain("IST");
  });

  it("reports the send, who sent it, replies and newly confirmed guests", async () => {
    const event = await makeEvent();
    const first = await addGuest(event.id, RsvpStatus.CONFIRMED);
    const second = await addGuest(event.id, RsvpStatus.CONFIRMED);
    await addGuest(event.id, RsvpStatus.CONFIRMED);

    const sent = await sendAttendanceChecksForUser(ownerId, { organisationSlug: orgSlug, eventId: event.id });
    expect(sent).toEqual({ ok: true, data: { queued: 3 } });

    await prisma.attendanceCheck.update({ where: { rsvpId: first.id }, data: { response: AttendanceResponse.ATTENDING, respondedAt: new Date() } });
    await prisma.attendanceCheck.update({ where: { rsvpId: second.id }, data: { response: AttendanceResponse.NOT_ATTENDING, respondedAt: new Date() } });
    await addGuest(event.id, RsvpStatus.CONFIRMED);

    const card = await loadAttendanceCheckCard(event);
    expect(card).toMatchObject({ asked: 3, coming: 1, notComing: 1, noReply: 1, notAsked: 1, remindable: 0 });
    expect(card.lastSent).toMatchObject({ byName: "Card Owner", recipientCount: 3 });
    expect(card.lastSent?.label).toContain("IST");
    // Nobody is due yet: the card says when the next reminder becomes possible.
    expect(card.nextReminderLabel).toContain("IST");
  });

  it("counts a guest as remindable 12 hours after the email", async () => {
    const event = await makeEvent();
    const guest = await addGuest(event.id, RsvpStatus.CONFIRMED);
    await sendAttendanceChecksForUser(ownerId, { organisationSlug: orgSlug, eventId: event.id });
    await prisma.attendanceCheck.update({ where: { rsvpId: guest.id }, data: { sentAt: new Date(Date.now() - 13 * 3_600_000) } });

    const card = await loadAttendanceCheckCard(event);
    expect(card).toMatchObject({ noReply: 1, remindable: 1, nextReminderLabel: null });
  });

  it("is closed after the start and for cancelled events", async () => {
    const started = await makeEvent({ start: new Date(Date.now() - 3_600_000) });
    expect((await loadAttendanceCheckCard(started)).closed).toBe("started");
    const cancelled = await makeEvent({ status: EventStatus.CANCELLED });
    expect((await loadAttendanceCheckCard(cancelled)).closed).toBe("cancelled");
  });
});

describe("loadAttendanceReplyCounts (Overview line)", () => {
  it("is null before the first send, then counts replies like the Emails card", async () => {
    const event = await makeEvent();
    const coming = await addGuest(event.id, RsvpStatus.CONFIRMED);
    const declined = await addGuest(event.id, RsvpStatus.CONFIRMED);
    const silent = await addGuest(event.id, RsvpStatus.CONFIRMED);
    const lapsed = await addGuest(event.id, RsvpStatus.CONFIRMED);
    await addGuest(event.id, RsvpStatus.WAITLISTED);
    expect(await loadAttendanceReplyCounts(event.id)).toBeNull();

    await sendAttendanceChecksForUser(ownerId, { organisationSlug: orgSlug, eventId: event.id });
    await prisma.attendanceCheck.update({ where: { rsvpId: coming.id }, data: { response: AttendanceResponse.ATTENDING, respondedAt: new Date() } });
    await prisma.attendanceCheck.update({ where: { rsvpId: declined.id }, data: { response: AttendanceResponse.NOT_ATTENDING, respondedAt: new Date() } });
    // A guest who is no longer confirmed and never replied is not "no reply".
    await prisma.rSVP.update({ where: { id: lapsed.id }, data: { status: RsvpStatus.REJECTED } });

    expect(await loadAttendanceReplyCounts(event.id)).toEqual({ coming: 1, notComing: 1, noReply: 1 });
    const card = await loadAttendanceCheckCard(event);
    expect({ coming: card.coming, notComing: card.notComing, noReply: card.noReply }).toEqual({ coming: 1, notComing: 1, noReply: 1 });
    expect(silent.id).toBeTruthy();
  });
});

describe("cloneEvent", () => {
  it("copies the release-on-decline setting but never the checks", async () => {
    const source = await makeEvent({ releaseOnDecline: true });
    await addGuest(source.id, RsvpStatus.CONFIRMED);
    await sendAttendanceChecksForUser(ownerId, { organisationSlug: orgSlug, eventId: source.id });
    expect(await prisma.attendanceCheck.count({ where: { eventId: source.id } })).toBe(1);

    identity.id = ownerId;
    const result = await cloneEvent({ organisationSlug: orgSlug, eventId: source.id });
    identity.id = "";
    expect(result.ok).toBe(true);
    const cloneId = result.ok ? result.data?.eventId : undefined;
    expect(cloneId).toBeTruthy();
    const clone = await prisma.event.findUniqueOrThrow({ where: { id: cloneId! }, select: { attendanceCheckReleaseOnDecline: true } });
    expect(clone.attendanceCheckReleaseOnDecline).toBe(true);
    expect(await prisma.attendanceCheck.count({ where: { eventId: cloneId! } })).toBe(0);
  });
});
