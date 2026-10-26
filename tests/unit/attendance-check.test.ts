import { beforeEach, describe, expect, it, vi } from "vitest";
import { OutboxStatus } from "@prisma/client";

/*
 * Attendance confirmation (docs/FEATURES.md): the pure rules, the link token,
 * the reply validator, the outbox payload and delivery, and the email.
 * Database behaviour is in tests/integration/attendance-check.db.test.ts.
 */

const mocks = vi.hoisted(() => ({
  updateMany: vi.fn(),
  findMany: vi.fn(),
  deleteMany: vi.fn(),
  createMany: vi.fn(),
  checkFind: vi.fn(),
  send: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    outboxMessage: { updateMany: mocks.updateMany, findMany: mocks.findMany, deleteMany: mocks.deleteMany },
    attendanceCheck: { findUnique: mocks.checkFind },
  },
}));
vi.mock("@/lib/email", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/email")>()),
  sendAttendanceCheckEmail: mocks.send,
}));
vi.mock("@/lib/email/passwordReset", () => ({ sendPasswordResetEmail: vi.fn() }));
vi.mock("@/lib/email/emailVerification", () => ({ sendEmailVerificationEmail: vi.fn() }));
vi.mock("@/lib/opsAlerts", () => ({ reportOpsAlert: vi.fn(), logOpsError: vi.fn() }));

import {
  ATTENDANCE_NOTE_MAX,
  ATTENDANCE_REMINDER_INTERVAL_MS,
  ATTENDANCE_STATE_LABELS,
  ATTENDANCE_STATES,
  attendanceCheckOpen,
  attendanceReplyClosedReason,
  attendanceSendLabel,
  attendanceStateOf,
  describeAttendanceReplies,
  isAttendanceCheckRecipient,
  isReminderDue,
  parseAnswerPreselect,
} from "@/lib/attendanceCheck";
import { attendancePath, generateAttendanceToken, hashAttendanceToken, isAttendanceTokenShape } from "@/lib/attendanceToken";
import { attendanceCheckRefSchema, attendanceCheckSettingsSchema, attendanceReplySchema } from "@/lib/validators";
import { asAttendanceCheckPayload, deliverOutboxBatch, enqueueAttendanceChecks } from "@/lib/outbox";
import { buildAttendanceCheckEmail } from "@/lib/email";

const NOW = new Date("2035-01-01T09:00:00.000Z");
const START = new Date("2035-01-01T10:00:00.000Z");
const token = "a".repeat(43);

describe("attendance link token", () => {
  it("generates 256-bit base64url tokens and stores only their SHA-256", () => {
    const { raw, hash } = generateAttendanceToken();
    expect(raw).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(hashAttendanceToken(raw));
    expect(hash).not.toContain(raw);
    expect(generateAttendanceToken().raw).not.toBe(raw);
  });

  it("hashes deterministically", () => {
    expect(hashAttendanceToken(token)).toBe(hashAttendanceToken(token));
    expect(hashAttendanceToken(token)).not.toBe(hashAttendanceToken("b".repeat(43)));
  });

  it("shape-checks before any lookup", () => {
    expect(isAttendanceTokenShape(token)).toBe(true);
    expect(isAttendanceTokenShape("a".repeat(42))).toBe(false);
    expect(isAttendanceTokenShape("a".repeat(44))).toBe(false);
    expect(isAttendanceTokenShape(`${"a".repeat(42)}/`)).toBe(false);
    expect(isAttendanceTokenShape(`${"a".repeat(42)}=`)).toBe(false);
    expect(isAttendanceTokenShape(hashAttendanceToken(token))).toBe(false);
    expect(isAttendanceTokenShape(null)).toBe(false);
    expect(isAttendanceTokenShape(123)).toBe(false);
  });

  it("builds the site-relative form path with an optional preselect", () => {
    expect(attendancePath(token)).toBe(`/attend/${token}`);
    expect(attendancePath(token, "yes")).toBe(`/attend/${token}?answer=yes`);
    expect(attendancePath(token, "no")).toBe(`/attend/${token}?answer=no`);
  });
});

