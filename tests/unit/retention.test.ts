import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OutboxStatus } from "@prisma/client";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  verification: vi.fn(),
  session: vi.fn(),
  orgInvite: vi.fn(),
  collaboratorInvite: vi.fn(),
  undo: vi.fn(),
  outbox: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: {
  $transaction: mocks.transaction,
  verificationToken: { deleteMany: mocks.verification },
  session: { deleteMany: mocks.session },
  organisationInvite: { deleteMany: mocks.orgInvite },
  eventCollaboratorInvite: { deleteMany: mocks.collaboratorInvite },
  rsvpDeletionUndo: { deleteMany: mocks.undo },
  outboxMessage: { deleteMany: mocks.outbox },
} }));

import { purgeExpiredOperationalData } from "@/lib/retention";

const previousRetention = process.env.OUTBOX_RETENTION_DAYS;

describe("operational retention", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.OUTBOX_RETENTION_DAYS = "30";
    for (const mock of [mocks.verification, mocks.session, mocks.orgInvite, mocks.collaboratorInvite, mocks.undo, mocks.outbox]) {
      mock.mockResolvedValue({ count: 1 });
    }
    mocks.transaction.mockImplementation((operations: Array<Promise<unknown>>) => Promise.all(operations));
  });

  afterEach(() => {
    if (previousRetention === undefined) delete process.env.OUTBOX_RETENTION_DAYS;
    else process.env.OUTBOX_RETENTION_DAYS = previousRetention;
  });

  it("purges expired capabilities/sessions and both sent and failed queue history", async () => {
    const now = new Date("2030-03-01T00:00:00.000Z");
    await expect(purgeExpiredOperationalData(now)).resolves.toEqual({
      verificationTokens: 1,
      expiredSessions: 1,
      unusedOrganisationInvites: 1,
      unusedCollaboratorInvites: 1,
      undoSnapshots: 1,
      sentOutboxMessages: 1,
      failedOutboxMessages: 1,
    });
    expect(mocks.orgInvite).toHaveBeenCalledWith({ where: { usedAt: null, expiresAt: { lt: now } } });
    expect(mocks.collaboratorInvite).toHaveBeenCalledWith({ where: { usedAt: null, expiresAt: { lt: now } } });
    expect(mocks.outbox).toHaveBeenNthCalledWith(1, { where: { status: OutboxStatus.SENT, sentAt: { lt: new Date("2030-01-30T00:00:00.000Z") } } });
    expect(mocks.outbox).toHaveBeenNthCalledWith(2, { where: { status: OutboxStatus.FAILED, createdAt: { lt: new Date("2030-01-30T00:00:00.000Z") } } });
  });
});
