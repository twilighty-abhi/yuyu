import { randomUUID } from "node:crypto";
import {
  AttendanceResponse,
  EventPermission,
  EventPrivacyType,
  EventStatus,
  MembershipRole,
  RegistrationMode,
  RsvpStatus,
  SoloPolicy,
  type Event,
} from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Attendance confirmation ("Are you still coming?", docs/FEATURES.md).
 *
 * The rules under test: nothing is ever sent without an explicit organiser
 * action; only CONFIRMED registrations of a one-off event are asked, once
 * each, even under concurrent sends; only organisation owners/admins may
 * send (the broadcast rule; no collaborator grant covers emailing guests);
 * reminders are throttled to one per guest per 12 hours and rotate the link;
 * and a "No" with release on cancels through the self-cancel core, so the
 * waitlist and team rules apply exactly as when a guest cancels.
 */

const identity = vi.hoisted(() => ({ id: "" }));
const mocks = vi.hoisted(() => ({ sendAttendanceCheckEmail: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: async () => (identity.id ? { user: { id: identity.id } } : null) }));
vi.mock("@/lib/actionRateLimit", () => ({ isActionRateLimited: async () => false }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/publicUrl", () => ({ getRequestOrigin: async () => "https://yuyu.example.test" }));
// Keep the real scheduler (the "never automatic" test runs it) but never start a timer.
vi.mock("@/lib/outboxWorker", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/outboxWorker")>()), startOutboxWorker: vi.fn() }));
// No email ever leaves the test: the attendance sender is a spy and every
// other kind sees "no transport configured" (the mock path).
vi.mock("@/lib/email/transporter", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/email/transporter")>()),
  getEmailTransport: async () => ({ from: "test@example.test", transporter: null, source: "env" }),
}));
vi.mock("@/lib/email", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/email")>()),
  sendAttendanceCheckEmail: mocks.sendAttendanceCheckEmail,
}));

import { prisma } from "@/lib/db";
import {
  ATTENDANCE_AUDIT,
  issueAttendanceLinkForUser,
  loadAttendanceCheckStatus,
  previewAttendanceCheckSendForUser,
  remindAttendanceChecksForUser,
  resolveAttendanceCheckByToken,
  respondToAttendanceCheck,
  sendAttendanceChecksForUser,
  setAttendanceReleaseOnDeclineForUser,
} from "@/lib/core/attendanceCheck";
import { issueAttendanceLink, sendAttendanceChecks, submitAttendanceReply } from "@/app/actions/attendance-check";
import { runOutboxScheduler } from "@/lib/outboxWorker";
import { deliverOutboxBatch } from "@/lib/outbox";
import { generateAttendanceToken, hashAttendanceToken } from "@/lib/attendanceToken";
import { ATTENDANCE_REMINDER_INTERVAL_MS } from "@/lib/attendanceCheck";
import { addCrewMemberAsOrganiser } from "@/lib/core/crew";
import { submitRsvpCore } from "@/lib/rsvpCore";
import { flushWebhookEmits } from "@/lib/webhooks/emit";
import { revalidatePath } from "next/cache";
import { cancelRsvpForUser } from "@/lib/core/rsvpCancel";

const suffix = randomUUID().replace(/-/g, "");
const orgSlug = `attend-${suffix}`;
const otherOrgSlug = `attend-other-${suffix}`;
let orgId = "";
let otherOrgId = "";
let ownerId = "";
let adminId = "";
let memberId = "";
let otherOwnerId = "";
const userIds: string[] = [];
let sequence = 0;

const FUTURE_START = new Date("2035-01-01T10:00:00.000Z");
const FUTURE_END = new Date("2035-01-01T12:00:00.000Z");

async function makeUser(label: string, role?: MembershipRole, organisationId = orgId) {
  const user = await prisma.user.create({
    data: { email: `attend-${label}-${suffix}@example.test`, name: `Attend ${label}`, emailVerified: new Date() },
  });
  userIds.push(user.id);
  if (role) await prisma.membership.create({ data: { userId: user.id, organisationId, role } });
  return user.id;
}

type EventOptions = {
  organisationId?: string;
  start?: Date;
  status?: EventStatus;
  capacity?: number;
  releaseOnDecline?: boolean;
  registrationMode?: RegistrationMode;
};

async function makeEvent(options: EventOptions = {}) {
  sequence += 1;
  const team = options.registrationMode === RegistrationMode.TEAM;
  const start = options.start ?? FUTURE_START;
  return prisma.event.create({
    data: {
      organisationId: options.organisationId ?? orgId,
      title: `Attendance ${sequence}`,
      slug: `attendance-${sequence}-${suffix}`,
      startDateTime: start,
      endDateTime: new Date(Math.max(start.getTime() + 2 * 3_600_000, FUTURE_END.getTime())),
      timezone: "Europe/London",
      location: "Main hall",
      status: options.status ?? EventStatus.PUBLISHED,
      privacyType: EventPrivacyType.PUBLIC,
      capacity: options.capacity,
      attendanceCheckReleaseOnDecline: options.releaseOnDecline ?? false,
      registrationMode: options.registrationMode ?? RegistrationMode.INDIVIDUAL,
      teamMaxSize: team ? 4 : undefined,
      soloPolicy: SoloPolicy.SOLO_ALLOWED,
      page: { create: { isPublished: true } },
    },
  });
}

async function guest(eventId: string, status: RsvpStatus = RsvpStatus.CONFIRMED, extra: { checkedInAt?: Date } = {}) {
  sequence += 1;
  const email = `guest-${sequence}-${suffix}@example.test`;
  return prisma.rSVP.create({
    data: { eventId, attendeeKey: `guest:${email}`, guestEmail: email, guestName: `Guest ${sequence}`, status, ...extra },
  });
}

const ref = (event: Pick<Event, "id" | "organisationId">) => ({
  organisationSlug: event.organisationId === otherOrgId ? otherOrgSlug : orgSlug,
  eventId: event.id,
});

/** The raw link token exists only in the queued email; take the newest one for this registration. */
async function tokenFor(rsvpId: string) {
  const check = await prisma.attendanceCheck.findUniqueOrThrow({ where: { rsvpId }, select: { tokenHash: true } });
  const messages = await prisma.outboxMessage.findMany({ where: { kind: "attendance-check", payload: { path: ["rsvpId"], equals: rsvpId } } });
  const token = messages.map((message) => (message.payload as { token?: string }).token).find((raw) => raw && hashAttendanceToken(raw) === check.tokenHash);
  if (!token) throw new Error("no current attendance token queued");
  return token;
}