describe("attendance rules", () => {
  it("asks only CONFIRMED registrations of a one-off event", () => {
    expect(isAttendanceCheckRecipient({ status: "CONFIRMED", eventId: "evt" })).toBe(true);
    for (const status of ["WAITLISTED", "PENDING_APPROVAL", "REJECTED", "CANCELLED"]) {
      expect(isAttendanceCheckRecipient({ status, eventId: "evt" }), status).toBe(false);
    }
    // A series occurrence's registration has no eventId.
    expect(isAttendanceCheckRecipient({ status: "CONFIRMED", eventId: null })).toBe(false);
  });

  it("maps a check to the guest's badge state", () => {
    expect(attendanceStateOf(null)).toBe("notAsked");
    expect(attendanceStateOf(undefined)).toBe("notAsked");
    expect(attendanceStateOf({ response: null })).toBe("noReply");
    expect(attendanceStateOf({ response: "ATTENDING" })).toBe("coming");
    expect(attendanceStateOf({ response: "NOT_ATTENDING" })).toBe("notComing");
    expect(ATTENDANCE_STATES.map((state) => ATTENDANCE_STATE_LABELS[state])).toEqual(["Coming", "Not coming", "No reply", "Not asked"]);
  });

  it("stays open strictly until the start", () => {
    expect(attendanceCheckOpen(START, NOW)).toBe(true);
    expect(attendanceCheckOpen(START, START)).toBe(false);
    expect(attendanceCheckOpen(START, new Date(START.getTime() + 1))).toBe(false);
  });

  it("allows one reminder per guest per 12 hours", () => {
    expect(ATTENDANCE_REMINDER_INTERVAL_MS).toBe(12 * 60 * 60 * 1000);
    expect(isReminderDue(new Date(NOW.getTime() - ATTENDANCE_REMINDER_INTERVAL_MS + 1), NOW)).toBe(false);
    expect(isReminderDue(new Date(NOW.getTime() - ATTENDANCE_REMINDER_INTERVAL_MS), NOW)).toBe(true);
  });

  it("explains why the reply form is closed, cancellation first", () => {
    const after = new Date(START.getTime() + 60_000);
    expect(attendanceReplyClosedReason({ rsvpStatus: "CONFIRMED", eventStart: START, eventStatus: "PUBLISHED", now: NOW })).toBeNull();
    expect(attendanceReplyClosedReason({ rsvpStatus: "CONFIRMED", eventStart: START, now: after })).toBe("started");
    expect(attendanceReplyClosedReason({ rsvpStatus: "WAITLISTED", eventStart: START, now: NOW })).toBe("notConfirmed");
    expect(attendanceReplyClosedReason({ rsvpStatus: "WAITLISTED", eventStart: START, now: after })).toBe("started");
    expect(attendanceReplyClosedReason({ rsvpStatus: "CONFIRMED", eventStart: START, eventStatus: "CANCELLED", now: after })).toBe("cancelled");
  });

  it("parses only yes and no as a preselect", () => {
    expect(parseAnswerPreselect("yes")).toBe("ATTENDING");
    expect(parseAnswerPreselect("no")).toBe("NOT_ATTENDING");
    expect(parseAnswerPreselect(["no", "yes"])).toBe("NOT_ATTENDING");
    for (const value of ["YES", "maybe", "", undefined, null, 1, ["maybe"]]) expect(parseAnswerPreselect(value)).toBeNull();
  });

  it("describes replies and the send button", () => {
    expect(describeAttendanceReplies({ coming: 12, notComing: 3, noReply: 5 })).toBe("Attendance: 12 coming · 3 not coming · 5 no reply");
    expect(attendanceSendLabel(0, true)).toBe("No confirmed guests to ask");
    expect(attendanceSendLabel(0, false)).toBe("Everyone confirmed has been asked");
    expect(attendanceSendLabel(1, true)).toBe("Ask 1 guest to confirm");
    expect(attendanceSendLabel(4, false)).toBe("Ask 4 guests newly confirmed");
  });
});

