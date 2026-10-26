import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { OutboxStatus, RsvpStatus } from "@prisma/client";

const mocks = vi.hoisted(() => ({
  updateMany: vi.fn(),
  findMany: vi.fn(),
  deleteMany: vi.fn(),
  rsvp: vi.fn(),
  approval: vi.fn(),
  eventInvite: vi.fn(),
  collaborator: vi.fn(),
  passwordReset: vi.fn(),
  verification: vi.fn(),
  rsvpFind: vi.fn(),
  rsvpFindFirst: vi.fn(),
  broadcast: vi.fn(),
  broadcastFind: vi.fn(),
  eventFind: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: { outboxMessage: {
  updateMany: mocks.updateMany,
  findMany: mocks.findMany,
  deleteMany: mocks.deleteMany,
}, rSVP: { findUnique: mocks.rsvpFind, findFirst: mocks.rsvpFindFirst }, eventBroadcast: { findUnique: mocks.broadcastFind }, event: { findUnique: mocks.eventFind } } }));
vi.mock("@/lib/email", () => ({
  sendRSVPConfirmation: mocks.rsvp,
  sendApprovalNotification: mocks.approval,
  sendEventInvitation: mocks.eventInvite,
  sendCollaboratorInvitation: mocks.collaborator,
  sendEventBroadcast: mocks.broadcast,
}));
vi.mock("@/lib/email/passwordReset", () => ({ sendPasswordResetEmail: mocks.passwordReset }));
vi.mock("@/lib/email/emailVerification", () => ({ sendEmailVerificationEmail: mocks.verification }));

import { deliverOutboxBatch } from "@/lib/outbox";

// Expected links below use this base URL; pin it so a release environment's
// NEXT_PUBLIC_BASE_URL cannot change them.
beforeAll(() => {
  vi.stubEnv("NEXT_PUBLIC_BASE_URL", "http://localhost:3000");
});
afterAll(() => {
  vi.unstubAllEnvs();
});

function message(overrides: Record<string, unknown>) {
  return {
    id: "msg_1",
    kind: "event-invite",
    payload: {},
    status: OutboxStatus.PENDING,
    attempts: 0,
    availableAt: new Date(),
    lockedAt: null,
    sentAt: null,
    lastError: null,
    createdAt: new Date("2030-01-01T00:00:00Z"),
    ...overrides,
  };
}