async function queuedFor(eventId: string) {
  const rsvpIds = (await prisma.rSVP.findMany({ where: { eventId }, select: { id: true } })).map((row) => row.id);
  if (rsvpIds.length === 0) return [];
  return prisma.outboxMessage.findMany({
    where: { kind: "attendance-check", OR: rsvpIds.map((id) => ({ payload: { path: ["rsvpId"], equals: id } })) },
  });
}

/** Move a check's last email back in time, as if the 12 hours had passed. */
async function ageCheck(rsvpId: string, ms = ATTENDANCE_REMINDER_INTERVAL_MS + 60_000) {
  await prisma.attendanceCheck.update({ where: { rsvpId }, data: { sentAt: new Date(Date.now() - ms) } });
}

beforeAll(async () => {
  orgId = (await prisma.organisation.create({ data: { name: "Attendance org", slug: orgSlug } })).id;
  otherOrgId = (await prisma.organisation.create({ data: { name: "Attendance other", slug: otherOrgSlug } })).id;
  ownerId = await makeUser("owner", MembershipRole.OWNER);
  adminId = await makeUser("admin", MembershipRole.ADMIN);
  memberId = await makeUser("member", MembershipRole.MEMBER);
  otherOwnerId = await makeUser("other-owner", MembershipRole.OWNER, otherOrgId);
});

beforeEach(() => {
  identity.id = "";
  mocks.sendAttendanceCheckEmail.mockReset();
  mocks.sendAttendanceCheckEmail.mockResolvedValue(undefined);
});