describe("attendance validators", () => {
  it("accepts a strict organisation-scoped event reference", () => {
    expect(attendanceCheckRefSchema.safeParse({ organisationSlug: "acme", eventId: "evt_1" }).success).toBe(true);
    expect(attendanceCheckRefSchema.safeParse({ organisationSlug: "acme", eventId: "" }).success).toBe(false);
    expect(attendanceCheckRefSchema.safeParse({ organisationSlug: "acme", eventId: "evt_1", force: true }).success).toBe(false);
    expect(attendanceCheckSettingsSchema.safeParse({ organisationSlug: "acme", eventId: "evt_1", releaseOnDecline: true }).success).toBe(true);
    expect(attendanceCheckSettingsSchema.safeParse({ organisationSlug: "acme", eventId: "evt_1", releaseOnDecline: "yes" }).success).toBe(false);
  });

  it("accepts a reply with a trimmed, control-free note", () => {
    const parsed = attendanceReplySchema.parse({ token, response: "NOT_ATTENDING", note: "  Ill\u0000 today\u001b \n" });
    expect(parsed).toEqual({ token, response: "NOT_ATTENDING", note: "Ill  today" });
    expect(attendanceReplySchema.parse({ token, response: "ATTENDING" }).note).toBe("");
    // Newlines and tabs are kept inside the note.
    expect(attendanceReplySchema.parse({ token, response: "ATTENDING", note: "a\nb\tc" }).note).toBe("a\nb\tc");
  });

  it("refuses bad tokens, answers, long notes and extra fields", () => {
    expect(attendanceReplySchema.safeParse({ token: "short", response: "ATTENDING" }).success).toBe(false);
    expect(attendanceReplySchema.safeParse({ token, response: "MAYBE" }).success).toBe(false);
    expect(attendanceReplySchema.safeParse({ token, response: "ATTENDING", note: "x".repeat(ATTENDANCE_NOTE_MAX) }).success).toBe(true);
    const long = attendanceReplySchema.safeParse({ token, response: "ATTENDING", note: "x".repeat(ATTENDANCE_NOTE_MAX + 1) });
    expect(long.success).toBe(false);
    expect(long.error?.issues[0]?.message).toBe("Keep the note to 500 characters or fewer.");
    expect(attendanceReplySchema.safeParse({ token, response: "ATTENDING", rsvpId: "rsvp_1" }).success).toBe(false);
  });
});

describe("attendance outbox payload", () => {
  it("validates the capability payload shape", () => {
    expect(asAttendanceCheckPayload({ to: "a@example.test", rsvpId: "rsvp_1", token })).not.toBeNull();
    expect(asAttendanceCheckPayload({ to: "a@example.test", rsvpId: "rsvp_1", token, reminder: true })).not.toBeNull();
    expect(asAttendanceCheckPayload({ to: "a@example.test", rsvpId: "rsvp_1", token, reminder: "yes" })).toBeNull();
    expect(asAttendanceCheckPayload({ to: "a@example.test", rsvpId: "rsvp_1", token: "short" })).toBeNull();
    expect(asAttendanceCheckPayload({ to: "not-an-email", rsvpId: "rsvp_1", token })).toBeNull();
    expect(asAttendanceCheckPayload({ to: "a@example.test", token })).toBeNull();
    expect(asAttendanceCheckPayload({ to: "a@example.test", rsvpId: "r".repeat(65), token })).toBeNull();
    expect(asAttendanceCheckPayload(null)).toBeNull();
    expect(asAttendanceCheckPayload([token])).toBeNull();
  });

  it("enqueues one attendance-check row per payload, and nothing for none", async () => {
    const client = { outboxMessage: { createMany: mocks.createMany } };
    await expect(enqueueAttendanceChecks(client as never, [])).resolves.toEqual({ count: 0 });
    expect(mocks.createMany).not.toHaveBeenCalled();
    await enqueueAttendanceChecks(client as never, [
      { to: "a@example.test", rsvpId: "rsvp_1", token },
      { to: "b@example.test", rsvpId: "rsvp_2", token: "b".repeat(43), reminder: true },
    ]);
    const data = mocks.createMany.mock.calls[0]![0].data;
    expect(data).toHaveLength(2);
    expect(data[0]).toEqual({ kind: "attendance-check", payload: { to: "a@example.test", rsvpId: "rsvp_1", token } });
    expect(data[1]).toMatchObject({ kind: "attendance-check", payload: { reminder: true } });
  });
});