describe("outbox delivery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // stale-claim recovery, then per-message claim/finalization
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.deleteMany.mockResolvedValue({ count: 1 });
    mocks.rsvpFind.mockResolvedValue({ status: RsvpStatus.CONFIRMED });
  });

  it("deletes ticket-bearing rows immediately after delivery and reuses a stable Message-ID", async () => {
    mocks.findMany.mockResolvedValue([message({
      kind: "rsvp-confirmation",
      payload: { to: "attendee@example.test", eventTitle: "Event", status: RsvpStatus.CONFIRMED, checkInToken: "ticket-secret" },
    })]);

    await expect(deliverOutboxBatch()).resolves.toEqual({ sent: 1, failed: 0 });
    expect(mocks.rsvp).toHaveBeenCalledWith(expect.objectContaining({
      checkInToken: "ticket-secret",
      messageId: "<yuyu-msg_1@outbox.invalid>",
    }));
    expect(mocks.deleteMany).toHaveBeenCalledWith({ where: expect.objectContaining({ id: "msg_1", status: OutboxStatus.PROCESSING, lockedAt: expect.any(Date) }) });
    expect(mocks.updateMany).not.toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: OutboxStatus.SENT }) }));
  });

  it("deletes a terminal capability failure instead of retaining its payload", async () => {
    const error = Object.assign(new Error("recipient@example.test https://events.test/join/secret"), { code: "ECONNRESET" });
    mocks.collaborator.mockRejectedValue(error);
    mocks.findMany.mockResolvedValue([message({
      kind: "collaborator-invite",
      attempts: 7,
      payload: { to: "person@example.test", eventTitle: "Event", inviteUrl: "https://events.test/join/secret", expiresAt: "2035-01-01T00:00:00.000Z" },
    })]);

    await expect(deliverOutboxBatch()).resolves.toEqual({ sent: 0, failed: 1 });
    expect(mocks.deleteMany).toHaveBeenCalledWith({ where: expect.objectContaining({ id: "msg_1", status: OutboxStatus.PROCESSING }) });
  });

  it("drops a stale RSVP confirmation instead of sending an out-of-date status", async () => {
    mocks.rsvpFind.mockResolvedValue({ status: RsvpStatus.CONFIRMED });
    mocks.findMany.mockResolvedValue([message({
      kind: "rsvp-confirmation",
      payload: { to: "attendee@example.test", eventTitle: "Event", status: RsvpStatus.PENDING_APPROVAL, checkInToken: "ticket-secret" },
    })]);

    await expect(deliverOutboxBatch()).resolves.toEqual({ sent: 0, failed: 0 });
    expect(mocks.rsvp).not.toHaveBeenCalled();
    expect(mocks.deleteMany).toHaveBeenCalledWith({ where: expect.objectContaining({ id: "msg_1", status: OutboxStatus.PROCESSING }) });
  });

  it("stores only bounded failure metadata and releases the claim for a retry", async () => {
    mocks.eventInvite.mockRejectedValue(Object.assign(new Error("private@example.test token-secret"), { code: "ETIMEDOUT" }));
    mocks.findMany.mockResolvedValue([message({
      payload: { to: "person@example.test", eventTitle: "Event", organisationName: "Org", orgSlug: "org", eventSlug: "event", expiresAt: "2035-01-01T00:00:00.000Z" },
    })]);

    await expect(deliverOutboxBatch()).resolves.toEqual({ sent: 0, failed: 1 });
    expect(mocks.updateMany).toHaveBeenLastCalledWith({
      where: expect.objectContaining({ id: "msg_1", status: OutboxStatus.PROCESSING, lockedAt: expect.any(Date) }),
      data: expect.objectContaining({ status: OutboxStatus.PENDING, lockedAt: null, lastError: "Error (ETIMEDOUT)" }),
    });
    expect(JSON.stringify(mocks.updateMany.mock.calls)).not.toContain("private@example.test");
    expect(JSON.stringify(mocks.updateMany.mock.calls)).not.toContain("token-secret");
  });

  it("keeps authentication-email retries within the one-hour capability lifetime", async () => {
    vi.useFakeTimers();
    try {
      const now = new Date("2030-01-01T00:00:00.000Z");
      vi.setSystemTime(now);
      mocks.verification.mockRejectedValue(Object.assign(new Error("temporary SMTP failure"), { code: "ETIMEDOUT" }));
      mocks.findMany.mockResolvedValue([message({
        kind: "email-verification",
        attempts: 4,
        payload: {
          to: "person@example.test",
          verificationUrl: "https://events.test/verify-email?token=secret",
          expiresAt: "2030-01-01T01:00:00.000Z",
        },
      })]);

      await expect(deliverOutboxBatch()).resolves.toEqual({ sent: 0, failed: 1 });
      expect(mocks.updateMany).toHaveBeenLastCalledWith({
        where: expect.objectContaining({ id: "msg_1", status: OutboxStatus.PROCESSING, lockedAt: expect.any(Date) }),
        data: expect.objectContaining({
          status: OutboxStatus.PENDING,
          availableAt: new Date("2030-01-01T00:08:00.000Z"),
          lockedAt: null,
        }),
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("drops an expired invite without attempting delivery", async () => {
    mocks.findMany.mockResolvedValue([message({
      kind: "collaborator-invite",
      payload: { to: "person@example.test", eventTitle: "Event", inviteUrl: "https://events.test/join/secret", expiresAt: "2020-01-01T00:00:00.000Z" },
    })]);

    await expect(deliverOutboxBatch()).resolves.toEqual({ sent: 0, failed: 1 });
    expect(mocks.collaborator).not.toHaveBeenCalled();
    expect(mocks.deleteMany).toHaveBeenCalled();
  });

  it("quarantines a poison non-capability payload without retrying it eight times", async () => {
    mocks.findMany.mockResolvedValue([message({ kind: "event-invite", payload: { unexpected: "shape" } })]);
    await expect(deliverOutboxBatch()).resolves.toEqual({ sent: 0, failed: 1 });
    expect(mocks.eventInvite).not.toHaveBeenCalled();
    expect(mocks.updateMany).toHaveBeenLastCalledWith({
      where: expect.objectContaining({ id: "msg_1", status: OutboxStatus.PROCESSING }),
      data: expect.objectContaining({ status: OutboxStatus.FAILED, lockedAt: null, lastError: "PermanentOutboxError" }),
    });
  });
});

describe("event broadcast delivery", () => {
  const broadcastEvent = {
    title: "Mixer",
    slug: "mixer",
    startDateTime: new Date("2030-03-07T12:30:00.000Z"),
    timezone: "Asia/Kolkata",
    location: "Hall A",
    isOnline: false,
    organisation: { name: "Org", slug: "org" },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.deleteMany.mockResolvedValue({ count: 1 });
    mocks.broadcastFind.mockResolvedValue({
      subject: "Update for {{name}}",
      body: "Hi {{name}}, {{event}} starts {{eventDate}} at {{location}}. Ticket: {{ticketLink}}",
      statuses: [RsvpStatus.CONFIRMED],
      attendance: "ANY",
      eventId: "event_1",
      event: broadcastEvent,
    });
    mocks.rsvpFind.mockResolvedValue({ eventId: "event_1", status: RsvpStatus.CONFIRMED, checkedInAt: null, checkInToken: "ticket-secret", guestName: "Priya", user: null });
  });

  it("renders the template per recipient at send time and keeps a sent row without capabilities", async () => {
    mocks.findMany.mockResolvedValue([message({ kind: "event-broadcast", payload: { to: "priya@example.test", broadcastId: "broadcast_1", rsvpId: "rsvp_1" } })]);

    await expect(deliverOutboxBatch()).resolves.toEqual({ sent: 1, failed: 0 });
    const sent = mocks.broadcast.mock.calls[0]?.[0];
    expect(sent.to).toBe("priya@example.test");
    expect(sent.subject).toBe("Update for Priya");
    expect(sent.bodyText).toContain("Hi Priya, Mixer starts");
    expect(sent.bodyText).toContain("at Hall A. Ticket: ");
    expect(sent.bodyText).toContain("/ticket/ticket-secret");
    expect(sent.bodyHtml).toContain("Hi Priya, Mixer starts");
    expect(sent.messageId).toBe("<yuyu-msg_1@outbox.invalid>");
    expect(mocks.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: OutboxStatus.SENT }) }));
    expect(mocks.deleteMany).not.toHaveBeenCalled();
  });

  it("does not expose a ticket link to registrations that are not confirmed", async () => {
    mocks.broadcastFind.mockResolvedValue({
      subject: "Waitlist update",
      body: "Details: {{ticketLink}}",
      statuses: [RsvpStatus.WAITLISTED],
      attendance: "ANY",
      eventId: "event_1",
      event: broadcastEvent,
    });
    mocks.rsvpFind.mockResolvedValue({ eventId: "event_1", status: RsvpStatus.WAITLISTED, checkedInAt: null, checkInToken: "ticket-secret", guestName: null, user: { name: "Asha" } });
    mocks.findMany.mockResolvedValue([message({ kind: "event-broadcast", payload: { to: "asha@example.test", broadcastId: "broadcast_1", rsvpId: "rsvp_1" } })]);

    await expect(deliverOutboxBatch()).resolves.toEqual({ sent: 1, failed: 0 });
    const sent = mocks.broadcast.mock.calls[0]?.[0];
    expect(sent.bodyText).not.toContain("ticket-secret");
    expect(sent.bodyText).toContain("/org/mixer");
  });

  it("drops a recipient whose registration left the audience after queuing", async () => {
    mocks.rsvpFind.mockResolvedValue({ eventId: "event_1", status: RsvpStatus.REJECTED, checkedInAt: null, checkInToken: "ticket-secret", guestName: "Priya", user: null });
    mocks.findMany.mockResolvedValue([message({ kind: "event-broadcast", payload: { to: "priya@example.test", broadcastId: "broadcast_1", rsvpId: "rsvp_1" } })]);

    await expect(deliverOutboxBatch()).resolves.toEqual({ sent: 0, failed: 0 });
    expect(mocks.broadcast).not.toHaveBeenCalled();
    expect(mocks.deleteMany).toHaveBeenCalledWith({ where: expect.objectContaining({ id: "msg_1", status: OutboxStatus.PROCESSING }) });
  });

  it("drops a recipient whose registration belongs to a different event than the broadcast", async () => {
    mocks.rsvpFind.mockResolvedValue({ eventId: "event_other", status: RsvpStatus.CONFIRMED, checkedInAt: null, checkInToken: "ticket-secret", guestName: "Priya", user: null });
    mocks.findMany.mockResolvedValue([message({ kind: "event-broadcast", payload: { to: "priya@example.test", broadcastId: "broadcast_1", rsvpId: "rsvp_1" } })]);

    await expect(deliverOutboxBatch()).resolves.toEqual({ sent: 0, failed: 0 });
    expect(mocks.broadcast).not.toHaveBeenCalled();
  });

  it("marks a malformed broadcast payload as a permanent failure", async () => {
    mocks.findMany.mockResolvedValue([message({ kind: "event-broadcast", payload: { to: "not-an-email", broadcastId: "b", rsvpId: "r" } })]);
    await expect(deliverOutboxBatch()).resolves.toEqual({ sent: 0, failed: 1 });
    expect(mocks.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: OutboxStatus.FAILED }) }));
  });

  it("renders test sends with sample values and a visible test prefix", async () => {
    mocks.eventFind.mockResolvedValue(broadcastEvent);
    mocks.findMany.mockResolvedValue([message({ kind: "event-broadcast-test", payload: { to: "admin@example.test", eventId: "event_1", subject: "Hello {{name}}", body: "{{event}} / {{ticketLink}}", recipientName: "Admin" } })]);

    await expect(deliverOutboxBatch()).resolves.toEqual({ sent: 1, failed: 0 });
    const sent = mocks.broadcast.mock.calls[0]?.[0];
    expect(sent.subject).toBe("[Test] Hello Admin");
    expect(sent.bodyText).toBe("Mixer / http://localhost:3000/org/mixer");
  });

  it("links a test send's ticket button to the organiser's own ticket when they are confirmed", async () => {
    mocks.eventFind.mockResolvedValue(broadcastEvent);
    mocks.rsvpFindFirst.mockResolvedValue({ checkInToken: "own-ticket-token" });
    mocks.findMany.mockResolvedValue([message({ kind: "event-broadcast-test", payload: { to: "admin@example.test", eventId: "event_1", subject: "Hi", body: "{{ticketLink}}" } })]);

    await expect(deliverOutboxBatch()).resolves.toEqual({ sent: 1, failed: 0 });
    expect(mocks.broadcast.mock.calls.at(-1)?.[0].bodyText).toBe("http://localhost:3000/ticket/own-ticket-token");
    expect(mocks.rsvpFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ eventId: "event_1", status: RsvpStatus.CONFIRMED }),
    }));
  });
});
