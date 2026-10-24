import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  rateLimit: vi.fn(),
  audit: vi.fn(),
  revalidatePath: vi.fn(),
  resolveOrganiser: vi.fn(),
  eventFindUnique: vi.fn(),
  updateSettings: vi.fn(),
  setStatus: vi.fn(),
  disqualify: vi.fn(),
  setWinner: vi.fn(),
  publish: vi.fn(),
  reviews: vi.fn(),
  exportRows: vi.fn(),
  listSubmissions: vi.fn(),
  resultsPage: vi.fn(),
  awardCandidates: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/actionRateLimit", () => ({ isActionRateLimited: mocks.rateLimit }));
vi.mock("@/lib/audit", () => ({ recordAuditEvent: mocks.audit }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/judgingAccess", () => ({ resolveJudgingOrganiser: mocks.resolveOrganiser }));
vi.mock("@/lib/db", () => ({ prisma: { event: { findUnique: mocks.eventFindUnique } } }));
vi.mock("@/lib/core/judging", () => ({
  updateJudgingSettings: mocks.updateSettings,
  setJudgingStatus: mocks.setStatus,
  disqualifySubmission: mocks.disqualify,
  setAwardWinner: mocks.setWinner,
  publishResults: mocks.publish,
  loadSubmissionReviewsForOrganiser: mocks.reviews,
  buildJudgingExportRows: mocks.exportRows,
  listSubmissionsForOrganiser: mocks.listSubmissions,
  loadJudgingResultsPage: mocks.resultsPage,
  searchAwardCandidates: mocks.awardCandidates,
}));

import {
  changeJudgingStatus,
  disqualifyProject,
  loadProjectReviews,
  loadResultsPage,
  loadSubmissionsPage,
  publishJudgingResults,
  saveJudgingSettings,
  searchAwardCandidates,
  setEventAwardWinner,
} from "@/app/actions/judging-admin";
import { GET } from "@/app/api/exports/events/[eventId]/judging/route";

const scope = { organisationSlug: "club", eventId: "event_1" };
const organiser = { userId: "user_1", organisationId: "org_1", orgSlug: "club", eventId: "event_1", eventSlug: "hack" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ user: { id: "user_1" } });
  mocks.rateLimit.mockResolvedValue(false);
  mocks.audit.mockResolvedValue(undefined);
  mocks.resolveOrganiser.mockResolvedValue(organiser);
  mocks.setStatus.mockResolvedValue({ ok: true, data: { judgingStatus: "OPEN" } });
  mocks.disqualify.mockResolvedValue({ ok: true, data: undefined });
  mocks.setWinner.mockResolvedValue({ ok: true, data: undefined });
  mocks.publish.mockResolvedValue({ ok: true, data: { publishedAt: new Date(), queued: 3, alreadyPublished: false } });
});