describe("attendance outbox delivery", () => {
  const message = (payload: Record<string, unknown>) => ({
    id: "msg_1",
    kind: "attendance-check",
    payload,
    status: OutboxStatus.PENDING,
    attempts: 0,
    availableAt: new Date(),
    lockedAt: null,
    sentAt: null,
    lastError: null,
    createdAt: new Date("2030-01-01T00:00:00Z"),
  });
  const check = (overrides: Record<string, unknown> = {}) => ({
    tokenHash: hashAttendanceToken(token),
    response: null,
    rsvp: { status: "CONFIRMED", eventId: "evt_1", guestName: "Ada", user: null },
    event: { title: "Launch", status: "PUBLISHED", startDateTime: new Date(Date.now() + 86_400_000), timezone: "Europe/London", location: "Hall", isOnline: false, attendanceCheckReleaseOnDecline: false, organisation: { name: "Acme" } },
    ...overrides,
  });
  const sentRow = { data: expect.objectContaining({ status: OutboxStatus.SENT }) };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.deleteMany.mockResolvedValue({ count: 1 });
    mocks.send.mockResolvedValue(undefined);
  });

  it("sends the current question and deletes the capability row", async () => {
    mocks.findMany.mockResolvedValue([message({ to: "a@example.test", rsvpId: "rsvp_1", token, reminder: true })]);
    mocks.checkFind.mockResolvedValue(check());
    await expect(deliverOutboxBatch()).resolves.toEqual({ sent: 1, failed: 0 });
    expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({
      to: "a@example.test",
      eventTitle: "Launch",
      organisationName: "Acme",
      timezone: "Europe/London",
      location: "Hall",
      attendPath: `/attend/${token}`,
      recipientName: "Ada",
      reminder: true,
      releaseOnDecline: false,
    }));
    expect(mocks.deleteMany).toHaveBeenCalledWith({ where: expect.objectContaining({ id: "msg_1", status: OutboxStatus.PROCESSING }) });
    expect(mocks.updateMany).not.toHaveBeenCalledWith(expect.objectContaining(sentRow));
  });

  it("tells the email whether a No gives up the place, from the event setting at delivery", async () => {
    mocks.findMany.mockResolvedValue([message({ to: "a@example.test", rsvpId: "rsvp_1", token })]);
    mocks.checkFind.mockResolvedValue(check({ event: { ...check().event, attendanceCheckReleaseOnDecline: true } }));
    await deliverOutboxBatch();
    expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({ releaseOnDecline: true }));
  });

  it("says Online for an online event", async () => {
    mocks.findMany.mockResolvedValue([message({ to: "a@example.test", rsvpId: "rsvp_1", token })]);
    mocks.checkFind.mockResolvedValue(check({ event: { ...check().event, isOnline: true } }));
    await deliverOutboxBatch();
    expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({ location: "Online", reminder: false }));
  });

  it.each([
    ["the check is gone", null],
    ["the link was rotated", check({ tokenHash: hashAttendanceToken("b".repeat(43)) })],
    ["the guest already answered", check({ response: "ATTENDING" })],
    ["the guest is no longer confirmed", check({ rsvp: { status: "WAITLISTED", eventId: "evt_1", guestName: null, user: null } })],
    ["the event was cancelled", check({ event: { ...check().event, status: "CANCELLED" } })],
  ])("drops the question silently when %s", async (_label, row) => {
    mocks.findMany.mockResolvedValue([message({ to: "a@example.test", rsvpId: "rsvp_1", token })]);
    mocks.checkFind.mockResolvedValue(row);
    await expect(deliverOutboxBatch()).resolves.toEqual({ sent: 0, failed: 0 });
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.deleteMany).toHaveBeenCalledOnce();
  });

  it("expires the question once the event has started", async () => {
    mocks.findMany.mockResolvedValue([message({ to: "a@example.test", rsvpId: "rsvp_1", token })]);
    mocks.checkFind.mockResolvedValue(check({ event: { ...check().event, startDateTime: new Date(Date.now() - 1000) } }));
    await expect(deliverOutboxBatch()).resolves.toEqual({ sent: 0, failed: 1 });
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.deleteMany).toHaveBeenCalledOnce();
  });

  it("deletes a malformed row instead of retrying it", async () => {
    mocks.findMany.mockResolvedValue([message({ to: "a@example.test", rsvpId: "rsvp_1", token: "bad" })]);
    await expect(deliverOutboxBatch()).resolves.toEqual({ sent: 0, failed: 1 });
    expect(mocks.checkFind).not.toHaveBeenCalled();
    expect(mocks.deleteMany).toHaveBeenCalledOnce();
  });
});

