import { randomUUID } from "node:crypto";
import { EventPermission, EventStatus, JudgingStatus, MembershipRole, RegistrationMode, RsvpStatus, SoloPolicy, SubmissionStatus, type Event } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));
vi.mock("@/lib/actionRateLimit", () => ({ isActionRateLimited: async () => false }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { prisma } from "@/lib/db";
import { submitRsvpCore } from "@/lib/rsvpCore";
import { hashTeamManageToken } from "@/lib/teamToken";
import { resolveJudgeContext, resolveJudgingOrganiser, type JudgingOrganiserContext } from "@/lib/judgingAccess";
import {
  assignJudge,
  createEventAward,
  createJudgingCriterion,
  disqualifySubmission,
  listSubmissionsForJudge,
  loadJudgingResults,
  loadProjectGallery,
  loadPublicResults,
  publishResults,
  requestSubmissionLink,
  resolveEntrantBySubmissionLink,
  resolveEntrantByTeamManageToken,
  saveJudgeScores,
  saveSubmissionDraft,
  setAwardWinner,
  setJudgingStatus,
  submitJudgeReview,
  submitSubmission,
  unpublishResults,
  updateJudgingSettings,
  withdrawSubmission,
} from "@/lib/core/judging";

/*
 * Smoke coverage for lib/core/judging.ts against PostgreSQL: the raw upserts,
 * locks, CHECK constraints, and cascades. docs/HACKATHON.md lists the full
 * scenario suite (tests/integration/judging.db.test.ts).
 */

const suffix = randomUUID().replaceAll("-", "");
const orgSlug = `judging-${suffix}`;
const startedAt = new Date();
let organisationId = "";
let organiserId = "";
let judgeId = "";
let sequence = 0;

const HOUR = 3_600_000;

async function createEvent(): Promise<Event> {
  return prisma.event.create({ data: {
    organisationId,
    title: `Judging ${suffix}`,
    slug: `judging-${suffix}-${randomUUID().slice(0, 8)}`,
    startDateTime: new Date(Date.now() + 24 * HOUR),
    endDateTime: new Date(Date.now() + 48 * HOUR),
    timezone: "UTC",
    status: EventStatus.PUBLISHED,
    registrationMode: RegistrationMode.TEAM,
    teamMaxSize: 4,
    soloPolicy: SoloPolicy.SOLO_ALLOWED,
    page: { create: { isPublished: true } },
  } });
}

async function register(event: Event, label: string, team?: { mode: "create"; name: string } | { mode: "join"; joinToken: string }, userId: string | null = null) {
  sequence += 1;
  const result = await submitRsvpCore(
    { orgSlug, eventSlug: event.slug, ...(userId ? {} : { guestEmail: `${label}-${sequence}-${suffix}@example.test` }), name: `${label} Person`, answers: {} },
    { userId, ...(team ? { team } : {}) },
  );
  if (!result.ok || !result.data) throw new Error(`registration failed: ${result.ok ? "no data" : result.error}`);
  return prisma.rSVP.findUniqueOrThrow({ where: { checkInToken: result.data.ticketToken } });
}

async function manageTokenFor(teamId: string) {
  const team = await prisma.team.findUniqueOrThrow({ where: { id: teamId } });
  const messages = await prisma.outboxMessage.findMany({ where: { kind: "team-created", payload: { path: ["teamId"], equals: teamId } } });
  const token = messages.map((m) => (m.payload as { manageToken?: string }).manageToken).find((raw) => raw && hashTeamManageToken(raw) === team.manageTokenHash);
  if (!token) throw new Error("no manage token");
  return token;
}

async function organiser(event: Event): Promise<JudgingOrganiserContext> {
  const ctx = await resolveJudgingOrganiser(organiserId, orgSlug, event.id);
  if (!ctx) throw new Error("organiser context missing");
  return ctx;
}

async function openWindow(ctx: JudgingOrganiserContext) {
  const result = await updateJudgingSettings(ctx, {
    submissionsEnabled: true,
    submissionsOpenAt: new Date(Date.now() - HOUR).toISOString(),
    submissionsCloseAt: new Date(Date.now() + HOUR).toISOString(),
    judgesSeeAll: true,
    projectGalleryPublic: true,
  });
  expect(result.ok).toBe(true);
}

const content = { title: "Byte Me", summary: "A project.", repoUrl: "https://github.com/example/project" };

describe.sequential("judging core integration", () => {
  beforeAll(async () => {
    const org = await prisma.organisation.create({ data: { name: `Judging ${suffix}`, slug: orgSlug } });
    organisationId = org.id;
    const [owner, judge] = await Promise.all([
      prisma.user.create({ data: { name: "Organiser", email: `organiser-${suffix}@example.test` } }),
      prisma.user.create({ data: { name: "Judge Judy", email: `judge-${suffix}@example.test`, emailVerified: new Date() } }),
    ]);
    organiserId = owner.id;
    judgeId = judge.id;
    await prisma.membership.create({ data: { userId: organiserId, organisationId, role: MembershipRole.ADMIN } });
  });

  afterAll(async () => {
    if (organisationId) await prisma.organisation.delete({ where: { id: organisationId } });
    await prisma.user.deleteMany({ where: { id: { in: [organiserId, judgeId].filter(Boolean) } } });
    await prisma.outboxMessage.deleteMany({ where: { createdAt: { gte: startedAt } } });
    await prisma.auditEvent.deleteMany({ where: { createdAt: { gte: startedAt }, action: { startsWith: "JUDGING_" } } });
    await prisma.$disconnect();
  });

  it("runs submissions, judging, and results end to end", async () => {
    const event = await createEvent();
    // Hackathon emails are opt-in (off by default); this journey covers sending them.
    await prisma.event.update({ where: { id: event.id }, data: { emailEntrantsOnResults: true, emailSubmissionReceipts: true } });
    const ctx = await organiser(event);
    const leader = await register(event, "leader", { mode: "create", name: `Team ${suffix}` });
    const auth = await resolveEntrantByTeamManageToken(await manageTokenFor(leader.teamId!));
    if (!auth) throw new Error("entrant missing");

    // Window not configured yet: refused.
    expect(await saveSubmissionDraft(auth, content)).toMatchObject({ ok: false });
    await openWindow(ctx);
    expect(await saveSubmissionDraft(auth, content)).toMatchObject({ ok: true, data: { status: SubmissionStatus.DRAFT } });
    const submitted = await submitSubmission(auth, content);
    expect(submitted).toMatchObject({ ok: true, data: { status: SubmissionStatus.SUBMITTED } });
    expect(await prisma.outboxMessage.count({ where: { kind: "submission-received", createdAt: { gte: startedAt } } })).toBe(1);
    // Re-submitting an already submitted project does not email again.
    await submitSubmission(auth, { ...content, title: "Byte Me 2" });
    expect(await prisma.outboxMessage.count({ where: { kind: "submission-received", createdAt: { gte: startedAt } } })).toBe(1);

    // Solo registrant via the emailed link.
    const solo = await register(event, "solo");
    expect(await requestSubmissionLink({ rsvpId: solo.id, eventId: event.id })).toEqual({ ok: true, data: { sent: true } });
    const linkMessage = await prisma.outboxMessage.findFirstOrThrow({ where: { kind: "submission-link", payload: { path: ["rsvpId"], equals: solo.id } } });
    const soloAuth = await resolveEntrantBySubmissionLink((linkMessage.payload as { token: string }).token);
    expect(soloAuth).toMatchObject({ kind: "solo-link", rsvpId: solo.id });
    expect(await submitSubmission(soloAuth!, { title: "Solo" })).toMatchObject({ ok: true });
    // A forged link for the same RSVP id does not resolve.
    expect(await resolveEntrantBySubmissionLink("x".repeat(43))).toBeNull();

    // A JUDGE-only collaborator.
    await prisma.eventCollaborator.create({ data: { eventId: event.id, userId: judgeId, permissions: [EventPermission.JUDGE] } });
    const judge = await resolveJudgeContext(judgeId, orgSlug, event.id);
    expect(judge).toMatchObject({ isAdmin: false });
    expect(await resolveJudgingOrganiser(judgeId, orgSlug, event.id)).toBeNull();

    const criterion = await createJudgingCriterion(ctx, { name: "Impact", weight: 2, maxScore: 5 });
    if (!criterion.ok) throw new Error(criterion.error);
    const submission = await prisma.submission.findFirstOrThrow({ where: { teamId: leader.teamId! } });

    expect(await saveJudgeScores(judge!, { submissionId: submission.id, scores: [{ criterionId: criterion.data.id, score: 4 }] })).toMatchObject({ ok: false, error: "Judging is not open." });
    expect(await setJudgingStatus(ctx, JudgingStatus.OPEN)).toMatchObject({ ok: true });
    expect(await createJudgingCriterion(ctx, { name: "Late", weight: 1, maxScore: 5 })).toMatchObject({ ok: false });
    expect(await saveJudgeScores(judge!, { submissionId: submission.id, scores: [{ criterionId: criterion.data.id, score: 6 }] })).toMatchObject({ ok: false });

    // Concurrent writes of the same score stay one row.
    const writes = await Promise.all([3, 4, 5, 4].map((score) => saveJudgeScores(judge!, { submissionId: submission.id, scores: [{ criterionId: criterion.data.id, score }] })));
    expect(writes.every((write) => write.ok)).toBe(true);
    expect(await prisma.judgeScore.count({ where: { submissionId: submission.id, judgeUserId: judgeId } })).toBe(1);
    await saveJudgeScores(judge!, { submissionId: submission.id, scores: [{ criterionId: criterion.data.id, score: 4 }] });
    expect(await submitJudgeReview(judge!, { submissionId: submission.id, comment: "Nice" })).toEqual({ ok: true, data: { submitted: true } });

    const workspace = await listSubmissionsForJudge(judge!);
    expect(workspace?.submissions).toHaveLength(2);
    expect(JSON.stringify(workspace)).not.toMatch(/@example\.test|checkInToken|Nice/);

    // Withdrawn while the window is open; then re-submitted.
    expect(await withdrawSubmission(soloAuth!)).toMatchObject({ ok: true });
    expect(await submitSubmission(soloAuth!, { title: "Solo again" })).toMatchObject({ ok: true });

    // Organiser results: 4/5 = 80.
    const results = await loadJudgingResults(ctx);
    expect(results?.rows[0]).toMatchObject({ submissionId: submission.id, score: 80, rank: 1, judgesCounted: 1 });

    // Awards only for SUBMITTED projects.
    const award = await createEventAward(ctx, { name: "Overall winner" });
    if (!award.ok) throw new Error(award.error);
    const soloSubmission = await prisma.submission.findFirstOrThrow({ where: { rsvpId: solo.id } });
    expect(await disqualifySubmission(ctx, { submissionId: soloSubmission.id, reason: "Plagiarism" })).toMatchObject({ ok: true });
    expect(await setAwardWinner(ctx, { awardId: award.data.id, submissionId: soloSubmission.id })).toMatchObject({ ok: false });
    expect(await setAwardWinner(ctx, { awardId: award.data.id, submissionId: submission.id })).toMatchObject({ ok: true });

    // Results stay hidden until published, then publish is idempotent.
    expect(await loadPublicResults(event.id)).toBeNull();
    expect(await publishResults(ctx)).toMatchObject({ ok: false });
    expect(await setJudgingStatus(ctx, JudgingStatus.CLOSED)).toMatchObject({ ok: true });
    expect(await saveJudgeScores(judge!, { submissionId: submission.id, scores: [{ criterionId: criterion.data.id, score: 1 }] })).toMatchObject({ ok: false });
    const published = await publishResults(ctx);
    expect(published).toMatchObject({ ok: true, data: { alreadyPublished: false } });
    const queued = published.ok ? published.data.queued : 0;
    expect(queued).toBe(await prisma.rSVP.count({ where: { eventId: event.id, status: RsvpStatus.CONFIRMED } }));
    expect(await publishResults(ctx)).toMatchObject({ ok: true, data: { alreadyPublished: true, queued: 0 } });
    const publicResults = await loadPublicResults(event.id);
    expect(publicResults?.awards[0]?.winners).toEqual([expect.objectContaining({ place: 1, title: "Byte Me 2", entrantName: `Team ${suffix}` })]);
    expect(JSON.stringify(publicResults)).not.toMatch(/"score"|Nice|Plagiarism|@example\.test/);

    expect(await unpublishResults(ctx)).toMatchObject({ ok: true });
    expect(await prisma.outboxMessage.count({ where: { kind: "results-published", status: "PENDING", payload: { path: ["eventId"], equals: event.id } } })).toBe(0);
    expect(await loadPublicResults(event.id)).toBeNull();

    // Gallery waits for the window to close.
    expect(await loadProjectGallery(event.id)).toBeNull();
    expect((await loadProjectGallery(event.id, new Date(Date.now() + 2 * HOUR)))?.projects.map((p) => p.title)).toEqual(["Byte Me 2"]);
  });

  it("refuses non-confirmed entrants, cross-event ids, and conflicts of interest", async () => {
    const event = await createEvent();
    const other = await createEvent();
    const ctx = await organiser(event);
    await openWindow(ctx);
    await openWindow(await organiser(other));

    // A waitlisted team cannot submit.
    const leader = await register(event, "leader", { mode: "create", name: `Wait ${suffix}` });
    await prisma.$transaction([
      prisma.team.update({ where: { id: leader.teamId! }, data: { status: RsvpStatus.WAITLISTED } }),
      prisma.rSVP.updateMany({ where: { teamId: leader.teamId! }, data: { status: RsvpStatus.WAITLISTED } }),
    ]);
    const auth = await resolveEntrantByTeamManageToken(await manageTokenFor(leader.teamId!));
    expect(await submitSubmission(auth!, content)).toMatchObject({ ok: false, error: "Only confirmed registrations can submit a project." });

    // An entrant auth re-scoped to another event finds nothing.
    expect(await submitSubmission({ ...auth!, eventId: other.id }, content)).toMatchObject({ ok: false });

    // The judge owns a registration on a team: never shown, never assignable.
    await prisma.eventCollaborator.create({ data: { eventId: event.id, userId: judgeId, permissions: [EventPermission.JUDGE] } });
    const judgeLeader = await register(event, "judgeleader", { mode: "create", name: `Judge team ${suffix}` }, judgeId);
    const judgeAuth = await resolveEntrantByTeamManageToken(await manageTokenFor(judgeLeader.teamId!));
    expect(await submitSubmission(judgeAuth!, content)).toMatchObject({ ok: true });
    const own = await prisma.submission.findFirstOrThrow({ where: { teamId: judgeLeader.teamId! } });
    expect(await assignJudge(ctx, { judgeUserId: judgeId, submissionId: own.id })).toMatchObject({ ok: false });
    const judge = await resolveJudgeContext(judgeId, orgSlug, event.id);
    expect((await listSubmissionsForJudge(judge!))?.submissions.map((s) => s.id)).not.toContain(own.id);
    // The JUDGE grant does not reach another event.
    expect(await resolveJudgeContext(judgeId, orgSlug, other.id)).toBeNull();

    // The database refuses a second entrant target and an inverted window.
    await expect(prisma.submission.create({ data: { eventId: event.id, teamId: leader.teamId!, rsvpId: leader.id, title: "Both" } })).rejects.toThrow();
    await expect(prisma.event.update({ where: { id: event.id }, data: { submissionsOpenAt: new Date(Date.now() + HOUR), submissionsCloseAt: new Date() } })).rejects.toThrow();

    // Disbanding the team deletes its submission (cascade).
    await prisma.team.delete({ where: { id: judgeLeader.teamId! } });
    expect(await prisma.submission.count({ where: { id: own.id } })).toBe(0);
  });
});
