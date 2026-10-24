import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  rateLimit: vi.fn(),
  resolveJudge: vi.fn(),
  saveScores: vi.fn(),
  submitReview: vi.fn(),
  loadSubmission: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/actionRateLimit", () => ({ isActionRateLimited: mocks.rateLimit }));
vi.mock("@/lib/judgingAccess", () => ({ resolveJudgeContext: mocks.resolveJudge }));
vi.mock("@/lib/core/judging", () => ({
  saveJudgeScores: mocks.saveScores,
  submitJudgeReview: mocks.submitReview,
  loadSubmissionForJudge: mocks.loadSubmission,
}));

import { saveJudgeReviewAction } from "@/app/actions/judging";

const scope = { organisationSlug: "org", eventId: "event_1" };
const scores = [{ criterionId: "crit_1", score: 3 }];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ user: { id: "judge_1" } });
  mocks.rateLimit.mockResolvedValue(false);
  mocks.resolveJudge.mockResolvedValue({ userId: "judge_1", organisationId: "org_1", orgSlug: "org", eventId: "event_1", eventSlug: "hack", isAdmin: false });
  mocks.saveScores.mockResolvedValue({ ok: true, data: { scored: 1, total: 2 } });
  mocks.submitReview.mockResolvedValue({ ok: true, data: { submitted: false } });
});

describe("saveJudgeReviewAction", () => {
  it("refuses an over-long comment before writing any score (no half-saved review)", async () => {
    const result = await saveJudgeReviewAction({ ...scope, submissionId: "sub_1", scores, comment: "x".repeat(2001), submit: false });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors?.comment?.[0]).toMatch(/2000/);
    expect(mocks.saveScores).not.toHaveBeenCalled();
    expect(mocks.submitReview).not.toHaveBeenCalled();
  });

  it("saves scores then the review when the input is valid", async () => {
    const result = await saveJudgeReviewAction({ ...scope, submissionId: "sub_1", scores, comment: "Good", submit: false });
    expect(result).toEqual({ ok: true, data: { scored: 1, total: 2, submitted: false } });
    expect(mocks.saveScores).toHaveBeenCalledOnce();
    expect(mocks.submitReview).toHaveBeenCalledWith(expect.anything(), { submissionId: "sub_1", comment: "Good", submit: false });
  });
});
