import { beforeEach, describe, expect, it, vi } from "vitest";
import { OutboxStatus, SubmissionStatus } from "@prisma/client";

const mocks = vi.hoisted(() => ({
  updateMany: vi.fn(),
  findMany: vi.fn(),
  deleteMany: vi.fn(),
  create: vi.fn(),
  createMany: vi.fn(),
  submissionFind: vi.fn(),
  linkFind: vi.fn(),
  eventFind: vi.fn(),
  received: vi.fn(),
  link: vi.fn(),
  results: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    outboxMessage: { updateMany: mocks.updateMany, findMany: mocks.findMany, deleteMany: mocks.deleteMany },
    submission: { findUnique: mocks.submissionFind },
    submissionLink: { findUnique: mocks.linkFind },
    event: { findUnique: mocks.eventFind },
  },
}));
vi.mock("@/lib/email", () => ({
  sendSubmissionReceivedEmail: mocks.received,
  sendSubmissionLinkEmail: mocks.link,
  sendResultsPublishedEmail: mocks.results,
}));
vi.mock("@/lib/email/passwordReset", () => ({ sendPasswordResetEmail: vi.fn() }));
vi.mock("@/lib/email/emailVerification", () => ({ sendEmailVerificationEmail: vi.fn() }));
vi.mock("@/lib/opsAlerts", () => ({ reportOpsAlert: vi.fn() }));

import {
  asResultsPublishedPayload,
  asSubmissionLinkPayload,
  asSubmissionReceivedPayload,
  deliverOutboxBatch,
  enqueueResultsPublished,
  enqueueSubmissionLink,
  enqueueSubmissionReceived,
} from "@/lib/outbox";
import { hashSubmissionLinkToken } from "@/lib/submissionToken";

const token = "s".repeat(43);

function message(kind: string, payload: Record<string, unknown>) {
  return {
    id: "msg_1",
    kind,
    payload,
    status: OutboxStatus.PENDING,
    attempts: 0,
    availableAt: new Date(),
    lockedAt: null,
    sentAt: null,
    lastError: null,
    createdAt: new Date("2030-01-01T00:00:00Z"),
  };
}

const sentRow = { data: expect.objectContaining({ status: OutboxStatus.SENT }) };

describe("judging outbox payloads", () => {
  it("validates submission-received payloads", () => {
    expect(asSubmissionReceivedPayload({ to: "a@example.test", submissionId: "sub_1" })).not.toBeNull();
    expect(asSubmissionReceivedPayload({ to: "a@example.test", submissionId: "sub_1", recipientName: "Ada" })).not.toBeNull();
    expect(asSubmissionReceivedPayload({ to: "nope", submissionId: "sub_1" })).toBeNull();
    expect(asSubmissionReceivedPayload({ to: "a@example.test" })).toBeNull();
    expect(asSubmissionReceivedPayload({ to: "a@example.test", submissionId: "sub_1", recipientName: "x".repeat(201) })).toBeNull();
  });

  it("validates submission-link payloads (capability shape)", () => {
    expect(asSubmissionLinkPayload({ to: "a@example.test", rsvpId: "rsvp_1", token })).not.toBeNull();
    expect(asSubmissionLinkPayload({ to: "a@example.test", rsvpId: "rsvp_1", token: "short" })).toBeNull();
    expect(asSubmissionLinkPayload({ to: "a@example.test", token })).toBeNull();
    expect(asSubmissionLinkPayload(null)).toBeNull();
  });

  it("validates results-published payloads", () => {
    expect(asResultsPublishedPayload({ to: "a@example.test", eventId: "event_1" })).not.toBeNull();
    expect(asResultsPublishedPayload({ to: "a@example.test", eventId: "" })).toBeNull();
    expect(asResultsPublishedPayload(["a@example.test"])).toBeNull();
  });

  it("enqueues the documented kinds", async () => {
    const client = { outboxMessage: { create: mocks.create, createMany: mocks.createMany } };
    await enqueueSubmissionReceived(client as never, { to: "a@example.test", submissionId: "sub_1" });
    await enqueueSubmissionLink(client as never, { to: "a@example.test", rsvpId: "rsvp_1", token });
    await enqueueResultsPublished(client as never, [{ to: "a@example.test", eventId: "event_1" }, { to: "b@example.test", eventId: "event_1" }]);
    await expect(enqueueResultsPublished(client as never, [])).resolves.toEqual({ count: 0 });
    expect(mocks.create).toHaveBeenNthCalledWith(1, { data: expect.objectContaining({ kind: "submission-received" }) });
    expect(mocks.create).toHaveBeenNthCalledWith(2, { data: expect.objectContaining({ kind: "submission-link" }) });
    expect(mocks.createMany).toHaveBeenCalledOnce();
    expect(mocks.createMany.mock.calls[0]![0].data).toHaveLength(2);
    expect(mocks.createMany.mock.calls[0]![0].data[0]).toMatchObject({ kind: "results-published" });
  });
});