afterAll(async () => {
  await flushWebhookEmits().catch(() => undefined);
  await prisma.$executeRaw`DELETE FROM "OutboxMessage" WHERE "payload"->>'to' LIKE ${`%${suffix}@example.test`}`;
  await prisma.organisation.deleteMany({ where: { id: { in: [orgId, otherOrgId] } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
});

describe("nothing is ever sent automatically", () => {
  it("a scheduler tick creates no attendance checks and queues no question", async () => {
    const event = await makeEvent();
    await guest(event.id);
    await guest(event.id);
    // Even the day before the event, the worker never asks anyone.
    await prisma.event.update({ where: { id: event.id }, data: { startDateTime: new Date(Date.now() + 24 * 3_600_000) } });
    await runOutboxScheduler();
    await runOutboxScheduler();
    expect(await prisma.attendanceCheck.count({ where: { eventId: event.id } })).toBe(0);
    expect(await queuedFor(event.id)).toHaveLength(0);
    expect(mocks.sendAttendanceCheckEmail).not.toHaveBeenCalled();
  });

  it("previewing a send is read-only", async () => {
    const event = await makeEvent();
    await guest(event.id);
    const preview = await previewAttendanceCheckSendForUser(ownerId, ref(event));
    expect(preview).toEqual({ ok: true, data: { count: 1, firstSend: true, eventStart: event.startDateTime.toISOString() } });
    expect(await prisma.attendanceCheck.count({ where: { eventId: event.id } })).toBe(0);
    expect(await queuedFor(event.id)).toHaveLength(0);
  });
});

describe("who is asked", () => {
  it("asks only CONFIRMED registrations of this event, one email each", async () => {
    const event = await makeEvent();
    const other = await makeEvent();
    const confirmed = [await guest(event.id), await guest(event.id)];
    const user = await prisma.rSVP.create({ data: { eventId: event.id, userId: memberId, attendeeKey: `user:${memberId}`, status: RsvpStatus.CONFIRMED } });
    for (const status of [RsvpStatus.WAITLISTED, RsvpStatus.PENDING_APPROVAL, RsvpStatus.REJECTED]) await guest(event.id, status);
    await guest(other.id);

    const sent = await sendAttendanceChecksForUser(ownerId, ref(event));
    expect(sent).toEqual({ ok: true, data: { queued: 3 } });

    const checks = await prisma.attendanceCheck.findMany({ where: { eventId: event.id } });
    expect(checks.map((check) => check.rsvpId).sort()).toEqual([...confirmed.map((r) => r.id), user.id].sort());
    expect(checks.every((check) => check.response === null && /^[0-9a-f]{64}$/.test(check.tokenHash))).toBe(true);
    expect(await prisma.attendanceCheck.count({ where: { eventId: other.id } })).toBe(0);

    const queued = await queuedFor(event.id);
    expect(queued).toHaveLength(3);
    // A member's email comes from their account; payloads carry only the capability fields.
    const memberEmail = (await prisma.user.findUniqueOrThrow({ where: { id: memberId } })).email;
    expect(queued.map((message) => (message.payload as { to: string }).to)).toContain(memberEmail);
    for (const message of queued) expect(Object.keys(message.payload as object).sort()).toEqual(["rsvpId", "to", "token"]);

    const audit = await prisma.auditEvent.findFirst({ where: { action: ATTENDANCE_AUDIT.sent, targetId: event.id } });
    expect(audit).toMatchObject({ actorUserId: ownerId, organisationId: orgId, targetType: "Event", metadata: { recipientCount: 3, firstSend: true } });
  });

  it("asks each member of a team individually", async () => {
    const event = await makeEvent({ registrationMode: RegistrationMode.TEAM });
    const leader = await submitRsvpCore(
      { orgSlug, eventSlug: event.slug, guestEmail: `leader-${suffix}@example.test`, name: "Team Leader", answers: {} },
      { userId: null, team: { mode: "create", name: `Crew ${suffix}` } },
    );
    expect(leader.ok).toBe(true);
    const team = await prisma.team.findFirstOrThrow({ where: { eventId: event.id } });
    const joined = await submitRsvpCore(
      { orgSlug, eventSlug: event.slug, guestEmail: `member-${suffix}@example.test`, name: "Team Member", answers: {} },
      { userId: null, team: { mode: "join", joinToken: team.joinToken } },
    );
    expect(joined.ok).toBe(true);
    expect(await sendAttendanceChecksForUser(ownerId, ref(event))).toEqual({ ok: true, data: { queued: 2 } });
  });

  it("skips series occurrences by construction (Event rows only)", async () => {
    const series = await prisma.eventSeries.create({
      data: { organisationId: orgId, title: "Weekly", slug: `weekly-${suffix}`, recurrenceRule: "FREQ=WEEKLY;COUNT=2", timezone: "UTC", privacyType: EventPrivacyType.PUBLIC },
    });
    const instance = await prisma.eventInstance.create({ data: { eventSeriesId: series.id, startDateTime: FUTURE_START, endDateTime: FUTURE_END } });
    await prisma.rSVP.create({ data: { eventInstanceId: instance.id, attendeeKey: `guest:series-${suffix}`, guestEmail: `series-${suffix}@example.test`, status: RsvpStatus.CONFIRMED } });
    // A series id is not an event id: the send cannot reach it.
    expect(await sendAttendanceChecksForUser(ownerId, { organisationSlug: orgSlug, eventId: series.id })).toEqual({ ok: false, error: "Event not found." });
    expect(await sendAttendanceChecksForUser(ownerId, { organisationSlug: orgSlug, eventId: instance.id })).toEqual({ ok: false, error: "Event not found." });
    expect(await prisma.attendanceCheck.count({ where: { rsvp: { eventInstanceId: instance.id } } })).toBe(0);
  });
});

describe("sending is idempotent", () => {
  it("never asks anyone twice, even when two organisers send at once", async () => {
    const event = await makeEvent();
    for (let i = 0; i < 6; i += 1) await guest(event.id);
    const [a, b] = await Promise.all([sendAttendanceChecksForUser(ownerId, ref(event)), sendAttendanceChecksForUser(adminId, ref(event))]);
    const queued = [a, b].reduce((sum, result) => sum + (result.ok ? result.data?.queued ?? 0 : 0), 0);
    expect(queued).toBe(6);
    expect([a, b].filter((result) => !result.ok)).toEqual([{ ok: false, error: "Every confirmed guest has already been asked." }]);
    expect(await prisma.attendanceCheck.count({ where: { eventId: event.id } })).toBe(6);
    expect(await queuedFor(event.id)).toHaveLength(6);
  });

  it("a repeat send asks only guests confirmed since, and says so when there is no one", async () => {
    const event = await makeEvent();
    const first = await guest(event.id);
    expect(await sendAttendanceChecksForUser(ownerId, ref(event))).toEqual({ ok: true, data: { queued: 1 } });
    expect(await sendAttendanceChecksForUser(ownerId, ref(event))).toEqual({ ok: false, error: "Every confirmed guest has already been asked." });

    const waitlisted = await guest(event.id, RsvpStatus.WAITLISTED);
    const later = await guest(event.id);
    await prisma.rSVP.update({ where: { id: waitlisted.id }, data: { status: RsvpStatus.CONFIRMED } });
    const preview = await previewAttendanceCheckSendForUser(ownerId, ref(event));
    expect(preview).toMatchObject({ ok: true, data: { count: 2, firstSend: false } });
    expect(await sendAttendanceChecksForUser(adminId, ref(event))).toEqual({ ok: true, data: { queued: 2 } });

    const checks = await prisma.attendanceCheck.findMany({ where: { eventId: event.id }, select: { rsvpId: true } });
    expect(checks.map((check) => check.rsvpId).sort()).toEqual([first.id, waitlisted.id, later.id].sort());
    // The first guest still has exactly one queued question.
    expect((await queuedFor(event.id)).filter((m) => (m.payload as { rsvpId: string }).rsvpId === first.id)).toHaveLength(1);
    const lastAudit = await prisma.auditEvent.findFirst({ where: { action: ATTENDANCE_AUDIT.sent, targetId: event.id }, orderBy: { createdAt: "desc" } });
    expect(lastAudit?.metadata).toEqual({ recipientCount: 2, firstSend: false });
  });
});

describe("when sending is refused", () => {
  it("refuses after the event starts and for a cancelled event", async () => {
    const started = await makeEvent({ start: new Date(Date.now() - 60_000) });
    await guest(started.id);
    expect(await sendAttendanceChecksForUser(ownerId, ref(started))).toEqual({ ok: false, error: "This event has started, so guests can no longer be asked." });
    expect(await previewAttendanceCheckSendForUser(ownerId, ref(started))).toMatchObject({ ok: false });
    expect(await remindAttendanceChecksForUser(ownerId, ref(started))).toMatchObject({ ok: false });

    const cancelled = await makeEvent({ status: EventStatus.CANCELLED });
    await guest(cancelled.id);
    expect(await sendAttendanceChecksForUser(ownerId, ref(cancelled))).toEqual({ ok: false, error: "This event is cancelled, so guests cannot be asked." });
    expect(await previewAttendanceCheckSendForUser(ownerId, ref(cancelled))).toEqual({ ok: false, error: "This event is cancelled, so guests cannot be asked." });
    expect(await prisma.attendanceCheck.count({ where: { eventId: { in: [started.id, cancelled.id] } } })).toBe(0);
  });

  it("refuses signed-out callers and malformed input", async () => {
    const event = await makeEvent();
    await guest(event.id);
    expect(await sendAttendanceChecksForUser(null, ref(event))).toEqual({ ok: false, error: "You must be signed in." });
    expect(await sendAttendanceChecksForUser(ownerId, { ...ref(event), extra: 1 })).toEqual({ ok: false, error: "Invalid request." });
    identity.id = "";
    expect(await sendAttendanceChecks(ref(event))).toEqual({ ok: false, error: "You must be signed in." });
    expect(await prisma.attendanceCheck.count({ where: { eventId: event.id } })).toBe(0);
  });
});

describe("send permission mirrors broadcasts: organisation owners and admins only", () => {
  let event: Event;
  const collaborators = new Map<string, string>();
  const grants: EventPermission[][] = [...Object.values(EventPermission).map((permission) => [permission]), Object.values(EventPermission)];

  beforeAll(async () => {
    event = await makeEvent();
    await guest(event.id);
    for (const grant of grants) {
      const name = grant.length > 1 ? "all" : grant[0]!.toLowerCase().replace(/_/g, "-");
      const userId = await makeUser(`collab-${name}`);
      await prisma.eventCollaborator.create({ data: { eventId: event.id, userId, permissions: grant } });
      collaborators.set(grant.length > 1 ? "all grants" : grant[0]!, userId);
    }
  });

  it.each(["MEMBER", "other organisation's owner"])("refuses a %s", async (who) => {
    const userId = who === "MEMBER" ? memberId : otherOwnerId;
    const error = { ok: false, error: "You do not have permission to email attendees." };
    expect(await previewAttendanceCheckSendForUser(userId, ref(event))).toEqual(error);
    expect(await sendAttendanceChecksForUser(userId, ref(event))).toEqual(error);
    expect(await remindAttendanceChecksForUser(userId, ref(event))).toEqual(error);
    expect(await setAttendanceReleaseOnDeclineForUser(userId, { ...ref(event), releaseOnDecline: true })).toEqual(error);
  });

  it("refuses every collaborator grant, JUDGE included", async () => {
    expect(collaborators.has(EventPermission.JUDGE)).toBe(true);
    for (const [grant, userId] of collaborators) {
      const error = { ok: false, error: "You do not have permission to email attendees." };
      expect(await sendAttendanceChecksForUser(userId, ref(event)), grant).toEqual(error);
      expect(await remindAttendanceChecksForUser(userId, ref(event)), grant).toEqual(error);
      expect(await setAttendanceReleaseOnDeclineForUser(userId, { ...ref(event), releaseOnDecline: true }), grant).toEqual(error);
    }
    expect(await prisma.attendanceCheck.count({ where: { eventId: event.id } })).toBe(0);
    expect((await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).attendanceCheckReleaseOnDecline).toBe(false);
  });

  it("refuses an event of another organisation under this organisation's slug", async () => {
    const foreign = await makeEvent({ organisationId: otherOrgId });
    await guest(foreign.id);
    expect(await sendAttendanceChecksForUser(ownerId, { organisationSlug: orgSlug, eventId: foreign.id })).toEqual({ ok: false, error: "Event not found." });
    expect(await sendAttendanceChecksForUser(ownerId, ref(foreign))).toEqual({ ok: false, error: "You do not have permission to email attendees." });
    expect(await prisma.attendanceCheck.count({ where: { eventId: foreign.id } })).toBe(0);
  });

  it("allows the owner (through the Server Action) and an admin", async () => {
    identity.id = ownerId;
    expect(await sendAttendanceChecks(ref(event))).toEqual({ ok: true, data: { queued: 1 } });
    await guest(event.id);
    expect(await sendAttendanceChecksForUser(adminId, ref(event))).toEqual({ ok: true, data: { queued: 1 } });
  });

  it("audits the release-on-decline switch only when it changes", async () => {
    expect(await setAttendanceReleaseOnDeclineForUser(adminId, { ...ref(event), releaseOnDecline: true })).toEqual({ ok: true, data: { releaseOnDecline: true } });
    expect(await setAttendanceReleaseOnDeclineForUser(adminId, { ...ref(event), releaseOnDecline: true })).toEqual({ ok: true, data: { releaseOnDecline: true } });
    const audits = await prisma.auditEvent.findMany({ where: { action: ATTENDANCE_AUDIT.settings, targetId: event.id } });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ actorUserId: adminId, metadata: { releaseOnDecline: true } });
  });
});

describe("reminders", () => {
  it("reach only no-reply, still-confirmed guests, at most once per 12 hours, and rotate the link", async () => {
    const event = await makeEvent();
    const silent = await guest(event.id);
    const answered = await guest(event.id);
    const dropped = await guest(event.id);
    expect(await sendAttendanceChecksForUser(ownerId, ref(event))).toEqual({ ok: true, data: { queued: 3 } });
    const answeredToken = await tokenFor(answered.id);
    expect(await respondToAttendanceCheck({ token: answeredToken, response: "ATTENDING" })).toMatchObject({ ok: true });

    // Too soon: nobody is due.
    expect(await remindAttendanceChecksForUser(ownerId, ref(event))).toEqual({ ok: false, error: "No one is due a reminder. Each guest can be reminded once every 12 hours." });

    for (const rsvp of [silent, answered, dropped]) await ageCheck(rsvp.id);
    await prisma.rSVP.update({ where: { id: dropped.id }, data: { status: RsvpStatus.WAITLISTED } });
    const oldToken = await tokenFor(silent.id);

    expect(await remindAttendanceChecksForUser(adminId, ref(event))).toEqual({ ok: true, data: { queued: 1 } });
    const newToken = await tokenFor(silent.id);
    expect(newToken).not.toBe(oldToken);
    expect(await resolveAttendanceCheckByToken(oldToken)).toBeNull();
    expect(await resolveAttendanceCheckByToken(newToken)).toMatchObject({ response: null, closed: null });
    const reminders = (await queuedFor(event.id)).filter((m) => (m.payload as { reminder?: boolean }).reminder === true);
    expect(reminders.map((m) => (m.payload as { rsvpId: string }).rsvpId)).toEqual([silent.id]);

    // Just reminded, so not again.
    expect(await remindAttendanceChecksForUser(ownerId, ref(event))).toMatchObject({ ok: false });
    expect(await prisma.auditEvent.findFirst({ where: { action: ATTENDANCE_AUDIT.reminded, targetId: event.id } })).toMatchObject({ actorUserId: adminId, metadata: { recipientCount: 1 } });

    const status = await loadAttendanceCheckStatus(await prisma.event.findUniqueOrThrow({ where: { id: event.id } }));
    expect(status).toMatchObject({ coming: 1, notComing: 0, noReply: 1, notAsked: 0, remindable: 0, released: 0 });
    expect(status.lastSent).toMatchObject({ recipientCount: 1 });
  });
});

describe("the guest's reply", () => {
  it("shows only the guest's own details and records Yes, then a change to No, until the start", async () => {
    const event = await makeEvent();
    const rsvp = await guest(event.id);
    await guest(event.id);
    await sendAttendanceChecksForUser(ownerId, ref(event));
    const token = await tokenFor(rsvp.id);

    const view = await resolveAttendanceCheckByToken(token);
    expect(view).toMatchObject({
      eventTitle: event.title,
      organisationName: "Attendance org",
      timezone: "Europe/London",
      location: "Main hall",
      attendeeName: rsvp.guestName,
      attendeeEmail: rsvp.guestEmail,
      response: null,
      closed: null,
      releaseOnDecline: false,
    });
    const serialised = JSON.stringify(view);
    expect(serialised).not.toContain(rsvp.checkInToken);
    expect(serialised).not.toContain(rsvp.id);

    identity.id = "";
    expect(await submitAttendanceReply({ token, response: "ATTENDING" })).toEqual({ ok: true, data: { response: "ATTENDING", released: false } });
    expect(await submitAttendanceReply({ token, response: "NOT_ATTENDING", note: "  Train strike\u0007 " })).toEqual({ ok: true, data: { response: "NOT_ATTENDING", released: false } });
    const check = await prisma.attendanceCheck.findUniqueOrThrow({ where: { rsvpId: rsvp.id } });
    expect(check).toMatchObject({ response: AttendanceResponse.NOT_ATTENDING, note: "Train strike" });
    expect(check.respondedAt).toBeInstanceOf(Date);
    // Without release the place is kept.
    expect((await prisma.rSVP.findUniqueOrThrow({ where: { id: rsvp.id } })).status).toBe(RsvpStatus.CONFIRMED);

    expect(await submitAttendanceReply({ token, response: "ATTENDING", note: "x".repeat(501) })).toEqual({ ok: false, error: "Keep the note to 500 characters or fewer." });
    expect(await submitAttendanceReply({ token, response: "MAYBE" })).toEqual({ ok: false, error: "Choose Yes or No." });
  });

  it("isolates tokens: unknown, malformed and other events' links reveal nothing", async () => {
    const eventA = await makeEvent();
    const eventB = await makeEvent();
    const a = await guest(eventA.id);
    const b = await guest(eventB.id);
    await sendAttendanceChecksForUser(ownerId, ref(eventA));
    await sendAttendanceChecksForUser(ownerId, ref(eventB));
    const tokenA = await tokenFor(a.id);
    const tokenB = await tokenFor(b.id);
    expect(tokenA).not.toBe(tokenB);
    expect((await resolveAttendanceCheckByToken(tokenA))?.attendeeEmail).toBe(a.guestEmail);
    expect((await resolveAttendanceCheckByToken(tokenB))?.eventTitle).toBe(eventB.title);

    expect(await resolveAttendanceCheckByToken(generateAttendanceToken().raw)).toBeNull();
    expect(await resolveAttendanceCheckByToken("short")).toBeNull();
    expect(await resolveAttendanceCheckByToken(hashAttendanceToken(tokenA))).toBeNull();
    expect(await respondToAttendanceCheck({ token: generateAttendanceToken().raw, response: "ATTENDING" })).toEqual({ ok: false, error: "This link is no longer valid." });

    await respondToAttendanceCheck({ token: tokenA, response: "NOT_ATTENDING" });
    expect((await prisma.attendanceCheck.findUniqueOrThrow({ where: { rsvpId: b.id } })).response).toBeNull();
  });

  it("closes after the start, when no longer confirmed, and when the event is cancelled", async () => {
    const event = await makeEvent();
    const late = await guest(event.id);
    const moved = await guest(event.id);
    await sendAttendanceChecksForUser(ownerId, ref(event));
    const lateToken = await tokenFor(late.id);
    const movedToken = await tokenFor(moved.id);

    await prisma.rSVP.update({ where: { id: moved.id }, data: { status: RsvpStatus.WAITLISTED } });
    expect((await resolveAttendanceCheckByToken(movedToken))?.closed).toBe("notConfirmed");
    expect(await respondToAttendanceCheck({ token: movedToken, response: "ATTENDING" })).toEqual({ ok: false, error: "Your registration is no longer confirmed, so there is nothing to answer." });

    await prisma.event.update({ where: { id: event.id }, data: { status: EventStatus.CANCELLED } });
    expect((await resolveAttendanceCheckByToken(lateToken))?.closed).toBe("cancelled");
    expect(await respondToAttendanceCheck({ token: lateToken, response: "ATTENDING" })).toEqual({ ok: false, error: "This event has been cancelled, so answers are closed." });

    await prisma.event.update({ where: { id: event.id }, data: { status: EventStatus.PUBLISHED, startDateTime: new Date(Date.now() - 60_000) } });
    expect((await resolveAttendanceCheckByToken(lateToken))?.closed).toBe("started");
    expect(await respondToAttendanceCheck({ token: lateToken, response: "ATTENDING" })).toEqual({ ok: false, error: "The event has started, so answers are closed." });
    expect(await prisma.attendanceCheck.count({ where: { eventId: event.id, response: { not: null } } })).toBe(0);
  });
});

describe("declining with release", () => {
  it("cancels through the self-cancel core and promotes the waitlist", async () => {
    const event = await makeEvent({ capacity: 1, releaseOnDecline: true });
    const decliner = await guest(event.id);
    const waiting = await guest(event.id, RsvpStatus.WAITLISTED);
    await sendAttendanceChecksForUser(ownerId, ref(event));
    const token = await tokenFor(decliner.id);
    expect((await resolveAttendanceCheckByToken(token))?.releaseOnDecline).toBe(true);

    vi.mocked(revalidatePath).mockClear();
    expect(await respondToAttendanceCheck({ token, response: "NOT_ATTENDING", note: "Sorry" })).toEqual({ ok: true, data: { response: "NOT_ATTENDING", released: true } });
    // Regression: a revalidation inside the reply's Server Action re-renders
    // /attend/:token, now a 404, over the "Your place has been released" screen.
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(await prisma.rSVP.findUnique({ where: { id: decliner.id } })).toBeNull();
    // The check cascades with the registration, so the link is now a 404.
    expect(await prisma.attendanceCheck.findUnique({ where: { rsvpId: decliner.id } })).toBeNull();
    expect(await resolveAttendanceCheckByToken(token)).toBeNull();
    expect((await prisma.rSVP.findUniqueOrThrow({ where: { id: waiting.id } })).status).toBe(RsvpStatus.CONFIRMED);
    expect(await prisma.auditEvent.findFirst({ where: { action: ATTENDANCE_AUDIT.released, targetId: event.id } })).toMatchObject({ metadata: { rsvpId: decliner.id } });

    const status = await loadAttendanceCheckStatus(await prisma.event.findUniqueOrThrow({ where: { id: event.id } }));
    expect(status).toMatchObject({ released: 1, notAsked: 1, asked: 0, releaseOnDecline: true });
    // The promoted guest is "newly confirmed" and can be asked.
    expect(await sendAttendanceChecksForUser(ownerId, ref(event))).toEqual({ ok: true, data: { queued: 1 } });
  });

  it("leaves revalidation on for every other self-cancel", async () => {
    const event = await makeEvent();
    const rsvp = await guest(event.id);
    vi.mocked(revalidatePath).mockClear();
    expect(await cancelRsvpForUser(null, { checkInToken: rsvp.checkInToken })).toMatchObject({ ok: true });
    expect(revalidatePath).toHaveBeenCalledWith(`/${orgSlug}/${event.slug}`);
  });

  it("hands team leadership to the next member", async () => {
    const event = await makeEvent({ registrationMode: RegistrationMode.TEAM, releaseOnDecline: true });
    const created = await submitRsvpCore(
      { orgSlug, eventSlug: event.slug, guestEmail: `lead-${suffix}@example.test`, name: "Leader", answers: {} },
      { userId: null, team: { mode: "create", name: `Leaders ${suffix}` } },
    );
    if (!created.ok || !created.data) throw new Error("team registration failed");
    const team = await prisma.team.findFirstOrThrow({ where: { eventId: event.id } });
    const joined = await submitRsvpCore(
      { orgSlug, eventSlug: event.slug, guestEmail: `next-${suffix}@example.test`, name: "Next", answers: {} },
      { userId: null, team: { mode: "join", joinToken: team.joinToken } },
    );
    if (!joined.ok || !joined.data) throw new Error("team join failed");
    const leaderRsvp = await prisma.rSVP.findUniqueOrThrow({ where: { checkInToken: created.data.ticketToken } });
    const memberRsvp = await prisma.rSVP.findUniqueOrThrow({ where: { checkInToken: joined.data.ticketToken } });
    expect(team.leaderRsvpId).toBe(leaderRsvp.id);

    await sendAttendanceChecksForUser(ownerId, ref(event));
    const token = await tokenFor(leaderRsvp.id);
    expect(await respondToAttendanceCheck({ token, response: "NOT_ATTENDING" })).toEqual({ ok: true, data: { response: "NOT_ATTENDING", released: true } });

    const after = await prisma.team.findUniqueOrThrow({ where: { id: team.id } });
    expect(after.leaderRsvpId).toBe(memberRsvp.id);
    expect((await prisma.rSVP.findUniqueOrThrow({ where: { id: memberRsvp.id } })).status).toBe(RsvpStatus.CONFIRMED);
    // The remaining member's own question is untouched.
    expect(await prisma.attendanceCheck.findUnique({ where: { rsvpId: memberRsvp.id } })).toMatchObject({ response: null });
  });

  it("keeps the place of a guest who is already checked in, but records the answer", async () => {
    const event = await makeEvent({ releaseOnDecline: true });
    const here = await guest(event.id, RsvpStatus.CONFIRMED, { checkedInAt: new Date() });
    await sendAttendanceChecksForUser(ownerId, ref(event));
    const result = await respondToAttendanceCheck({ token: await tokenFor(here.id), response: "NOT_ATTENDING" });
    expect(result).toMatchObject({ ok: true, data: { response: "NOT_ATTENDING", released: false } });
    expect(result.ok && result.data?.releaseFailed).toBeTruthy();
    expect((await prisma.rSVP.findUniqueOrThrow({ where: { id: here.id } })).status).toBe(RsvpStatus.CONFIRMED);
    expect((await prisma.attendanceCheck.findUniqueOrThrow({ where: { rsvpId: here.id } })).response).toBe(AttendanceResponse.NOT_ATTENDING);
  });

  it("a Yes never releases, even with release on", async () => {
    const event = await makeEvent({ releaseOnDecline: true });
    const rsvp = await guest(event.id);
    await sendAttendanceChecksForUser(ownerId, ref(event));
    expect(await respondToAttendanceCheck({ token: await tokenFor(rsvp.id), response: "ATTENDING" })).toEqual({ ok: true, data: { response: "ATTENDING", released: false } });
    expect(await prisma.rSVP.findUnique({ where: { id: rsvp.id } })).not.toBeNull();
  });
});

describe("outbox delivery", () => {
  beforeEach(async () => {
    // Start from an empty attendance queue: earlier tests left their questions queued.
    await prisma.$executeRaw`DELETE FROM "OutboxMessage" WHERE "kind" = 'attendance-check' AND "payload"->>'to' LIKE ${`%${suffix}@example.test`}`;
  });

  it("sends the current question once, then deletes the capability row", async () => {
    const event = await makeEvent();
    const rsvp = await guest(event.id);
    await sendAttendanceChecksForUser(ownerId, ref(event));
    const token = await tokenFor(rsvp.id);
    await deliverOutboxBatch(50);
    expect(mocks.sendAttendanceCheckEmail).toHaveBeenCalledTimes(1);
    expect(mocks.sendAttendanceCheckEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: rsvp.guestEmail,
      eventTitle: event.title,
      timezone: "Europe/London",
      location: "Main hall",
      attendPath: `/attend/${token}`,
      reminder: false,
    }));
    expect(await queuedFor(event.id)).toHaveLength(0);
  });

  it("drops a rotated, answered or cancelled-event question without sending it", async () => {
    const event = await makeEvent();
    const rotated = await guest(event.id);
    const answered = await guest(event.id);
    await sendAttendanceChecksForUser(ownerId, ref(event));
    await respondToAttendanceCheck({ token: await tokenFor(answered.id), response: "ATTENDING" });
    // Simulate a reminder having rotated the link after this email was queued.
    await prisma.attendanceCheck.update({ where: { rsvpId: rotated.id }, data: { tokenHash: generateAttendanceToken().hash } });
    await deliverOutboxBatch(50);
    expect(mocks.sendAttendanceCheckEmail).not.toHaveBeenCalled();
    expect(await queuedFor(event.id)).toHaveLength(0);

    const cancelled = await makeEvent();
    await guest(cancelled.id);
    await sendAttendanceChecksForUser(ownerId, ref(cancelled));
    await prisma.event.update({ where: { id: cancelled.id }, data: { status: EventStatus.CANCELLED } });
    await deliverOutboxBatch(50);
    expect(mocks.sendAttendanceCheckEmail).not.toHaveBeenCalled();
    expect(await queuedFor(cancelled.id)).toHaveLength(0);
  });

  it("expires the question once the event has started", async () => {
    const event = await makeEvent();
    await guest(event.id);
    await sendAttendanceChecksForUser(ownerId, ref(event));
    await prisma.event.update({ where: { id: event.id }, data: { startDateTime: new Date(Date.now() - 60_000) } });
    const result = await deliverOutboxBatch(50);
    expect(result.failed).toBeGreaterThanOrEqual(1);
    expect(mocks.sendAttendanceCheckEmail).not.toHaveBeenCalled();
    expect(await queuedFor(event.id)).toHaveLength(0);
  });
});