describe("attendance email", () => {
  const params = {
    eventTitle: "Launch <night>",
    organisationName: "Acme & Co",
    startDateTime: START,
    timezone: "Europe/London",
    location: "Main hall",
    attendPath: `/attend/${token}`,
    recipientName: "Ada",
    baseUrl: "https://events.example.test/",
  };

  it("asks with absolute Yes and No links that preselect the answer", () => {
    const email = buildAttendanceCheckEmail(params);
    expect(email.subject).toBe("Are you still coming to Launch <night>?");
    const yes = `https://events.example.test/attend/${token}?answer=yes`;
    const no = `https://events.example.test/attend/${token}?answer=no`;
    expect(email.html).toContain(`href="${yes}"`);
    expect(email.html).toContain(`href="${no}"`);
    expect(email.text).toContain(`Yes, I'll be there: ${yes}`);
    expect(email.text).toContain(`No, I can't make it: ${no}`);
    expect(email.text).toContain("Where: Main hall");
    // The event is shown in its own timezone (10:00 UTC is 10:00 in London in January).
    expect(email.text).toMatch(/10:00/);
    // HTML is escaped.
    expect(email.html).toContain("Launch &lt;night&gt;");
    expect(email.html).toContain("Acme &amp; Co");
    expect(email.html).not.toContain("<night>");
  });

  it("only says a No gives up the place when release on decline is on", () => {
    for (const email of [buildAttendanceCheckEmail(params), buildAttendanceCheckEmail({ ...params, releaseOnDecline: false })]) {
      expect(email.html).not.toMatch(/waitlist|gives up your place|someone else/i);
      expect(email.text).not.toMatch(/waitlist|gives up your place|someone else/i);
      expect(email.text).toContain("Your answer helps them plan.");
    }
    const releasing = buildAttendanceCheckEmail({ ...params, releaseOnDecline: true });
    expect(releasing.html).toContain("answering No gives up your place so someone else can have it");
    expect(releasing.text).toContain("answering No gives up your place so someone else can have it");
    // Never promises the waitlist: approval-only events do not promote anyone.
    expect(releasing.text).not.toMatch(/waitlist/i);
  });

  it("marks reminders and omits an empty location", () => {
    const email = buildAttendanceCheckEmail({ ...params, reminder: true, location: "" });
    expect(email.subject).toBe("Reminder: are you still coming to Launch <night>?");
    expect(email.text).not.toContain("Where:");
  });

  it("keeps header-breaking characters out of the subject", () => {
    const email = buildAttendanceCheckEmail({ ...params, eventTitle: "Launch\r\nBcc: x@example.test" });
    expect(email.subject).not.toMatch(/[\r\n]/);
  });
});
