import { beforeEach, describe, expect, it, vi } from "vitest";
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
}));

vi.mock("@/lib/db", () => ({ prisma: { outboxMessage: {
  updateMany: mocks.updateMany,
  findMany: mocks.findMany,
  deleteMany: mocks.deleteMany,
} } }));
vi.mock("@/lib/email", () => ({
  sendRSVPConfirmation: mocks.rsvp,
  sendApprovalNotification: mocks.approval,
  sendEventInvitation: mocks.eventInvite,
  sendCollaboratorInvitation: mocks.collaborator,
}));
vi.mock("@/lib/email/passwordReset", () => ({ sendPasswordResetEmail: mocks.passwordReset }));
vi.mock("@/lib/email/emailVerification", () => ({ sendEmailVerificationEmail: mocks.verification }));

import { deliverOutboxBatch } from "@/lib/outbox";

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
