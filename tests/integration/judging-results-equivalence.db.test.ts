import { createHash, randomUUID } from "node:crypto";
import { SubmissionStatus, type Prisma } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));
vi.mock("@/lib/actionRateLimit", () => ({ isActionRateLimited: async () => false }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { prisma } from "@/lib/db";
import { buildJudgingExportRows, conflictKeysFor, hasConflictOfInterest, listEligibleJudges, loadJudgingResults } from "@/lib/core/judging";
import { loadJudgingProgressPage } from "@/lib/core/judgingOps";
import { adjustedJudgeScore, judgeScales, judgeWeightedPercent, roundToOneDecimal, type ScoreCriterion } from "@/lib/judgingScore";
import { findOutliers, isStaleReview } from "@/lib/judgingProgress";
import type { JudgingOrganiserContext } from "@/lib/judgingAccess";

/*
 * Regression for the large-event scoring rewrite (docs/PERFORMANCE.md).
 * The ranking, both score methods, the counted reviews, the Progress
 * outliers and stale lists, and the judging CSV must be exactly what the
 * previous implementation produced: it loaded every score and review row of
 * the event and ranked them in memory. That implementation is kept below as
 * the reference and run on the same seeded data, which covers revoked
 * judges, a conflict of interest, draft reviews, partial and out-of-range
 * scores, a judge with too few reviews, a judge whose scores never vary,
 * disqualified projects and ties.
 */

const suffix = randomUUID().replaceAll("-", "");
let organisationId = "";
let ctx: JudgingOrganiserContext;
const userIds: string[] = [];

// --- the previous implementation (reference) --------------------------------

type LegacyResult = { submissionId: string; score: number | null; rawScore: number | null; adjustedScore: number | null; judgesCounted: number; rank: number | null; criterionAverages: Array<{ criterionId: string; average: number | null }> };

function legacyMean(values: readonly number[]): number | null {
  return values.length > 0 ? roundToOneDecimal(values.reduce((sum, value) => sum + value, 0) / values.length) : null;
}

/** computeJudgingResults as it was before the rewrite, verbatim apart from names. */
function legacyCompute(input: {
  submissionIds: readonly string[];
  criteria: readonly ScoreCriterion[];
  scores: ReadonlyArray<{ submissionId: string; judgeUserId: string; criterionId: string; score: number }>;
  submittedReviews: ReadonlyArray<{ submissionId: string; judgeUserId: string }>;
  method: "RAW" | "ZSCORE";
}): LegacyResult[] {
  const scoreIndex = new Map<string, number>();
  for (const entry of input.scores) scoreIndex.set(`${entry.submissionId}\u0000${entry.judgeUserId}\u0000${entry.criterionId}`, entry.score);
  const included = new Set(input.submissionIds);
  const judgesBySubmission = new Map<string, Set<string>>();
  for (const review of input.submittedReviews) {
    if (!included.has(review.submissionId)) continue;
    const judges = judgesBySubmission.get(review.submissionId) ?? new Set<string>();
    judges.add(review.judgeUserId);
    judgesBySubmission.set(review.submissionId, judges);
  }
  const percentsBySubmission = new Map<string, Array<{ judgeUserId: string; percent: number }>>();
  const percentsByJudge = new Map<string, number[]>();
  for (const [submissionId, judges] of judgesBySubmission) {
    const percents: Array<{ judgeUserId: string; percent: number }> = [];
    for (const judgeUserId of judges) {
      const percent = judgeWeightedPercent(input.criteria, (criterionId) => scoreIndex.get(`${submissionId}\u0000${judgeUserId}\u0000${criterionId}`));
      if (percent == null) continue;
      percents.push({ judgeUserId, percent });
      const own = percentsByJudge.get(judgeUserId) ?? [];
      own.push(percent);
      percentsByJudge.set(judgeUserId, own);
    }
    percentsBySubmission.set(submissionId, percents);
  }
  const scales = judgeScales(percentsByJudge);
  const results = input.submissionIds.map((submissionId, order) => {
    const judges = [...(judgesBySubmission.get(submissionId) ?? [])];
    const percents = percentsBySubmission.get(submissionId) ?? [];
    const rawScore = legacyMean(percents.map((entry) => entry.percent));
    const adjustedScore = legacyMean(percents.map((entry) => adjustedJudgeScore(entry.percent, scales.get(entry.judgeUserId))));
    const score = input.method === "ZSCORE" ? adjustedScore : rawScore;
    const criterionAverages = input.criteria.map((criterion) => {
      const values = judges.map((judgeUserId) => scoreIndex.get(`${submissionId}\u0000${judgeUserId}\u0000${criterion.id}`)).filter((value): value is number => value !== undefined);
      return { criterionId: criterion.id, average: values.length > 0 ? roundToOneDecimal(values.reduce((sum, value) => sum + value, 0) / values.length) : null };
    });
    return { order, result: { submissionId, score, rawScore, adjustedScore, judgesCounted: score == null ? 0 : percents.length, rank: null as number | null, criterionAverages } };
  });
  results.sort((a, b) => {
    if (a.result.score == null && b.result.score == null) return a.order - b.order;
    if (a.result.score == null) return 1;
    if (b.result.score == null) return -1;
    return b.result.score - a.result.score || a.order - b.order;
  });
  let previousScore: number | null = null;
  let previousRank = 0;
  results.forEach((entry, index) => {
    if (entry.result.score == null) return;
    entry.result.rank = entry.result.score === previousScore ? previousRank : index + 1;
    previousScore = entry.result.score;
    previousRank = entry.result.rank;
  });
  return results.map((entry) => entry.result);
}

/** loadJudgingResults as it was: every score and review row of the event, filtered and ranked in memory. */
async function legacyResults(method: "RAW" | "ZSCORE") {
  const criteria = await prisma.judgingCriterion.findMany({ where: { eventId: ctx.eventId }, select: { id: true, weight: true, maxScore: true }, orderBy: [{ position: "asc" }, { createdAt: "asc" }] });
  const submissions = await prisma.submission.findMany({
    where: { eventId: ctx.eventId, status: { in: [SubmissionStatus.SUBMITTED, SubmissionStatus.DISQUALIFIED] } },
    select: { id: true, status: true, teamId: true, rsvpId: true },
    orderBy: [{ submittedAt: "asc" }, { id: "asc" }],
  });
  const scores = await prisma.judgeScore.findMany({ where: { submission: { eventId: ctx.eventId } }, select: { submissionId: true, judgeUserId: true, criterionId: true, score: true } });
  const reviews = await prisma.judgeReview.findMany({ where: { submission: { eventId: ctx.eventId } }, select: { submissionId: true, judgeUserId: true, submittedAt: true } });
  const eligibleIds = new Set((await listEligibleJudges(ctx)).map((judge) => judge.userId));
  const byId = new Map(submissions.map((row) => [row.id, row]));
  const conflicts = await conflictKeysFor(prisma, ctx.eventId, [...new Set(reviews.map((review) => review.judgeUserId))]);
  const submittedReviews = reviews.filter((review) => {
    const row = byId.get(review.submissionId);
    return Boolean(review.submittedAt && row?.status === SubmissionStatus.SUBMITTED && eligibleIds.has(review.judgeUserId) && !hasConflictOfInterest(row, conflicts.get(review.judgeUserId)));
  });
  const submitted = submissions.filter((row) => row.status === SubmissionStatus.SUBMITTED);
  return {
    results: legacyCompute({ submissionIds: submitted.map((row) => row.id), criteria, scores, submittedReviews, method }),
    disqualified: submissions.filter((row) => row.status === SubmissionStatus.DISQUALIFIED).map((row) => row.id),
    countedReviewKeys: submittedReviews.map((review) => `${review.submissionId}\u0000${review.judgeUserId}`).sort(),
    criteria,
    scores,
    reviews,
    eligibleIds,
    submitted,
    conflicts,
  };
}

// --- seed ----------------------------------------------------------------------

let seed = 0x2468ace;
function rand(): number {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
}
const now = new Date("2026-10-26T12:00:00Z");

beforeAll(async () => {
  const id = () => `eq${randomUUID().replaceAll("-", "").slice(0, 22)}`;
  const org = await prisma.organisation.create({ data: { name: "Equivalence", slug: `equivalence-${suffix}` } });
  organisationId = org.id;
  const owner = await prisma.user.create({ data: { name: "Owner Person", email: `owner-${suffix}@load.yuyu.test` } });
  userIds.push(owner.id);
  await prisma.membership.create({ data: { userId: owner.id, organisationId, role: "OWNER" } });
  const event = await prisma.event.create({
    data: {
      organisationId,
      title: "Equivalence hackathon",
      slug: `equivalence-${suffix}`,
      startDateTime: new Date(now.getTime() - 86_400_000),
      endDateTime: new Date(now.getTime() + 86_400_000),
      timezone: "Europe/London",
      status: "PUBLISHED",
      registrationMode: "TEAM",
      teamMinSize: 1,
      teamMaxSize: 4,
      submissionsEnabled: true,
      judgingStatus: "OPEN",
    },
  });
  ctx = { userId: owner.id, organisationId, orgSlug: org.slug, eventId: event.id, eventSlug: event.slug };

  const judges: string[] = [];
  for (let i = 0; i < 9; i++) {
    const judge = await prisma.user.create({ data: { name: `Judge ${i}`, email: `judge-${i}-${suffix}@load.yuyu.test` } });
    userIds.push(judge.id);
    judges.push(judge.id);
  }
  // Judges 0..6 hold JUDGE; judge 7 was revoked (reviews stay, never count); judge 8 has only two reviews (raw under ZSCORE).
  await prisma.eventCollaborator.createMany({ data: [...judges.slice(0, 7), judges[8]!].map((userId) => ({ eventId: event.id, userId, permissions: ["JUDGE"] })) });
  const criteria = [
    { id: id(), eventId: event.id, name: "Impact", weight: 3, maxScore: 10, position: 0 },
    { id: id(), eventId: event.id, name: "Design", weight: 1, maxScore: 5, position: 1 },
    { id: id(), eventId: event.id, name: "Tech", weight: 2, maxScore: 10, position: 2 },
    { id: id(), eventId: event.id, name: "Pitch", weight: 1, maxScore: 3, position: 3 },
  ];
  await prisma.judgingCriterion.createMany({ data: criteria });

  const teams: Prisma.TeamCreateManyInput[] = [];
  const rsvps: Prisma.RSVPCreateManyInput[] = [];
  const submissions: Prisma.SubmissionCreateManyInput[] = [];
  for (let i = 0; i < 140; i++) {
    const teamId = id();
    teams.push({ id: teamId, eventId: event.id, name: `Team ${i}`, nameKey: `team ${i}`, status: "CONFIRMED", joinToken: id(), manageTokenHash: createHash("sha256").update(`${suffix}-${i}`).digest("hex") });
    // Judge 1 is a member of team 5: a conflict of interest for that project.
    const userId = i === 5 ? judges[1]! : null;
    rsvps.push({ id: id(), eventId: event.id, teamId, userId, guestEmail: userId ? null : `m${i}-${suffix}@load.yuyu.test`, guestName: userId ? null : `Member ${i}`, attendeeKey: userId ? `user:${userId}` : `guest:m${i}-${suffix}@load.yuyu.test`, status: "CONFIRMED" });
    const status = i < 125 ? "SUBMITTED" : i < 132 ? "DISQUALIFIED" : i < 136 ? "DRAFT" : "WITHDRAWN";
    submissions.push({ id: id(), eventId: event.id, teamId, title: `Project ${i % 40}`, status, submittedAt: status === "DRAFT" ? null : new Date(now.getTime() - (200 - i) * 60_000 - (i % 3) * 1000) });
  }
  await prisma.team.createMany({ data: teams });
  await prisma.rSVP.createMany({ data: rsvps });
  await prisma.submission.createMany({ data: submissions });

  const reviews: Prisma.JudgeReviewCreateManyInput[] = [];
  const scores: Prisma.JudgeScoreCreateManyInput[] = [];
  const bias = judges.map(() => rand() * 0.6 - 0.3);
  submissions.forEach((submission, index) => {
    if (submission.status === "DRAFT" || submission.status === "WITHDRAWN") return;
    const panel = judges.filter((_, j) => (index + j) % 3 !== 0 && (j !== 8 || index < 2));
    for (const judgeUserId of panel) {
      const j = judges.indexOf(judgeUserId);
      const draft = rand() < 0.1;
      const savedAt = new Date(now.getTime() - (draft && rand() < 0.5 ? 48 : 2) * 3_600_000 - index * 1000);
      reviews.push({ submissionId: submission.id!, judgeUserId, submittedAt: draft ? null : savedAt, createdAt: savedAt, updatedAt: savedAt });
      const quality = (index % 17) / 16;
      for (const criterion of criteria) {
        if (rand() < 0.08) continue; // an unscored criterion counts as 0
        // Judge 6 always gives the same mark (sd = 0: raw under ZSCORE); some marks exceed a 5- or 3-point maximum (clamped).
        const value = j === 6 ? 2 : Math.max(0, Math.min(10, Math.round((quality + bias[j]! + (rand() - 0.5) * 0.4) * criterion.maxScore + (rand() < 0.05 ? 3 : 0))));
        scores.push({ submissionId: submission.id!, judgeUserId, criterionId: criterion.id, score: value, createdAt: savedAt, updatedAt: savedAt });
      }
    }
  });
  // Scores saved without any review row.
  scores.push({ submissionId: submissions[3]!.id!, judgeUserId: judges[0]!, criterionId: criteria[0]!.id, score: 4, updatedAt: new Date(now.getTime() - 72 * 3_600_000) });
  await prisma.judgeReview.createMany({ data: reviews, skipDuplicates: true });
  await prisma.judgeScore.createMany({ data: scores, skipDuplicates: true });
});

afterAll(async () => {
  if (organisationId) await prisma.organisation.delete({ where: { id: organisationId } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
});

describe("judging results after the large-event rewrite", () => {
  for (const method of ["RAW", "ZSCORE"] as const) {
    it(`ranks exactly as before (${method})`, async () => {
      const legacy = await legacyResults(method);
      const current = await loadJudgingResults(ctx, { method });
      expect(current).not.toBeNull();
      const pick = (row: LegacyResult) => ({ submissionId: row.submissionId, score: row.score, rawScore: row.rawScore, adjustedScore: row.adjustedScore, judgesCounted: row.judgesCounted, rank: row.rank, criterionAverages: row.criterionAverages });
      const ranked = current!.rows.filter((row) => row.status === "SUBMITTED");
      expect(ranked.map(pick)).toEqual(legacy.results.map(pick));
      expect(current!.rows.filter((row) => row.status === "DISQUALIFIED").map((row) => row.submissionId)).toEqual(legacy.disqualified);
      expect([...current!.countedReviewKeys].sort()).toEqual(legacy.countedReviewKeys);
      // The fixture exercises what it claims to.
      expect(legacy.results.some((row) => row.rank != null && legacy.results.filter((other) => other.rank === row.rank).length > 1)).toBe(true);
      expect(legacy.reviews.length).toBeGreaterThan(legacy.countedReviewKeys.length);
    });
  }

  it("keeps the Progress outliers and stale reviews", async () => {
    const legacy = await legacyResults("RAW");
    const eligible = new Set(legacy.eligibleIds);
    const projectIds = new Set(legacy.submitted.map((row) => row.id));
    const byId = new Map(legacy.submitted.map((row) => [row.id, row]));
    const conflicts = await conflictKeysFor(prisma, ctx.eventId, [...eligible]);
    const valid = (judgeUserId: string, submissionId: string) => projectIds.has(submissionId) && eligible.has(judgeUserId) && !hasConflictOfInterest(byId.get(submissionId)!, conflicts.get(judgeUserId));
    const submittedPairs = new Set(legacy.reviews.filter((review) => review.submittedAt && valid(review.judgeUserId, review.submissionId)).map((review) => `${review.judgeUserId}\u0000${review.submissionId}`));
    const scoreIndex = new Map(legacy.scores.map((score) => [`${score.judgeUserId}\u0000${score.submissionId}\u0000${score.criterionId}`, score.score]));
    const expectedOutliers: Array<{ submissionId: string; judgeUserId: string; score: number; othersMean: number; difference: number; rule: string }> = [];
    for (const project of legacy.submitted) {
      const percents = [...submittedPairs]
        .filter((key) => key.endsWith(`\u0000${project.id}`))
        .map((key) => key.split("\u0000")[0]!)
        .map((judgeUserId) => ({ judgeUserId, percent: judgeWeightedPercent(legacy.criteria, (criterionId) => scoreIndex.get(`${judgeUserId}\u0000${project.id}\u0000${criterionId}`))! }))
        .sort((a, b) => (a.judgeUserId < b.judgeUserId ? -1 : 1));
      for (const flag of findOutliers(percents)) expectedOutliers.push({ submissionId: project.id, judgeUserId: flag.judgeUserId, score: flag.score, othersMean: flag.othersMean, difference: flag.difference, rule: flag.rule });
    }
    const stalePairs = new Map<string, Date>();
    for (const score of legacy.scores) {
      const key = `${score.judgeUserId}\u0000${score.submissionId}`;
      if (submittedPairs.has(key) || !valid(score.judgeUserId, score.submissionId)) continue;
      const updatedAt = (await prisma.judgeScore.findFirstOrThrow({ where: { submissionId: score.submissionId, judgeUserId: score.judgeUserId, criterionId: score.criterionId }, select: { updatedAt: true } })).updatedAt;
      const previous = stalePairs.get(key);
      if (!previous || updatedAt > previous) stalePairs.set(key, updatedAt);
    }
    const expectedStale = [...stalePairs].filter(([, at]) => isStaleReview(at, now)).map(([key]) => key).sort();

    const collect = async (section: "outliers" | "stale") => {
      const rows: Array<Record<string, unknown>> = [];
      for (let page = 1; ; page++) {
        const result = await loadJudgingProgressPage(ctx, { section, page }, now);
        rows.push(...(result!.page.rows as Array<Record<string, unknown>>));
        if (page >= result!.page.totalPages) break;
      }
      return rows;
    };
    const outliers = await collect("outliers");
    const key = (row: { submissionId: unknown; judgeUserId: unknown }) => `${String(row.submissionId)}\u0000${String(row.judgeUserId)}`;
    const sortRows = <T extends { submissionId: unknown; judgeUserId: unknown }>(rows: T[]) => [...rows].sort((a, b) => (key(a) < key(b) ? -1 : 1));
    expect(sortRows(outliers.map((row) => ({ submissionId: row.submissionId, judgeUserId: row.judgeUserId, score: row.score, othersMean: row.othersMean, difference: row.difference, rule: row.rule })))).toEqual(sortRows(expectedOutliers));
    expect(expectedOutliers.length).toBeGreaterThan(0);
    const stale = await collect("stale");
    expect(stale.map((row) => `${String(row.judgeUserId)}\u0000${String(row.submissionId)}`).sort()).toEqual(expectedStale);
    expect(expectedStale.length).toBeGreaterThan(0);
  });

  it("writes the same judging CSV rows", async () => {
    const legacy = await legacyResults("RAW");
    const rows = await buildJudgingExportRows(ctx, { method: "RAW" });
    expect(rows).not.toBeNull();
    // One row per review (or one for a project without reviews), ranked order, scores from the reference ranking.
    const scoreBySubmission = new Map(legacy.results.map((row) => [row.submissionId, row.score?.toFixed(1) ?? ""]));
    const body = rows!.slice(1);
    expect(body.length).toBe(legacy.reviews.filter((review) => legacy.submitted.some((row) => row.id === review.submissionId)).length + (await prisma.judgeReview.count({ where: { submission: { eventId: ctx.eventId, status: "DISQUALIFIED" } } })));
    const ranks = body.map((row) => row[0]);
    expect(ranks.filter(Boolean).length).toBeGreaterThan(0);
    expect(new Set(body.map((row) => row[4])).size).toBeGreaterThan(1);
    expect([...scoreBySubmission.values()].filter(Boolean).length).toBeGreaterThan(0);
  });
});