describe("sharing one guest's link by hand", () => {
  beforeEach(async () => {
    await prisma.$executeRaw`DELETE FROM "OutboxMessage" WHERE "kind" = 'attendance-check' AND "payload"->>'to' LIKE ${`%${suffix}@example.test`}`;
  });

  const tokenOf = (path: string) => path.replace(/^\/attend\//, "");

  it("asks a guest not yet asked without emailing them, so a later send skips them", async () => {
    const event = await makeEvent();
    const shared = await guest(event.id);
    const other = await guest(event.id);
    const result = await issueAttendanceLinkForUser(ownerId, { ...ref(event), rsvpId: shared.id });
    expect(result).toMatchObject({ ok: true, data: { replaced: false } });
    const path = result.ok ? result.data!.path : "";
    expect(path).toMatch(/^\/attend\/[A-Za-z0-9_-]{43}$/);
    expect(await queuedFor(event.id)).toHaveLength(0);
    expect(await resolveAttendanceCheckByToken(tokenOf(path))).toMatchObject({ attendeeEmail: shared.guestEmail, response: null, closed: null });

    // The bulk send now asks only the other guest.
    expect(await sendAttendanceChecksForUser(ownerId, ref(event))).toEqual({ ok: true, data: { queued: 1 } });
    expect((await queuedFor(event.id)).map((message) => (message.payload as { rsvpId: string }).rsvpId)).toEqual([other.id]);
    const status = await loadAttendanceCheckStatus(await prisma.event.findUniqueOrThrow({ where: { id: event.id } }));
    expect(status).toMatchObject({ asked: 2, noReply: 2, notAsked: 0, remindable: 0 });

    // The link works like the emailed one.
    expect(await respondToAttendanceCheck({ token: tokenOf(path), response: "ATTENDING" })).toMatchObject({ ok: true });
  });

  it("replaces an emailed link, which stops working and is not delivered", async () => {
    const event = await makeEvent();
    const rsvp = await guest(event.id);
    await sendAttendanceChecksForUser(ownerId, ref(event));
    const emailed = await tokenFor(rsvp.id);
    const result = await issueAttendanceLinkForUser(adminId, { ...ref(event), rsvpId: rsvp.id });
    expect(result).toMatchObject({ ok: true, data: { replaced: true } });
    expect(await resolveAttendanceCheckByToken(emailed)).toBeNull();
    expect(await resolveAttendanceCheckByToken(tokenOf(result.ok ? result.data!.path : ""))).not.toBeNull();
    await deliverOutboxBatch(50);
    expect(mocks.sendAttendanceCheckEmail).not.toHaveBeenCalled();

    // A guest who already answered can get a fresh link to change it.
    await respondToAttendanceCheck({ token: tokenOf(result.ok ? result.data!.path : ""), response: "NOT_ATTENDING" });
    const again = await issueAttendanceLinkForUser(ownerId, { ...ref(event), rsvpId: rsvp.id });
    expect(again).toMatchObject({ ok: true, data: { replaced: true } });
    expect(await resolveAttendanceCheckByToken(tokenOf(again.ok ? again.data!.path : ""))).toMatchObject({ response: "NOT_ATTENDING" });
  });

  it("audits the link without the token, and the Server Action returns an absolute link", async () => {
    const event = await makeEvent();
    const rsvp = await guest(event.id);
    identity.id = ownerId;
    const result = await issueAttendanceLink({ ...ref(event), rsvpId: rsvp.id });
    expect(result).toMatchObject({ ok: true, data: { replaced: false } });
    const url = result.ok ? result.data!.url : "";
    expect(url).toMatch(/^https:\/\/yuyu\.example\.test\/attend\/[A-Za-z0-9_-]{43}$/);
    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { action: ATTENDANCE_AUDIT.linkShared, targetId: event.id } });
    expect(audit).toMatchObject({ actorUserId: ownerId, organisationId: orgId, metadata: { rsvpId: rsvp.id, replaced: false } });
    expect(JSON.stringify(audit)).not.toContain(url.split("/attend/")[1]);
    // The Emails card's "last sent" line counts emails only.
    expect((await loadAttendanceCheckStatus(await prisma.event.findUniqueOrThrow({ where: { id: event.id } }))).lastSent).toBeNull();
  });

  it("refuses anyone who may not email guests, and every collaborator grant", async () => {
    const event = await makeEvent();
    const rsvp = await guest(event.id);
    const error = { ok: false, error: "You do not have permission to email attendees." };
    expect(await issueAttendanceLinkForUser(memberId, { ...ref(event), rsvpId: rsvp.id })).toEqual(error);
    expect(await issueAttendanceLinkForUser(otherOwnerId, { ...ref(event), rsvpId: rsvp.id })).toEqual(error);
    const collaborator = await makeUser(`link-collab-${randomUUID().slice(0, 8)}`);
    await prisma.eventCollaborator.create({ data: { eventId: event.id, userId: collaborator, permissions: Object.values(EventPermission) } });
    expect(await issueAttendanceLinkForUser(collaborator, { ...ref(event), rsvpId: rsvp.id })).toEqual(error);
    expect(await issueAttendanceLinkForUser(null, { ...ref(event), rsvpId: rsvp.id })).toEqual({ ok: false, error: "You must be signed in." });
    expect(await issueAttendanceLinkForUser(ownerId, { ...ref(event), rsvpId: rsvp.id, extra: 1 })).toEqual({ ok: false, error: "Invalid request." });
    expect(await prisma.attendanceCheck.count({ where: { eventId: event.id } })).toBe(0);
  });

  it("refuses other events' guests, guests without a confirmed place, crew, and closed events", async () => {
    const event = await makeEvent();
    const elsewhere = await makeEvent();
    const foreignGuest = await guest(elsewhere.id);
    expect(await issueAttendanceLinkForUser(ownerId, { ...ref(event), rsvpId: foreignGuest.id })).toEqual({ ok: false, error: "Guest not found." });
    const foreignOrg = await makeEvent({ organisationId: otherOrgId });
    const foreignOrgGuest = await guest(foreignOrg.id);
    expect(await issueAttendanceLinkForUser(ownerId, { organisationSlug: orgSlug, eventId: foreignOrg.id, rsvpId: foreignOrgGuest.id })).toEqual({ ok: false, error: "Event not found." });

    const notConfirmed = { ok: false, error: "Only confirmed guests can be asked to confirm attendance." };
    for (const status of [RsvpStatus.WAITLISTED, RsvpStatus.PENDING_APPROVAL, RsvpStatus.REJECTED]) {
      const rsvp = await guest(event.id, status);
      expect(await issueAttendanceLinkForUser(ownerId, { ...ref(event), rsvpId: rsvp.id }), status).toEqual(notConfirmed);
    }
    expect((await addCrewMemberAsOrganiser({ organisationId: orgId, eventId: event.id, actorUserId: ownerId }, { name: "Link Crew", email: `link-crew-${suffix}@example.test` })).ok).toBe(true);
    const crewRsvp = await prisma.rSVP.findFirstOrThrow({ where: { eventId: event.id, isCrew: true } });
    expect(await issueAttendanceLinkForUser(ownerId, { ...ref(event), rsvpId: crewRsvp.id })).toEqual(notConfirmed);

    const started = await makeEvent({ start: new Date(Date.now() - 60_000) });
    const startedGuest = await guest(started.id);
    expect(await issueAttendanceLinkForUser(ownerId, { ...ref(started), rsvpId: startedGuest.id })).toEqual({ ok: false, error: "This event has started, so guests can no longer be asked." });
    const cancelled = await makeEvent({ status: EventStatus.CANCELLED });
    const cancelledGuest = await guest(cancelled.id);
    expect(await issueAttendanceLinkForUser(ownerId, { ...ref(cancelled), rsvpId: cancelledGuest.id })).toEqual({ ok: false, error: "This event is cancelled, so guests cannot be asked." });
    expect(await prisma.attendanceCheck.count({ where: { eventId: { in: [event.id, elsewhere.id, foreignOrg.id, started.id, cancelled.id] } } })).toBe(0);
  });
});