describe("judging outbox delivery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.deleteMany.mockResolvedValue({ count: 1 });
  });

  it("confirms a submission that is still submitted, and keeps the row as SENT (no capability)", async () => {
    mocks.findMany.mockResolvedValue([message("submission-received", { to: "a@example.test", submissionId: "sub_1" })]);
    mocks.submissionFind.mockResolvedValue({ status: SubmissionStatus.SUBMITTED, title: "Byte Me", team: { name: "Null Pointers" }, event: { title: "Jam", slug: "jam", organisation: { slug: "org" } } });
    await expect(deliverOutboxBatch()).resolves.toEqual({ sent: 1, failed: 0 });
    expect(mocks.received).toHaveBeenCalledWith(expect.objectContaining({ to: "a@example.test", projectTitle: "Byte Me", teamName: "Null Pointers", eventPath: "/org/jam" }));
    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining(sentRow));
  });

  it("drops a confirmation for a withdrawn or deleted submission", async () => {
    mocks.findMany.mockResolvedValue([message("submission-received", { to: "a@example.test", submissionId: "sub_1" })]);
    mocks.submissionFind.mockResolvedValue({ status: SubmissionStatus.WITHDRAWN, title: "x", team: null, event: { title: "Jam", slug: "jam", organisation: { slug: "org" } } });
    await expect(deliverOutboxBatch()).resolves.toEqual({ sent: 0, failed: 0 });
    mocks.submissionFind.mockResolvedValue(null);
    await expect(deliverOutboxBatch()).resolves.toEqual({ sent: 0, failed: 0 });
    expect(mocks.received).not.toHaveBeenCalled();
  });

  it("sends the current submission link and deletes the capability row", async () => {
    mocks.findMany.mockResolvedValue([message("submission-link", { to: "a@example.test", rsvpId: "rsvp_1", token })]);
    mocks.linkFind.mockResolvedValue({ tokenHash: hashSubmissionLinkToken(token), rsvp: { teamId: null, guestName: "Ada", user: null, event: { title: "Jam" } } });
    await expect(deliverOutboxBatch()).resolves.toEqual({ sent: 1, failed: 0 });
    expect(mocks.link).toHaveBeenCalledWith(expect.objectContaining({ to: "a@example.test", submitPath: `/submit/${token}` }));
    expect(mocks.deleteMany).toHaveBeenCalledWith({ where: expect.objectContaining({ id: "msg_1", status: OutboxStatus.PROCESSING }) });
    expect(mocks.updateMany).not.toHaveBeenCalledWith(expect.objectContaining(sentRow));
  });

  it("drops a regenerated link, a removed registration, or one that joined a team", async () => {
    mocks.findMany.mockResolvedValue([message("submission-link", { to: "a@example.test", rsvpId: "rsvp_1", token })]);
    mocks.linkFind.mockResolvedValue({ tokenHash: hashSubmissionLinkToken("x".repeat(43)), rsvp: { teamId: null, guestName: null, user: null, event: { title: "Jam" } } });
    await expect(deliverOutboxBatch()).resolves.toEqual({ sent: 0, failed: 0 });
    mocks.linkFind.mockResolvedValue(null);
    await expect(deliverOutboxBatch()).resolves.toEqual({ sent: 0, failed: 0 });
    mocks.linkFind.mockResolvedValue({ tokenHash: hashSubmissionLinkToken(token), rsvp: { teamId: "team_1", guestName: null, user: null, event: { title: "Jam" } } });
    await expect(deliverOutboxBatch()).resolves.toEqual({ sent: 0, failed: 0 });
    expect(mocks.link).not.toHaveBeenCalled();
  });

  it("deletes a malformed link row instead of retrying it", async () => {
    mocks.findMany.mockResolvedValue([message("submission-link", { to: "a@example.test", rsvpId: "rsvp_1", token: "bad" })]);
    await expect(deliverOutboxBatch()).resolves.toEqual({ sent: 0, failed: 1 });
    expect(mocks.deleteMany).toHaveBeenCalledOnce();
  });

  it("announces published results and drops the email once they are unpublished", async () => {
    mocks.findMany.mockResolvedValue([message("results-published", { to: "a@example.test", eventId: "event_1", recipientName: "Ada" })]);
    mocks.eventFind.mockResolvedValue({ title: "Jam", slug: "jam", resultsPublishedAt: new Date(), organisation: { slug: "org" } });
    await expect(deliverOutboxBatch()).resolves.toEqual({ sent: 1, failed: 0 });
    expect(mocks.results).toHaveBeenCalledWith(expect.objectContaining({ to: "a@example.test", resultsPath: "/org/jam/results", recipientName: "Ada" }));
    mocks.results.mockClear();
    mocks.eventFind.mockResolvedValue({ title: "Jam", slug: "jam", resultsPublishedAt: null, organisation: { slug: "org" } });
    await expect(deliverOutboxBatch()).resolves.toEqual({ sent: 0, failed: 0 });
    expect(mocks.results).not.toHaveBeenCalled();
  });
});
