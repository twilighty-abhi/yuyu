import { randomUUID } from "node:crypto";
import { EventPermission, EventStatus, JudgingStatus, MembershipRole, RegistrationMode, RsvpStatus, SoloPolicy, SubmissionStatus, type Event } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));
vi.mock("@/lib/actionRateLimit", () => ({ isActionRateLimited: async () => false }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { prisma } from "@/lib/db";
import { resolveJudgeContext, resolveJudgingOrganiser, type JudgeContext, type JudgingOrganiserContext } from "@/lib/judgingAccess";
import {
  buildJudgingExportRows,
  loadJudgingResults,
  loadJudgingResultsPage,
  nextSubmissionForJudge,
  saveJudgeScores,
  searchAwardCandidates,
  setScoreNormalization,
  submitJudgeReview,
} from "@/lib/core/judging";

/*
 * "Adjust for harsh/generous judges" (Event.scoreNormalization, ZSCORE in
 * lib/judgingScore.ts) and "Score next project" (nextSubmissionForJudge),
 * end to end against PostgreSQL (docs/HACKATHON.md).
 *
 * One criterion out of 10, weight 1, so a judge score is score × 10. Harsh
 * judge H scores a=30, b=40, c=50; generous judge G scores d=80, e=90,
 * f=100. Both have mean ± 8.16 (population sd), so each judge's best project
 * adjusts to 68.4, their middle to 50, and their lowest to 31.6.
 */

const suffix = randomUUID().replaceAll("-", "");
const orgSlug = `jnorm-${suffix}`;
const otherOrgSlug = `jnorm-other-${suffix}`;
const MINUTE = 60_000;
const base = Date.UTC(2030, 0, 1, 9, 0, 0, 0);

let organisationId = "";
let otherOrganisationId = "";
const userIds: string[] = [];
const ids: Record<string, string> = {};
let event: Event;
let otherEvent: Event;
let criterionId = "";
let owner: JudgingOrganiserContext;
const users: Record<"owner" | "harsh" | "generous" | "next" | "conflicted" | "revoked" | "outsider" | "otherAdmin", string> = {
  owner: "",
  harsh: "",
  generous: "",
  next: "",
  conflicted: "",
  revoked: "",
  outsider: "",
  otherAdmin: "",
};

async function createEvent(orgId: string, label: string): Promise<Event> {
  return prisma.event.create({
    data: {
      organisationId: orgId,
      title: `Normalise ${label} ${suffix}`,
      slug: `jnorm-${label}-${suffix}`,
      startDateTime: new Date(Date.now() - 48 * 60 * MINUTE),
      endDateTime: new Date(Date.now() - 24 * 60 * MINUTE),
      timezone: "UTC",
      status: EventStatus.PUBLISHED,
      registrationMode: RegistrationMode.TEAM,
      teamMaxSize: 4,
      soloPolicy: SoloPolicy.SOLO_ALLOWED,
      submissionsEnabled: true,
      submissionsOpenAt: new Date(Date.now() - 4 * 60 * MINUTE),
      submissionsCloseAt: new Date(Date.now() - 60 * MINUTE),
      judgingStatus: JudgingStatus.OPEN,
      judgesSeeAll: true,
      page: { create: { isPublished: true } },
    },
  });
}

async function soloSubmission(target: Event, label: string, minute: number): Promise<string> {
  const rsvp = await prisma.rSVP.create({
    data: { eventId: target.id, guestName: `${label} Person`, guestEmail: `${randomUUID()}@example.test`, attendeeKey: `guest:${randomUUID()}@example.test`, status: RsvpStatus.CONFIRMED },
  });
  const submission = await prisma.submission.create({
    data: { eventId: target.id, rsvpId: rsvp.id, title: `Project ${label}`, status: SubmissionStatus.SUBMITTED, submittedAt: new Date(base + minute * MINUTE) },
  });
  return submission.id;
}

async function judgeCtx(userId: string): Promise<JudgeContext> {
  const ctx = await resolveJudgeContext(userId, orgSlug, event.id);
  if (!ctx) throw new Error("judge context missing");
  return ctx;
}

/** Score the single criterion and submit the review through the cores. */
async function review(userId: string, submissionId: string, score: number) {
  const ctx = await judgeCtx(userId);
  expect(await saveJudgeScores(ctx, { submissionId, scores: [{ criterionId, score }] })).toMatchObject({ ok: true });
  expect(await submitJudgeReview(ctx, { submissionId })).toMatchObject({ ok: true, data: { submitted: true } });
}

async function nextFor(userId: string) {
  const result = await nextSubmissionForJudge(await judgeCtx(userId));
  return { id: result?.next?.submission.id ?? null, remaining: result?.remaining };
}

describe.sequential("judge normalisation and score-next", () => {
  beforeAll(async () => {
    const org = await prisma.organisation.create({ data: { name: `Normalise ${suffix}`, slug: orgSlug } });
    organisationId = org.id;
    const otherOrg = await prisma.organisation.create({ data: { name: `Normalise other ${suffix}`, slug: otherOrgSlug } });
    otherOrganisationId = otherOrg.id;
    for (const label of Object.keys(users) as Array<keyof typeof users>) {
      const user = await prisma.user.create({ data: { name: `${label} ${suffix.slice(0, 6)}`, email: `${label}-${suffix}@example.test`, emailVerified: new Date() } });
      users[label] = user.id;
      userIds.push(user.id);
    }
    await prisma.membership.create({ data: { userId: users.owner, organisationId, role: MembershipRole.OWNER } });
    await prisma.membership.create({ data: { userId: users.outsider, organisationId, role: MembershipRole.MEMBER } });
    await prisma.membership.create({ data: { userId: users.otherAdmin, organisationId: otherOrganisationId, role: MembershipRole.ADMIN } });

    event = await createEvent(organisationId, "main");
    otherEvent = await createEvent(otherOrganisationId, "other");
    for (const userId of [users.harsh, users.generous, users.next, users.conflicted, users.revoked]) {
      await prisma.eventCollaborator.create({ data: { eventId: event.id, userId, permissions: [EventPermission.JUDGE] } });
    }
    criterionId = (await prisma.judgingCriterion.create({ data: { eventId: event.id, name: "Impact", weight: 1, maxScore: 10, position: 0 } })).id;

    for (const [index, label] of ["a", "b", "c", "d", "e", "f"].entries()) ids[label] = await soloSubmission(event, label, index);
    // The newest project comes from a team the conflicted judge belongs to.
    const team = await prisma.team.create({
      data: { eventId: event.id, name: `Own team ${suffix.slice(0, 6)}`, nameKey: `own team ${suffix.slice(0, 6)}`, status: RsvpStatus.CONFIRMED, joinToken: randomUUID(), manageTokenHash: randomUUID() },
    });
    await prisma.rSVP.create({ data: { eventId: event.id, teamId: team.id, userId: users.conflicted, attendeeKey: `user:${users.conflicted}`, status: RsvpStatus.CONFIRMED } });
    ids.t = (await prisma.submission.create({ data: { eventId: event.id, teamId: team.id, title: "Team project", status: SubmissionStatus.SUBMITTED, submittedAt: new Date(base + 10 * MINUTE) } })).id;
    await soloSubmission(otherEvent, "elsewhere", 0);

    const organiser = await resolveJudgingOrganiser(users.owner, orgSlug, event.id);
    if (!organiser) throw new Error("organiser context missing");
    owner = organiser;

    await review(users.harsh, ids.a!, 3);
    await review(users.harsh, ids.b!, 4);
    await review(users.harsh, ids.c!, 5);
    await review(users.generous, ids.d!, 8);
    await review(users.generous, ids.e!, 9);
    await review(users.generous, ids.f!, 10);
  });

  afterAll(async () => {
    await prisma.organisation.deleteMany({ where: { id: { in: [organisationId, otherOrganisationId].filter(Boolean) } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  const rowsOf = async () => (await loadJudgingResults(owner))?.rows.filter((row) => row.status === SubmissionStatus.SUBMITTED) ?? [];
  const label = (id: string) => Object.entries(ids).find(([, value]) => value === id)?.[0];

  it("ranks by the raw score by default and reports both scores", async () => {
    const results = await loadJudgingResults(owner);
    expect(results?.scoreNormalization).toBe("RAW");
    expect((await rowsOf()).map((row) => [label(row.submissionId), row.rank, row.rawScore, row.adjustedScore, row.score])).toEqual([
      ["f", 1, 100, 68.4, 100],
      ["e", 2, 90, 50, 90],
      ["d", 3, 80, 31.6, 80],
      ["c", 4, 50, 68.4, 50],
      ["b", 5, 40, 50, 40],
      ["a", 6, 30, 31.6, 30],
      ["t", null, null, null, null],
    ]);
  });

  it("switches the ranking to adjusted scores for owners, audited once per change", async () => {
    expect(await setScoreNormalization(owner, "BOGUS")).toMatchObject({ ok: false });
    // Another organisation's context never reaches this event.
    expect(await setScoreNormalization({ ...owner, organisationId: otherOrganisationId }, "ZSCORE")).toMatchObject({ ok: false });
    expect(await resolveJudgingOrganiser(users.otherAdmin, orgSlug, event.id)).toBeNull();
    // Judges cannot reach the organiser context at all.
    expect(await resolveJudgingOrganiser(users.harsh, orgSlug, event.id)).toBeNull();

    expect(await setScoreNormalization(owner, "ZSCORE")).toEqual({ ok: true, data: { scoreNormalization: "ZSCORE" } });
    expect(await setScoreNormalization(owner, "ZSCORE")).toEqual({ ok: true, data: { scoreNormalization: "ZSCORE" } });
    const audits = await prisma.auditEvent.findMany({ where: { action: "JUDGING_SCORE_NORMALIZATION_CHANGED", targetId: event.id } });
    expect(audits).toHaveLength(1);
    expect(audits[0]?.metadata).toEqual({ from: "RAW", to: "ZSCORE" });

    expect((await rowsOf()).map((row) => [label(row.submissionId), row.rank, row.score])).toEqual([
      ["c", 1, 68.4],
      ["f", 1, 68.4],
      ["b", 3, 50],
      ["e", 3, 50],
      ["a", 5, 31.6],
      ["d", 5, 31.6],
      ["t", null, null],
    ]);
    const page = await loadJudgingResultsPage(owner, { page: 1 });
    expect(page?.scoreNormalization).toBe("ZSCORE");
    expect(page?.rows[0]).toMatchObject({ rank: 1, rawScore: 50, adjustedScore: 68.4 });
    // The Awards picker follows the active ranking.
    const candidates = await searchAwardCandidates(owner, { query: "", offset: 0 });
    expect(candidates?.rows.slice(0, 2).map((row) => [label(row.submissionId), row.rank, row.score])).toEqual([
      ["c", 1, 68.4],
      ["f", 1, 68.4],
    ]);
  });

  it("exports both scores in the CSV, with the active one as the result score", async () => {
    const csv = await buildJudgingExportRows(owner);
    expect(csv?.[0]?.slice(0, 8)).toEqual(["Rank", "Project", "Entrant", "Status", "Result score", "Raw score", "Adjusted score", "Judges counted"]);
    const line = csv?.find((row) => row[1] === "Project c");
    expect(line?.slice(0, 8)).toEqual(["1", "Project c", expect.any(String), "SUBMITTED", "68.4", "50.0", "68.4", "1"]);
  });

  it("leaves revoked judges out of each judge's scale, as for raw scores", async () => {
    const before = (await rowsOf()).map((row) => [row.submissionId, row.rawScore, row.adjustedScore]);
    await review(users.revoked, ids.a!, 10);
    await review(users.revoked, ids.b!, 10);
    await review(users.revoked, ids.c!, 0);
    expect((await rowsOf()).find((row) => row.submissionId === ids.c)?.judgesCounted).toBe(2);
    await prisma.eventCollaborator.deleteMany({ where: { eventId: event.id, userId: users.revoked } });
    expect((await rowsOf()).map((row) => [row.submissionId, row.rawScore, row.adjustedScore])).toEqual(before);
  });

  it("picks the project with the fewest reviews, oldest first, for score-next", async () => {
    // a, b, c have two submitted reviews (H and the revoked judge), d, e, f one, t none.
    expect(await nextFor(users.next)).toEqual({ id: ids.t, remaining: 7 });
    // The conflicted judge never gets their own team's project: the oldest of the one-review projects.
    expect(await nextFor(users.conflicted)).toEqual({ id: ids.d, remaining: 6 });
    // A judge who reviewed a project never gets it again.
    expect(await nextFor(users.generous)).toEqual({ id: ids.t, remaining: 4 });
  });

  it("prefers a project the judge already started", async () => {
    const ctx = await judgeCtx(users.next);
    expect(await submitJudgeReview(ctx, { submissionId: ids.e!, comment: "Half way", submit: false })).toMatchObject({ ok: true, data: { submitted: false } });
    expect(await nextFor(users.next)).toEqual({ id: ids.e, remaining: 7 });
    await review(users.next, ids.e!, 6);
    expect(await nextFor(users.next)).toEqual({ id: ids.t, remaining: 6 });
    await review(users.next, ids.t!, 6);
    // Now d and f have one review each (e has two): d is older.
    expect(await nextFor(users.next)).toEqual({ id: ids.d, remaining: 5 });
    const detail = (await nextSubmissionForJudge(ctx))?.next;
    expect(detail?.myReview).toBeNull();
    expect(JSON.stringify(detail)).not.toMatch(/@example\.test|Person/);
  });

  it("keeps assignments, the done state, judging status and event scoping", async () => {
    await prisma.event.update({ where: { id: event.id }, data: { judgesSeeAll: false } });
    await prisma.judgeAssignment.create({ data: { eventId: event.id, submissionId: ids.f!, judgeUserId: users.next } });
    expect(await nextFor(users.next)).toEqual({ id: ids.f, remaining: 1 });
    await review(users.next, ids.f!, 7);
    expect(await nextFor(users.next)).toEqual({ id: null, remaining: 0 });
    await prisma.event.update({ where: { id: event.id }, data: { judgesSeeAll: true } });

    // Not a judge, or another event: no access at all.
    expect(await resolveJudgeContext(users.outsider, orgSlug, event.id)).toBeNull();
    expect(await nextSubmissionForJudge({ ...(await judgeCtx(users.next)), userId: users.outsider })).toBeNull();
    expect(await nextSubmissionForJudge({ ...(await judgeCtx(users.next)), eventId: otherEvent.id })).toBeNull();

    // Judging closed: nothing to score.
    await prisma.event.update({ where: { id: event.id }, data: { judgingStatus: JudgingStatus.CLOSED } });
    expect(await nextFor(users.conflicted)).toEqual({ id: null, remaining: 0 });
  });
});