describe("retention", () => {
  it("removes the check with its registration and its event", async () => {
    const event = await makeEvent();
    const rsvp = await guest(event.id);
    await guest(event.id);
    await sendAttendanceChecksForUser(ownerId, ref(event));
    await prisma.rSVP.delete({ where: { id: rsvp.id } });
    expect(await prisma.attendanceCheck.count({ where: { rsvpId: rsvp.id } })).toBe(0);
    await prisma.event.delete({ where: { id: event.id } });
    expect(await prisma.attendanceCheck.count({ where: { eventId: event.id } })).toBe(0);
  });

  it("enforces the database invariants", async () => {
    const event = await makeEvent();
    const rsvp = await guest(event.id);
    await expect(prisma.attendanceCheck.create({ data: { rsvpId: rsvp.id, eventId: event.id, tokenHash: "not-hex", sentAt: new Date() } })).rejects.toThrow();
    await expect(prisma.attendanceCheck.create({ data: { rsvpId: rsvp.id, eventId: event.id, tokenHash: generateAttendanceToken().hash, sentAt: new Date(), response: AttendanceResponse.ATTENDING } })).rejects.toThrow();
    await expect(prisma.attendanceCheck.create({ data: { rsvpId: rsvp.id, eventId: event.id, tokenHash: generateAttendanceToken().hash, sentAt: new Date(), note: "x".repeat(501) } })).rejects.toThrow();
    expect(await prisma.attendanceCheck.count({ where: { rsvpId: rsvp.id } })).toBe(0);
  });
});

