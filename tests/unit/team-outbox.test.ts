import { beforeEach, describe, expect, it, vi } from "vitest";
import { OutboxStatus, RsvpStatus } from "@prisma/client";

const mocks = vi.hoisted(() => ({
  updateMany: vi.fn(),
  findMany: vi.fn(),
  deleteMany: vi.fn(),
  create: vi.fn(),
  teamFind: vi.fn(),
  rsvpFind: vi.fn(),
  teamCreated: vi.fn(),
  memberAdded: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    outboxMessage: { updateMany: mocks.updateMany, findMany: mocks.findMany, deleteMany: mocks.deleteMany },
    team: { findUnique: mocks.teamFind },
    rSVP: { findUnique: mocks.rsvpFind },
  },
}));
vi.mock("@/lib/email", () => ({
  sendTeamCreatedEmail: mocks.teamCreated,
  sendTeamMemberAddedEmail: mocks.memberAdded,
}));
vi.mock("@/lib/email/passwordReset", () => ({ sendPasswordResetEmail: vi.fn() }));
vi.mock("@/lib/email/emailVerification", () => ({ sendEmailVerificationEmail: vi.fn() }));
vi.mock("@/lib/opsAlerts", () => ({ reportOpsAlert: vi.fn() }));

import {
  asTeamCreatedPayload,
  asTeamMemberAddedPayload,
  deliverOutboxBatch,
  enqueueTeamCreated,
  enqueueTeamMemberAdded,
} from "@/lib/outbox";
import { hashTeamManageToken } from "@/lib/teamToken";

const manageToken = "m".repeat(43);

