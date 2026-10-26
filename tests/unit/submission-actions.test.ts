import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  rateLimit: vi.fn(),
  audit: vi.fn(),
  eventFindUnique: vi.fn(),
  byManageToken: vi.fn(),
  byLink: vi.fn(),
  forUser: vi.fn(),
  saveDraft: vi.fn(),
  submit: vi.fn(),
  withdraw: vi.fn(),
  requestLink: vi.fn(),
  byTicket: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/actionRateLimit", () => ({ isActionRateLimited: mocks.rateLimit }));
vi.mock("@/lib/audit", () => ({ recordAuditEvent: mocks.audit }));
vi.mock("@/lib/db", () => ({ prisma: { event: { findUnique: mocks.eventFindUnique } } }));
vi.mock("@/lib/core/teams", () => ({ resolveRsvpByTicketToken: mocks.byTicket }));
vi.mock("@/lib/core/judging", () => ({
  resolveEntrantByTeamManageToken: mocks.byManageToken,
  resolveEntrantBySubmissionLink: mocks.byLink,
  resolveEntrantForUser: mocks.forUser,
  saveSubmissionDraft: mocks.saveDraft,
  submitSubmission: mocks.submit,
  withdrawSubmission: mocks.withdraw,
  requestSubmissionLink: mocks.requestLink,
}));

import { submittedMessage } from "@/components/submission/submissionWindow";
import {
  requestSubmissionLinkAction,
  saveSubmissionDraftAction,
  submitSubmissionAction,
  withdrawSubmissionAction,
} from "@/app/actions/submissions";

const TEAM_TOKEN = "t".repeat(43);
const LINK_TOKEN = "s".repeat(43);
const teamAuth = { kind: "team-token", eventId: "event_1", teamId: "team_1", manageTokenHash: "hash" };
const soloAuth = { kind: "solo-link", eventId: "event_1", rsvpId: "rsvp_1", tokenHash: "hash" };
const input = { title: "Robot", summary: "", repoUrl: "", demoUrl: "", videoUrl: "" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue(null);
  mocks.rateLimit.mockResolvedValue(false);
  mocks.audit.mockResolvedValue(undefined);
  mocks.eventFindUnique.mockResolvedValue({ organisationId: "org_1" });
  mocks.byManageToken.mockResolvedValue(teamAuth);
  mocks.byLink.mockResolvedValue(soloAuth);
  mocks.forUser.mockResolvedValue(null);
  mocks.saveDraft.mockResolvedValue({ ok: true, data: { submissionId: "sub_1", status: "DRAFT" } });
  mocks.submit.mockResolvedValue({ ok: true, data: { submissionId: "sub_1", status: "SUBMITTED", receiptQueued: false } });
  mocks.withdraw.mockResolvedValue({ ok: true, data: { status: "WITHDRAWN" } });
  mocks.requestLink.mockResolvedValue({ ok: true, data: { sent: true } });
  mocks.byTicket.mockResolvedValue({ rsvpId: "rsvp_1", eventId: "event_1", organisationId: "org_1", userId: null, teamId: null });
});