describe("organiser judging actions", () => {
  it("refuses signed-out callers before resolving anything", async () => {
    mocks.auth.mockResolvedValue(null);
    const res = await changeJudgingStatus({ ...scope, status: "OPEN" });
    expect(res.ok).toBe(false);
    expect(mocks.resolveOrganiser).not.toHaveBeenCalled();
    expect(mocks.setStatus).not.toHaveBeenCalled();
  });

  it("refuses anyone who is not an organisation owner or admin (judges included)", async () => {
    mocks.resolveOrganiser.mockResolvedValue(null);
    const res = await disqualifyProject({ ...scope, submissionId: "sub_1", reason: "Plagiarised" });
    expect(res).toEqual({ ok: false, error: expect.stringContaining("permission") });
    expect(mocks.resolveOrganiser).toHaveBeenCalledWith("user_1", "club", "event_1");
    expect(mocks.disqualify).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("rejects a missing scope without touching the session", async () => {
    const res = await changeJudgingStatus({ status: "OPEN" });
    expect(res.ok).toBe(false);
    expect(mocks.auth).not.toHaveBeenCalled();
  });

  it("stops when rate limited", async () => {
    mocks.rateLimit.mockResolvedValue(true);
    const res = await changeJudgingStatus({ ...scope, status: "OPEN" });
    expect(res.ok).toBe(false);
    expect(mocks.setStatus).not.toHaveBeenCalled();
  });

  it("passes only the expected fields to the core and revalidates on success", async () => {
    await setEventAwardWinner({ ...scope, awardId: "award_1", submissionId: "sub_1", place: "2", extra: "ignored" });
    expect(mocks.setWinner).toHaveBeenCalledWith(organiser, { awardId: "award_1", submissionId: "sub_1", place: "2" });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/dashboard/club/event/event_1");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/club/hack/results");
  });

  it("does not audit again: the cores own the judging audit events", async () => {
    await disqualifyProject({ ...scope, submissionId: "sub_1", reason: "Plagiarised" });
    await changeJudgingStatus({ ...scope, status: "CLOSED" });
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("returns core failures unchanged and skips revalidation", async () => {
    mocks.updateSettings.mockResolvedValue({ ok: false, error: "Check the highlighted fields.", fieldErrors: { submissionsCloseAt: ["Submissions must close after they open."] } });
    const res = await saveJudgingSettings({ ...scope, settings: { submissionsEnabled: true, submissionsOpenAt: "2030-01-02T00:00:00.000Z", submissionsCloseAt: "2030-01-01T00:00:00.000Z", judgesSeeAll: true, projectGalleryPublic: false } });
    expect(res).toEqual({ ok: false, error: "Check the highlighted fields.", fieldErrors: { submissionsCloseAt: ["Submissions must close after they open."] } });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("publishes results under the broadcast rate-limit bucket", async () => {
    const res = await publishJudgingResults(scope);
    expect(res).toEqual({ ok: true, data: { queued: 3, alreadyPublished: false } });
    expect(mocks.rateLimit).toHaveBeenCalledWith("broadcast", "user_1");
  });

  it("serialises reviews for the browser", async () => {
    mocks.reviews.mockResolvedValue([{ judgeName: "Ada", submittedAt: new Date("2030-01-01T00:00:00.000Z"), comment: "Nice", scores: [{ criterionId: "c1", score: 4 }] }]);
    const res = await loadProjectReviews({ ...scope, submissionId: "sub_1" });
    expect(res).toEqual({ ok: true, data: [{ judgeName: "Ada", submittedAt: "2030-01-01T00:00:00.000Z", comment: "Nice", scores: [{ criterionId: "c1", score: 4 }] }] });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});

describe("organiser judging paged reads", () => {
  it("refuses non-organisers before reading any page", async () => {
    mocks.resolveOrganiser.mockResolvedValue(null);
    for (const read of [loadSubmissionsPage, loadResultsPage, searchAwardCandidates]) {
      expect(await read({ ...scope, query: "x" })).toEqual({ ok: false, error: expect.stringContaining("permission") });
    }
    expect(mocks.listSubmissions).not.toHaveBeenCalled();
    expect(mocks.resultsPage).not.toHaveBeenCalled();
    expect(mocks.awardCandidates).not.toHaveBeenCalled();
  });

  it("uses the search rate-limit bucket and never revalidates", async () => {
    mocks.listSubmissions.mockResolvedValue({ submissions: [], nextCursor: null });
    await loadSubmissionsPage({ ...scope, status: "SUBMITTED" });
    expect(mocks.rateLimit).toHaveBeenCalledWith("search", "user_1");
    mocks.rateLimit.mockResolvedValue(true);
    expect(await loadResultsPage({ ...scope, page: 2 })).toEqual({ ok: false, error: "Too many searches. Try again shortly." });
    expect(mocks.resultsPage).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("passes only the paging fields to the cores and serialises the rows", async () => {
    mocks.listSubmissions.mockResolvedValue({
      submissions: [
        { id: "sub_1", title: "Byte", summary: "", entrantName: "Ada L.", isTeam: false, repoUrl: null, demoUrl: null, videoUrl: null, status: "SUBMITTED", submittedAt: new Date("2030-01-01T00:00:00.000Z"), updatedAt: new Date("2030-01-02T00:00:00.000Z"), disqualifiedReason: null, assignedJudgeIds: ["j1"] },
      ],
      nextCursor: "1.sub_1",
    });
    const res = await loadSubmissionsPage({ ...scope, status: "SUBMITTED", query: "byte", cursor: "0.sub_0", eventSlug: "ignored" });
    expect(mocks.listSubmissions).toHaveBeenCalledWith(organiser, { query: "byte", status: "SUBMITTED", cursor: "0.sub_0" });
    expect(res).toMatchObject({ ok: true, data: { nextCursor: "1.sub_1", submissions: [{ id: "sub_1", submittedAt: "2030-01-01T00:00:00.000Z", updatedAt: "2030-01-02T00:00:00.000Z" }] } });

    mocks.resultsPage.mockResolvedValue({ rows: [], page: 2, totalPages: 2, total: 60, start: 50, pageSize: 50, query: "", rankedTotal: 60, criteria: [] });
    expect(await loadResultsPage({ ...scope, page: 2 })).toEqual({ ok: true, data: { rows: [], page: 2, totalPages: 2, total: 60, start: 50, pageSize: 50, query: "", rankedTotal: 60 } });
    expect(mocks.resultsPage).toHaveBeenCalledWith(organiser, { query: "", page: 2 });

    mocks.awardCandidates.mockResolvedValue({ rows: [{ submissionId: "sub_1", title: "Byte", entrantName: "Ada L.", rank: 1, score: 80 }], total: 21, nextOffset: 20 });
    expect(await searchAwardCandidates({ ...scope, query: "by" })).toEqual({ ok: true, data: { candidates: [{ submissionId: "sub_1", title: "Byte", entrantName: "Ada L.", rank: 1, score: 80 }], total: 21, nextOffset: 20 } });
    expect(mocks.awardCandidates).toHaveBeenCalledWith(organiser, { query: "by", offset: 0 });
  });

  it("reports invalid paging input", async () => {
    mocks.resultsPage.mockResolvedValue(null);
    mocks.awardCandidates.mockResolvedValue(null);
    expect(await loadResultsPage({ ...scope, page: -1 })).toEqual({ ok: false, error: "Invalid input." });
    expect(await searchAwardCandidates({ ...scope, offset: "x" })).toEqual({ ok: false, error: "Invalid input." });
  });
});

describe("judging scores CSV export route", () => {
  const routeContext = { params: Promise.resolve({ eventId: "event_1" }) };
  const request = new Request("https://events.example.test/api/exports/events/event_1/judging");

  beforeEach(() => {
    mocks.eventFindUnique.mockResolvedValue({ id: "event_1", title: "Hack Night", organisation: { slug: "club" } });
    mocks.exportRows.mockResolvedValue([
      ["Rank", "Project", "Entrant"],
      ["1", "=HYPERLINK(\"https://evil.example\")", "@team"],
    ]);
  });

  it("returns a bare 404 to signed-out users", async () => {
    mocks.auth.mockResolvedValue(null);
    const response = await GET(request, routeContext);
    expect(response.status).toBe(404);
    expect(mocks.exportRows).not.toHaveBeenCalled();
  });

  it("returns a bare 404 to anyone who cannot manage judging", async () => {
    mocks.resolveOrganiser.mockResolvedValue(null);
    const response = await GET(request, routeContext);
    expect(response.status).toBe(404);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(mocks.exportRows).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("exports formula-safe CSV, uncached, and audits the export", async () => {
    const response = await GET(request, routeContext);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Content-Disposition")).toMatch(/^attachment; filename="judging_Hack_Night_/);
    const body = await response.text();
    expect(body).toContain(`"'=HYPERLINK(""https://evil.example"")"`);
    expect(body).toContain("'@team");
    expect(mocks.resolveOrganiser).toHaveBeenCalledWith("user_1", "club", "event_1");
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "JUDGING_SCORES_EXPORTED", organisationId: "org_1", targetId: "event_1" }));
  });
});
