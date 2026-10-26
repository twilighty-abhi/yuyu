import { randomUUID } from "node:crypto";
import { EventPermission, EventStatus, JudgingStatus, MembershipRole, RegistrationMode, SubmissionStatus, type Event } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock("@/lib/auth", () => ({ auth: async () => (session.userId ? { user: { id: session.userId } } : null) }));
vi.mock("@/lib/actionRateLimit", () => ({ isActionRateLimited: async () => false }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { prisma } from "@/lib/db";
import { submitRsvpCore } from "@/lib/rsvpCore";
import { resolveJudgeContext, resolveJudgingOrganiser, type JudgingOrganiserContext } from "@/lib/judgingAccess";
import { loadSubmissionForJudge } from "@/lib/core/judging";
import { applyAutoAssignment, loadJudgingProgress, loadJudgingProgressPage, previewAutoAssignment, setReviewsPerProject } from "@/lib/core/judgingOps";
import { applyJudgeAutoAssignment, loadJudgingProgressPage as loadProgressPageAction, previewJudgeAutoAssignment, saveReviewsPerProject } from "@/app/actions/judging-ops";

/*
 * Automatic judge assignment and the Progress dashboard against PostgreSQL
 * (docs/HACKATHON.md): owner/admin only, event and organisation scoping,
 * conflicts of interest, preview then apply under the lock, the CHECK on
 * reviewsPerProject, and the progress lists (below target, judges,
 * outliers, stale reviews).
 */

const suffix = randomUUID().replaceAll("-", "");
const orgSlug = `judging-ops-${suffix}`;
const otherOrgSlug = `judging-ops-other-${suffix}`;
const startedAt = new Date();
const HOUR = 3_600_000;
let organisationId = "";
let otherOrganisationId = "";
const users: Record<"owner" | "admin2" | "j1" | "j2" | "j3" | "j4" | "outsider", string> = { owner: "", admin2: "", j1: "", j2: "", j3: "", j4: "", outsider: "" };
let sequence = 0;

async function createEvent(orgId: string, slugPrefix = "ops"): Promise<Event> {
  return prisma.event.create({
    data: {
      organisationId: orgId,
      title: `Judging ops ${suffix}`,
      slug: `${slugPrefix}-${suffix}-${randomUUID().slice(0, 8)}`,
      startDateTime: new Date(Date.now() + 24 * HOUR),
      endDateTime: new Date(Date.now() + 48 * HOUR),
      timezone: "UTC",
      status: EventStatus.PUBLISHED,
      registrationMode: RegistrationMode.INDIVIDUAL,
      submissionsEnabled: true,
      judgingStatus: JudgingStatus.OPEN,
      page: { create: { isPublished: true } },
    },
  });
}

async function register(event: Event, userId: string | null = null) {
  sequence += 1;
  const result = await submitRsvpCore(
    { orgSlug, eventSlug: event.slug, ...(userId ? {} : { guestEmail: `entrant-${sequence}-${suffix}@example.test` }), name: `Entrant ${sequence}`, answers: {} },
    { userId },
  );
  if (!result.ok || !result.data) throw new Error(`registration failed: ${result.ok ? "no data" : result.error}`);
  return prisma.rSVP.findUniqueOrThrow({ where: { checkInToken: result.data.ticketToken } });
}

async function project(event: Event, title: string, userId: string | null = null, status: SubmissionStatus = SubmissionStatus.SUBMITTED) {
  const rsvp = await register(event, userId);
  return prisma.submission.create({ data: { eventId: event.id, rsvpId: rsvp.id, title, status, submittedAt: status === SubmissionStatus.DRAFT ? null : new Date() } });
}

async function grantJudges(event: Event, ...judgeIds: string[]) {
  for (const userId of judgeIds) await prisma.eventCollaborator.create({ data: { eventId: event.id, userId, permissions: [EventPermission.JUDGE] } });
}

async function organiser(event: Event): Promise<JudgingOrganiserContext> {
  const ctx = await resolveJudgingOrganiser(users.owner, orgSlug, event.id);
  if (!ctx) throw new Error("organiser context missing");
  return ctx;
}

async function score(event: Event, submissionId: string, judgeUserId: string, value: number, submitted: boolean) {
  const criterion = await prisma.judgingCriterion.findFirstOrThrow({ where: { eventId: event.id } });
  await prisma.judgeScore.create({ data: { submissionId, judgeUserId, criterionId: criterion.id, score: value } });
  if (submitted) await prisma.judgeReview.create({ data: { submissionId, judgeUserId, submittedAt: new Date() } });
}

const judgeIds = () => [users.j1, users.j2, users.j3, users.j4];

describe.sequential("judging operations", () => {
  beforeAll(async () => {
    const [org, other] = await Promise.all([
      prisma.organisation.create({ data: { name: `Judging ops ${suffix}`, slug: orgSlug } }),
      prisma.organisation.create({ data: { name: `Judging ops other ${suffix}`, slug: otherOrgSlug } }),
    ]);
    organisationId = org.id;
    otherOrganisationId = other.id;
    for (const key of Object.keys(users) as Array<keyof typeof users>) {
      const user = await prisma.user.create({ data: { name: `User ${key}`, email: `${key}-${suffix}@example.test`, emailVerified: new Date() } });
      users[key] = user.id;
    }
    await prisma.membership.create({ data: { userId: users.owner, organisationId, role: MembershipRole.OWNER } });
    await prisma.membership.create({ data: { userId: users.admin2, organisationId, role: MembershipRole.ADMIN } });
    await prisma.membership.create({ data: { userId: users.owner, organisationId: otherOrganisationId, role: MembershipRole.OWNER } });
  });

  afterAll(async () => {
    session.userId = null;
    for (const id of [organisationId, otherOrganisationId]) if (id) await prisma.organisation.delete({ where: { id } });
    await prisma.user.deleteMany({ where: { id: { in: Object.values(users).filter(Boolean) } } });
    await prisma.outboxMessage.deleteMany({ where: { createdAt: { gte: startedAt } } });
    await prisma.auditEvent.deleteMany({ where: { createdAt: { gte: startedAt }, action: { in: ["JUDGES_AUTO_ASSIGNED", "JUDGING_REVIEW_TARGET_UPDATED"] } } });
    await prisma.$disconnect();
  });

  it("keeps reviewsPerProject in 1..20 with a CHECK constraint", async () => {
    const event = await createEvent(organisationId);
    await expect(prisma.event.update({ where: { id: event.id }, data: { reviewsPerProject: 0 } })).rejects.toThrow();
    await expect(prisma.event.update({ where: { id: event.id }, data: { reviewsPerProject: 21 } })).rejects.toThrow();
    await expect(prisma.event.update({ where: { id: event.id }, data: { reviewsPerProject: 20 } })).resolves.toMatchObject({ reviewsPerProject: 20 });
    expect((await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).scoreNormalization).toBe("RAW");
  });

  it("previews without writing, then applies the same plan in one transaction", async () => {
    const event = await createEvent(organisationId);
    await grantJudges(event, ...judgeIds());
    const conflicted = await project(event, "Judge one's own project", users.j1);
    const others = [];
    for (let index = 0; index < 7; index += 1) others.push(await project(event, `Project ${index}`));
    await project(event, "Still a draft", null, SubmissionStatus.DRAFT);
    const ctx = await organiser(event);

    const preview = await previewAutoAssignment(ctx, { perProject: 4, mode: "keep", judgeUserIds: judgeIds() });
    if (!preview.ok) throw new Error(preview.error);
    expect(preview.data).toMatchObject({ projects: 8, perProject: 4, judgesSeeAll: true, added: 31, removed: 0, shortfallTotal: 1 });
    expect(preview.data.shortfalls).toEqual([
      expect.objectContaining({ submissionId: conflicted.id, title: "Judge one's own project", assigned: 3, missing: 1, possible: 3 }),
    ]);
    expect(preview.data.judges.map((judge) => judge.after).sort()).toEqual([7, 8, 8, 8]);
    expect(await prisma.judgeAssignment.count({ where: { eventId: event.id } })).toBe(0);

    expect(await applyAutoAssignment(ctx, { perProject: 4, mode: "keep", judgeUserIds: judgeIds() })).toMatchObject({ ok: false });
    expect(await applyAutoAssignment(ctx, { perProject: 4, mode: "keep", judgeUserIds: judgeIds(), fingerprint: "stale" })).toMatchObject({ ok: false });

    const applied = await applyAutoAssignment(ctx, { perProject: 4, mode: "keep", judgeUserIds: judgeIds(), fingerprint: preview.data.fingerprint });
    expect(applied).toEqual({ ok: true, data: { added: 31, removed: 0, adopted: 0, covered: 7, shortfallTotal: 1, projects: 8 } });
    const saved = await prisma.event.findUniqueOrThrow({ where: { id: event.id } });
    expect(saved).toMatchObject({ judgesSeeAll: false, reviewsPerProject: 4 });
    expect(await prisma.judgeAssignment.count({ where: { eventId: event.id, judgeUserId: users.j1, submissionId: conflicted.id } })).toBe(0);
    expect(await prisma.judgeAssignment.count({ where: { eventId: event.id, submissionId: others[0]!.id } })).toBe(4);
    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { action: "JUDGES_AUTO_ASSIGNED", targetId: event.id } });
    expect(audit).toMatchObject({ actorUserId: users.owner, organisationId });
    expect(audit.metadata).toMatchObject({ perProject: 4, mode: "keep", added: 31, removed: 0, shortfalls: 1 });

    // A second run has nothing to add, and the plan changed, so the old fingerprint is refused.
    expect(await applyAutoAssignment(ctx, { perProject: 4, mode: "keep", judgeUserIds: judgeIds(), fingerprint: preview.data.fingerprint })).toMatchObject({
      ok: false,
      error: expect.stringContaining("changed since the preview"),
    });
    const again = await previewAutoAssignment(ctx, { perProject: 4, mode: "keep", judgeUserIds: judgeIds() });
    expect(again).toMatchObject({ ok: true, data: { added: 0, removed: 0, judgesSeeAll: false } });
  });

  it("refuses a plan that changed between preview and apply", async () => {
    const event = await createEvent(organisationId);
    await grantJudges(event, users.j1, users.j2);
    await project(event, "First");
    const ctx = await organiser(event);
    const preview = await previewAutoAssignment(ctx, { perProject: 1, mode: "keep", judgeUserIds: [users.j1, users.j2] });
    if (!preview.ok) throw new Error(preview.error);
    await project(event, "Arrived late");
    expect(await applyAutoAssignment(ctx, { perProject: 1, mode: "keep", judgeUserIds: [users.j1, users.j2], fingerprint: preview.data.fingerprint })).toMatchObject({ ok: false });
    expect(await prisma.judgeAssignment.count({ where: { eventId: event.id } })).toBe(0);
  });

  it("draws only on eligible judges; organisers only when picked", async () => {
    const event = await createEvent(organisationId);
    await grantJudges(event, users.j1);
    await project(event, "Alpha");
    await project(event, "Beta");
    const ctx = await organiser(event);
    expect(await previewAutoAssignment(ctx, { perProject: 1, mode: "keep", judgeUserIds: [users.j1, users.outsider] })).toMatchObject({
      ok: false,
      error: expect.stringContaining("can no longer judge"),
    });
    const withAdmin = await previewAutoAssignment(ctx, { perProject: 2, mode: "keep", judgeUserIds: [users.j1, users.admin2] });
    if (!withAdmin.ok) throw new Error(withAdmin.error);
    expect(withAdmin.data.judges.map((judge) => [judge.kind, judge.after])).toEqual([
      ["judge", 2],
      ["admin", 2],
    ]);
    const withoutAdmin = await previewAutoAssignment(ctx, { perProject: 2, mode: "keep", judgeUserIds: [users.j1] });
    expect(withoutAdmin).toMatchObject({ ok: true, data: { shortfallTotal: 2, added: 2 } });
    expect(await previewAutoAssignment(ctx, { perProject: 2, mode: "keep", judgeUserIds: [] })).toMatchObject({ ok: false, fieldErrors: { judgeUserIds: expect.any(Array) } });
    expect(await previewAutoAssignment(ctx, { perProject: 0, mode: "keep", judgeUserIds: [users.j1] })).toMatchObject({ ok: false, fieldErrors: { perProject: expect.any(Array) } });
  });

  it("replace mode removes assignments except ones a judge has started", async () => {
    const event = await createEvent(organisationId);
    await grantJudges(event, users.j1, users.j2, users.j3);
    await prisma.judgingCriterion.create({ data: { eventId: event.id, name: "Impact", weight: 1, maxScore: 10 } });
    const a = await project(event, "A");
    const b = await project(event, "B");
    await prisma.judgeAssignment.createMany({
      data: [
        { eventId: event.id, judgeUserId: users.j1, submissionId: a.id },
        { eventId: event.id, judgeUserId: users.j1, submissionId: b.id },
      ],
    });
    await score(event, a.id, users.j1, 5, false);
    const ctx = await organiser(event);
    const preview = await previewAutoAssignment(ctx, { perProject: 1, mode: "replace", judgeUserIds: [users.j1, users.j2, users.j3] });
    if (!preview.ok) throw new Error(preview.error);
    expect(preview.data).toMatchObject({ removed: 1, added: 1 });
    const applied = await applyAutoAssignment(ctx, { perProject: 1, mode: "replace", judgeUserIds: [users.j1, users.j2, users.j3], fingerprint: preview.data.fingerprint });
    expect(applied).toMatchObject({ ok: true, data: { removed: 1, added: 1 } });
    const rows = await prisma.judgeAssignment.findMany({ where: { eventId: event.id }, select: { judgeUserId: true, submissionId: true } });
    expect(rows).toContainEqual({ judgeUserId: users.j1, submissionId: a.id });
    expect(rows).not.toContainEqual({ judgeUserId: users.j1, submissionId: b.id });
    expect(rows.filter((row) => row.submissionId === b.id)).toHaveLength(1);
  });

  it("keeps work judges started while seeing every project, and counts it towards the target", async () => {
    const event = await createEvent(organisationId);
    expect(event.judgesSeeAll).toBe(true);
    await grantJudges(event, ...judgeIds());
    await prisma.judgingCriterion.create({ data: { eventId: event.id, name: "Impact", weight: 1, maxScore: 10 } });
    const p = await project(event, "Started without assignments");
    const q = await project(event, "Untouched");
    // j1 saved scores (not submitted); j2 and j3 submitted reviews; nobody is assigned.
    await score(event, p.id, users.j1, 4, false);
    await score(event, p.id, users.j2, 6, true);
    await score(event, p.id, users.j3, 7, true);
    const ctx = await organiser(event);
    const options = { perProject: 2, mode: "keep" as const, judgeUserIds: [users.j4, users.j1, users.j2, users.j3] };

    const preview = await previewAutoAssignment(ctx, options);
    if (!preview.ok) throw new Error(preview.error);
    expect(preview.data).toMatchObject({ projects: 2, covered: 2, adopted: 3, added: 2, removed: 0, judgesSeeAll: true });
    const applied = await applyAutoAssignment(ctx, { ...options, fingerprint: preview.data.fingerprint });
    expect(applied).toMatchObject({ ok: true, data: { adopted: 3, added: 2 } });

    const rows = await prisma.judgeAssignment.findMany({ where: { eventId: event.id }, select: { judgeUserId: true, submissionId: true } });
    // P keeps exactly the three judges who already worked on it; nobody new is piled on.
    expect(rows.filter((row) => row.submissionId === p.id).map((row) => row.judgeUserId).sort()).toEqual([users.j1, users.j2, users.j3].sort());
    expect(rows.filter((row) => row.submissionId === q.id)).toHaveLength(2);
    expect((await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).judgesSeeAll).toBe(false);
    // j1 can still open and finish the half-done review now that judges see assigned projects only.
    const judge = await resolveJudgeContext(users.j1, orgSlug, event.id);
    if (!judge) throw new Error("judge context missing");
    expect(await loadSubmissionForJudge(judge, p.id)).not.toBeNull();
    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { action: "JUDGES_AUTO_ASSIGNED", targetId: event.id } });
    expect(audit.metadata).toMatchObject({ added: 2, adopted: 3 });

    // A start-over re-run with nothing changed plans no changes.
    const rerun = await previewAutoAssignment(ctx, { ...options, mode: "replace" });
    expect(rerun).toMatchObject({ ok: true, data: { added: 0, removed: 0, adopted: 0, covered: 2 } });
  });

  it("is scoped by organisation and refused once judging is closed or results are out", async () => {
    const foreign = await createEvent(otherOrganisationId, "foreign");
    const event = await createEvent(organisationId);
    await grantJudges(event, users.j1);
    await project(event, "Gamma");
    const ctx = await organiser(event);
    // A context for this organisation pointed at another organisation's event finds nothing.
    const crossed = { ...ctx, eventId: foreign.id };
    expect(await previewAutoAssignment(crossed, { perProject: 1, mode: "keep", judgeUserIds: [users.j1] })).toEqual({ ok: false, error: "Event not found." });
    expect(await setReviewsPerProject(crossed, 2)).toEqual({ ok: false, error: "Event not found." });
    expect(await loadJudgingProgress(crossed)).toBeNull();
    expect(await resolveJudgingOrganiser(users.owner, orgSlug, foreign.id)).toBeNull();

    await prisma.event.update({ where: { id: event.id }, data: { judgingStatus: JudgingStatus.CLOSED } });
    expect(await previewAutoAssignment(ctx, { perProject: 1, mode: "keep", judgeUserIds: [users.j1] })).toMatchObject({ ok: false, error: expect.stringContaining("closed") });
    await prisma.event.update({ where: { id: event.id }, data: { judgingStatus: JudgingStatus.OPEN, resultsPublishedAt: new Date() } });
    expect(await previewAutoAssignment(ctx, { perProject: 1, mode: "keep", judgeUserIds: [users.j1] })).toMatchObject({ ok: false, error: expect.stringContaining("published") });
  });

  it("lets only owners and admins reach the actions", async () => {
    const event = await createEvent(organisationId);
    await grantJudges(event, users.j1);
    await project(event, "Delta");
    const scope = { organisationSlug: orgSlug, eventId: event.id };
    const options = { perProject: 1, mode: "keep", judgeUserIds: [users.j1] };

    session.userId = null;
    expect(await previewJudgeAutoAssignment({ ...scope, options })).toMatchObject({ ok: false, error: "You must be signed in." });
    for (const who of [users.j1, users.outsider]) {
      session.userId = who;
      expect(await previewJudgeAutoAssignment({ ...scope, options })).toMatchObject({ ok: false, error: expect.stringContaining("permission") });
      expect(await applyJudgeAutoAssignment({ ...scope, options: { ...options, fingerprint: "x" } })).toMatchObject({ ok: false, error: expect.stringContaining("permission") });
      expect(await saveReviewsPerProject({ ...scope, reviewsPerProject: 2 })).toMatchObject({ ok: false, error: expect.stringContaining("permission") });
      expect(await loadProgressPageAction({ ...scope, section: "judges" })).toMatchObject({ ok: false, error: expect.stringContaining("permission") });
    }
    session.userId = users.admin2;
    const preview = await previewJudgeAutoAssignment({ ...scope, options });
    if (!preview.ok || !preview.data) throw new Error("preview failed");
    expect(await applyJudgeAutoAssignment({ ...scope, options: { ...options, fingerprint: preview.data.fingerprint } })).toMatchObject({ ok: true, data: { added: 1 } });
    expect(await saveReviewsPerProject({ ...scope, reviewsPerProject: "3" })).toEqual({ ok: true, data: { reviewsPerProject: 3 } });
    expect(await saveReviewsPerProject({ ...scope, reviewsPerProject: 99 })).toMatchObject({ ok: false, fieldErrors: { reviewsPerProject: expect.any(Array) } });
    expect(await saveReviewsPerProject({ ...scope, reviewsPerProject: null })).toEqual({ ok: true, data: { reviewsPerProject: null } });
    expect(await loadProgressPageAction({ ...scope, section: "nope" })).toMatchObject({ ok: false });
    expect(await loadProgressPageAction({ ...scope, section: "judges", page: 3 })).toMatchObject({ ok: true, data: { section: "judges", page: { page: 1 } } });
    session.userId = null;
    expect(await prisma.auditEvent.count({ where: { action: "JUDGING_REVIEW_TARGET_UPDATED", targetId: event.id } })).toBe(2);
  });

  it("reports progress: below target, per judge, outliers and stale reviews", async () => {
    const event = await createEvent(organisationId);
    await grantJudges(event, ...judgeIds());
    await prisma.judgingCriterion.create({ data: { eventId: event.id, name: "Impact", weight: 1, maxScore: 10 } });
    const p1 = await project(event, "Consensus with a dissenter");
    const p2 = await project(event, "Two judges disagree");
    const p3 = await project(event, "Half done");
    const own = await project(event, "Judge four's own", users.j4);
    await prisma.event.update({ where: { id: event.id }, data: { reviewsPerProject: 3, judgesSeeAll: false } });
    await prisma.judgeAssignment.createMany({
      data: [
        ...judgeIds().map((judgeUserId) => ({ eventId: event.id, judgeUserId, submissionId: p1.id })),
        { eventId: event.id, judgeUserId: users.j1, submissionId: p2.id },
        { eventId: event.id, judgeUserId: users.j2, submissionId: p2.id },
        { eventId: event.id, judgeUserId: users.j2, submissionId: p3.id },
      ],
    });
    // p1: 80, 80, 80 and a dissenting 10.
    await score(event, p1.id, users.j1, 8, true);
    await score(event, p1.id, users.j2, 8, true);
    await score(event, p1.id, users.j3, 8, true);
    await score(event, p1.id, users.j4, 1, true);
    // p2: two judges 40 points apart.
    await score(event, p2.id, users.j1, 9, true);
    await score(event, p2.id, users.j2, 5, true);
    // p3: saved two days ago, never submitted.
    await score(event, p3.id, users.j2, 6, false);
    await prisma.$executeRaw`UPDATE "JudgeScore" SET "updatedAt" = now() - interval '2 days' WHERE "submissionId" = ${p3.id}`;
    // A review on the judge's own entrant never counts.
    await score(event, own.id, users.j4, 10, true);

    const ctx = await organiser(event);
    const progress = await loadJudgingProgress(ctx);
    if (!progress) throw new Error("no progress");
    expect(progress.summary).toMatchObject({ target: 3, targetIsDefault: false, projects: 4, projectsAtTarget: 1, reviewsCounted: 6, judgesSeeAll: false });
    // (3 + 2 + 0 + 0) of 4 × 3
    expect(progress.summary.coverage).toBe(41);
    expect(progress.belowTarget.rows.map((row) => [row.title, row.reviews, row.inProgress, row.assigned, row.missing])).toEqual([
      ["Judge four's own", 0, 0, 0, 3],
      ["Half done", 0, 1, 1, 3],
      ["Two judges disagree", 2, 0, 2, 1],
    ]);
    const judgesById = new Map(progress.judges.rows.map((row) => [row.userId, row]));
    expect(judgesById.get(users.j2)).toMatchObject({ assigned: 3, started: 1, submitted: 2, completion: 66 });
    expect(judgesById.get(users.j4)).toMatchObject({ assigned: 1, started: 0, submitted: 1, completion: 100 });
    expect(judgesById.get(users.j3)).toMatchObject({ assigned: 1, submitted: 1, completion: 100 });
    // Organisers who haven't judged are left out; the owner's progress isn't a judge's.
    expect(judgesById.has(users.owner)).toBe(false);
    expect(progress.outliers.rows.map((row) => [row.title, row.judgeUserId, row.score, row.othersMean, row.difference, row.rule])).toEqual([
      ["Consensus with a dissenter", users.j4, 10, 80, -70, "sd"],
      ["Two judges disagree", progress.outliers.rows[1]!.judgeUserId, progress.outliers.rows[1]!.score, progress.outliers.rows[1]!.othersMean, progress.outliers.rows[1]!.difference, "fallback"],
      ["Two judges disagree", progress.outliers.rows[2]!.judgeUserId, progress.outliers.rows[2]!.score, progress.outliers.rows[2]!.othersMean, progress.outliers.rows[2]!.difference, "fallback"],
    ]);
    expect(progress.outliers.rows.slice(1).map((row) => Math.abs(row.difference))).toEqual([40, 40]);
    expect(progress.stale.rows).toEqual([expect.objectContaining({ submissionId: p3.id, judgeUserId: users.j2, scored: 1, criteria: 1 })]);

    // Paged reads clamp to the last page and agree with the first render.
    expect(await loadJudgingProgressPage(ctx, { section: "below-target", page: 9 })).toMatchObject({ section: "below-target", page: { page: 1, total: 3 } });
    expect(await loadJudgingProgressPage(ctx, { section: "stale", page: 1 }, new Date(Date.now() - 2 * 24 * HOUR))).toMatchObject({ page: { total: 0 } });
    expect(await loadJudgingProgressPage(ctx, { section: "unknown" })).toBeNull();
  });
});