function message(overrides: Record<string, unknown>) {
  return {
    id: "msg_1",
    kind: "team-created",
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

const team = {
  name: "Byte Me",
  joinToken: "j".repeat(43),
  manageTokenHash: hashTeamManageToken(manageToken),
  event: { title: "Jam", slug: "jam", organisation: { slug: "org" } },
  leaderRsvp: { guestName: "Lead", user: null },
};

describe("team outbox payloads", () => {
  it("validates team-created payloads", () => {
    expect(asTeamCreatedPayload({ to: "lead@example.test", teamId: "team_1", manageToken })).not.toBeNull();
    expect(asTeamCreatedPayload({ to: "lead@example.test", teamId: "team_1", manageToken, reason: "leader" })).not.toBeNull();
    expect(asTeamCreatedPayload({ to: "lead@example.test", teamId: "team_1", manageToken, reason: "other" })).toBeNull();
    expect(asTeamCreatedPayload({ to: "not-an-email", teamId: "team_1", manageToken })).toBeNull();
    expect(asTeamCreatedPayload({ to: "lead@example.test", teamId: "team_1", manageToken: "short" })).toBeNull();
    expect(asTeamCreatedPayload({ to: "lead@example.test", manageToken })).toBeNull();
    expect(asTeamCreatedPayload(["lead@example.test"])).toBeNull();
  });

  it("validates team-member-added payloads", () => {
    expect(asTeamMemberAddedPayload({ to: "m@example.test", checkInToken: "ticket-token" })).not.toBeNull();
    expect(asTeamMemberAddedPayload({ to: "m@example.test", checkInToken: "ticket-token", addedByName: "Lead" })).not.toBeNull();
    expect(asTeamMemberAddedPayload({ to: "m@example.test", checkInToken: "" })).toBeNull();
    expect(asTeamMemberAddedPayload({ to: "m@example.test", checkInToken: "t", addedByName: "x".repeat(201) })).toBeNull();
    expect(asTeamMemberAddedPayload(null)).toBeNull();
  });

  it("enqueues the documented kinds", async () => {
    const client = { outboxMessage: { create: mocks.create } };
    await enqueueTeamCreated(client as never, { to: "lead@example.test", teamId: "team_1", manageToken, reason: "created" });
    await enqueueTeamMemberAdded(client as never, { to: "m@example.test", checkInToken: "ticket-token" });
    expect(mocks.create).toHaveBeenNthCalledWith(1, { data: expect.objectContaining({ kind: "team-created" }) });
    expect(mocks.create).toHaveBeenNthCalledWith(2, { data: expect.objectContaining({ kind: "team-member-added" }) });
  });
});

describe("team outbox delivery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.deleteMany.mockResolvedValue({ count: 1 });
  });

  it("sends the team page link and deletes the capability row after delivery", async () => {
    mocks.findMany.mockResolvedValue([message({ payload: { to: "lead@example.test", teamId: "team_1", manageToken } })]);
    mocks.teamFind.mockResolvedValue(team);
    await expect(deliverOutboxBatch()).resolves.toEqual({ sent: 1, failed: 0 });
    expect(mocks.teamCreated).toHaveBeenCalledWith(expect.objectContaining({
      to: "lead@example.test",
      teamName: "Byte Me",
      managePath: `/team/${manageToken}`,
      joinPath: `/org/jam/team/${"j".repeat(43)}`,
      reason: "created",
    }));
    expect(mocks.deleteMany).toHaveBeenCalledWith({ where: expect.objectContaining({ id: "msg_1", status: OutboxStatus.PROCESSING }) });
    expect(mocks.updateMany).not.toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: OutboxStatus.SENT }) }));
  });

  it("drops a team link that was regenerated or whose team was deleted before delivery", async () => {
    mocks.findMany.mockResolvedValue([message({ payload: { to: "lead@example.test", teamId: "team_1", manageToken } })]);
    mocks.teamFind.mockResolvedValue({ ...team, manageTokenHash: hashTeamManageToken("x".repeat(43)) });
    await expect(deliverOutboxBatch()).resolves.toEqual({ sent: 0, failed: 0 });
    mocks.teamFind.mockResolvedValue(null);
    await expect(deliverOutboxBatch()).resolves.toEqual({ sent: 0, failed: 0 });
    expect(mocks.teamCreated).not.toHaveBeenCalled();
    expect(mocks.deleteMany).toHaveBeenCalledTimes(2);
  });

  it("deletes a malformed capability row instead of retrying it", async () => {
    mocks.findMany.mockResolvedValue([message({ payload: { to: "lead@example.test", teamId: "team_1", manageToken: "bad" } })]);
    await expect(deliverOutboxBatch()).resolves.toEqual({ sent: 0, failed: 1 });
    expect(mocks.deleteMany).toHaveBeenCalledOnce();
    expect(mocks.teamCreated).not.toHaveBeenCalled();
  });

  it("emails an added member their own ticket while the registration still exists", async () => {
    mocks.findMany.mockResolvedValue([message({ kind: "team-member-added", payload: { to: "m@example.test", checkInToken: "ticket-token", addedByName: "Lead" } })]);
    mocks.rsvpFind.mockResolvedValue({ status: RsvpStatus.WAITLISTED, guestName: "Member", user: null, event: { title: "Jam" }, team: { name: "Byte Me" } });
    await expect(deliverOutboxBatch()).resolves.toEqual({ sent: 1, failed: 0 });
    expect(mocks.memberAdded).toHaveBeenCalledWith(expect.objectContaining({
      to: "m@example.test",
      teamName: "Byte Me",
      status: RsvpStatus.WAITLISTED,
      checkInToken: "ticket-token",
      addedByName: "Lead",
      recipientName: "Member",
    }));
    expect(mocks.deleteMany).toHaveBeenCalledOnce();
  });

  it("drops a member email when the member left the team first", async () => {
    mocks.findMany.mockResolvedValue([message({ kind: "team-member-added", payload: { to: "m@example.test", checkInToken: "ticket-token" } })]);
    mocks.rsvpFind.mockResolvedValue({ status: RsvpStatus.CONFIRMED, guestName: null, user: null, event: { title: "Jam" }, team: null });
    await expect(deliverOutboxBatch()).resolves.toEqual({ sent: 0, failed: 0 });
    expect(mocks.memberAdded).not.toHaveBeenCalled();
  });
});