describe("submission references", () => {
  it("edits a team's project with the management link", async () => {
    const res = await saveSubmissionDraftAction({ manageToken: TEAM_TOKEN }, input);
    expect(res).toEqual({ ok: true, data: { status: "DRAFT" } });
    expect(mocks.byManageToken).toHaveBeenCalledWith(TEAM_TOKEN);
    expect(mocks.saveDraft).toHaveBeenCalledWith(teamAuth, input);
    expect(mocks.rateLimit).toHaveBeenCalledWith("action", "submission:team:team_1");
  });

  it("edits a solo project with the emailed submission link", async () => {
    await submitSubmissionAction({ submissionToken: LINK_TOKEN }, input);
    expect(mocks.byLink).toHaveBeenCalledWith(LINK_TOKEN);
    expect(mocks.submit).toHaveBeenCalledWith(soloAuth, input);
    expect(mocks.rateLimit).toHaveBeenCalledWith("action", "submission:rsvp:rsvp_1");
  });

  it("resolves a bare event id only for a signed-in entrant", async () => {
    const signedOut = await saveSubmissionDraftAction({ eventId: "event_1" }, input);
    expect(signedOut.ok).toBe(false);
    expect(mocks.forUser).not.toHaveBeenCalled();

    mocks.auth.mockResolvedValue({ user: { id: "user_1" } });
    const memberAuth = { kind: "team-member", eventId: "event_1", teamId: "team_1", userId: "user_1" };
    mocks.forUser.mockResolvedValue(memberAuth);
    await saveSubmissionDraftAction({ eventId: "event_1" }, input);
    expect(mocks.forUser).toHaveBeenCalledWith("user_1", "event_1");
    expect(mocks.saveDraft).toHaveBeenCalledWith(memberAuth, input);
  });

  it("refuses malformed, mixed, or unknown references without touching the core", async () => {
    for (const ref of [null, "event_1", { manageToken: "short" }, { submissionToken: LINK_TOKEN, eventId: "event_1" }, { ticketToken: "abcdefgh" }]) {
      const res = await submitSubmissionAction(ref, input);
      expect(res.ok).toBe(false);
    }
    mocks.byLink.mockResolvedValue(null);
    expect((await submitSubmissionAction({ submissionToken: LINK_TOKEN }, input)).ok).toBe(false);
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it("stops when rate limited", async () => {
    mocks.rateLimit.mockResolvedValue(true);
    const res = await withdrawSubmissionAction({ manageToken: TEAM_TOKEN });
    expect(res.ok).toBe(false);
    expect(mocks.withdraw).not.toHaveBeenCalled();
  });

  it("passes core errors through with field errors", async () => {
    mocks.submit.mockResolvedValue({ ok: false, error: "Check the highlighted fields.", fieldErrors: { repoUrl: ["Use a full https:// link"] } });
    const res = await submitSubmissionAction({ manageToken: TEAM_TOKEN }, input);
    expect(res).toEqual({ ok: false, error: "Check the highlighted fields.", fieldErrors: { repoUrl: ["Use a full https:// link"] } });
    expect(mocks.audit).not.toHaveBeenCalled();
  });
});

describe("submission audit", () => {
  it("audits submit and withdraw without tokens or content", async () => {
    await submitSubmissionAction({ submissionToken: LINK_TOKEN }, input);
    await withdrawSubmissionAction({ submissionToken: LINK_TOKEN });
    expect(mocks.audit.mock.calls.map(([event]) => event.action)).toEqual(["SUBMISSION_SUBMITTED", "SUBMISSION_WITHDRAWN"]);
    const serialised = JSON.stringify(mocks.audit.mock.calls);
    expect(serialised).not.toContain(LINK_TOKEN);
    expect(serialised).not.toContain("Robot");
    expect(mocks.audit.mock.calls[0]![0]).toMatchObject({ organisationId: "org_1", targetType: "Submission", targetId: "sub_1" });
  });

  it("does not audit drafts", async () => {
    await saveSubmissionDraftAction({ manageToken: TEAM_TOKEN }, input);
    expect(mocks.audit).not.toHaveBeenCalled();
  });
});

describe("requestSubmissionLinkAction", () => {
  it("resolves the ticket holder as its owner and never returns the token", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "user_1" } });
    const res = await requestSubmissionLinkAction("ticket-token-1");
    expect(res).toEqual({ ok: true, data: { sent: true } });
    expect(mocks.byTicket).toHaveBeenCalledWith("ticket-token-1", "user_1");
    expect(mocks.requestLink).toHaveBeenCalledWith(expect.objectContaining({ rsvpId: "rsvp_1", eventId: "event_1" }));
    expect(mocks.rateLimit).toHaveBeenCalledWith("invite", "submission-link:rsvp_1");
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "SUBMISSION_LINK_REQUESTED", targetId: "rsvp_1" }));
    expect(JSON.stringify(mocks.audit.mock.calls)).not.toContain("ticket-token-1");
  });

  it("refuses an unknown ticket or someone else's account registration", async () => {
    mocks.byTicket.mockResolvedValue(null);
    expect((await requestSubmissionLinkAction("ticket-token-1")).ok).toBe(false);
    expect((await requestSubmissionLinkAction("bad token!")).ok).toBe(false);
    expect(mocks.requestLink).not.toHaveBeenCalled();
  });

  it("does not audit when the cooldown suppressed the email", async () => {
    mocks.requestLink.mockResolvedValue({ ok: true, data: { sent: false } });
    expect(await requestSubmissionLinkAction("ticket-token-1")).toEqual({ ok: true, data: { sent: false } });
    expect(mocks.audit).not.toHaveBeenCalled();
  });
});

describe("submit confirmation copy", () => {
  it("passes on whether a receipt was queued, and mentions an email only then", async () => {
    mocks.submit.mockResolvedValueOnce({ ok: true, data: { submissionId: "sub_1", status: "SUBMITTED", receiptQueued: false } });
    expect(await submitSubmissionAction({ submissionToken: LINK_TOKEN }, input)).toEqual({ ok: true, data: { status: "SUBMITTED", receiptQueued: false } });
    mocks.submit.mockResolvedValueOnce({ ok: true, data: { submissionId: "sub_1", status: "SUBMITTED", receiptQueued: true } });
    expect(await submitSubmissionAction({ submissionToken: LINK_TOKEN }, input)).toEqual({ ok: true, data: { status: "SUBMITTED", receiptQueued: true } });
    expect(submittedMessage(false)).not.toMatch(/email/i);
    expect(submittedMessage(true)).toMatch(/emailed a confirmation/);
  });
});