describe("event crew", () => {
  it("never asks crew, counts them nowhere, and drops a question when an asked guest becomes crew", async () => {
    const event = await makeEvent();
    const ctx = { organisationId: orgId, eventId: event.id, actorUserId: ownerId };
    const attendee = await guest(event.id);
    const later = await guest(event.id);
    const crew = await addCrewMemberAsOrganiser(ctx, { name: "Crew Lead", email: `crew-lead-${suffix}@example.test` });
    expect(crew.ok).toBe(true);
    const crewRsvp = await prisma.rSVP.findFirstOrThrow({ where: { eventId: event.id, isCrew: true } });

    // Preview and send count attendees only.
    expect(await previewAttendanceCheckSendForUser(ownerId, ref(event))).toMatchObject({ ok: true, data: { count: 2 } });
    expect(await sendAttendanceChecksForUser(ownerId, ref(event))).toEqual({ ok: true, data: { queued: 2 } });
    expect(await prisma.attendanceCheck.findUnique({ where: { rsvpId: crewRsvp.id } })).toBeNull();
    expect((await queuedFor(event.id)).map((message) => (message.payload as { rsvpId: string }).rsvpId)).not.toContain(crewRsvp.id);

    // An asked guest who then joins the crew loses the question (and its link),
    // so a later "No" can never release a crew ticket.
    const token = await tokenFor(later.id);
    expect((await addCrewMemberAsOrganiser(ctx, { name: "Promoted", email: later.guestEmail! })).ok).toBe(true);
    expect(await prisma.attendanceCheck.findUnique({ where: { rsvpId: later.id } })).toBeNull();
    expect(await resolveAttendanceCheckByToken(token)).toBeNull();

    const status = await loadAttendanceCheckStatus(await prisma.event.findUniqueOrThrow({ where: { id: event.id } }));
    expect(status).toMatchObject({ asked: 1, noReply: 1, notAsked: 0 });
    // Reminders reach the attendee only.
    await ageCheck(attendee.id);
    expect(await remindAttendanceChecksForUser(ownerId, ref(event))).toEqual({ ok: true, data: { queued: 1 } });
  });
});
