import { randomUUID } from "node:crypto";
import {
  EventPermission,
  EventPrivacyType,
  EventStatus,
  JudgingStatus,
  MembershipRole,
  RegistrationMode,
  RsvpStatus,
  SoloPolicy,
  SubmissionStatus,
  type Event,
} from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => vi.fn(async (): Promise<{ user: { id: string } } | null> => null));
vi.mock("@/lib/auth", () => ({ auth: authMock }));
vi.mock("@/lib/actionRateLimit", () => ({ isActionRateLimited: async () => false }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { prisma } from "@/lib/db";
import { submitRsvpCore } from "@/lib/rsvpCore";
import { canAccessEvent, canManageRegistrationsFor } from "@/lib/eventAccess";
import { canManageWebhooks, getMembership } from "@/lib/permissions";
import { eventCapabilities } from "@/lib/eventDashboard/capabilities";
import { flushWebhookEmits } from "@/lib/webhooks/emit";
import { approveRsvpForUser, reacceptRsvpForUser } from "@/lib/core/rsvpLifecycle";
import { checkInToListForUser, createCheckInListForUser, lookupListAttendeesForUser } from "@/lib/core/checkinLists";
import { loadEventBroadcastDraftForUser, saveEventBroadcastDraftForUser } from "@/lib/core/broadcasts";
import { GET as exportAttendees } from "@/app/api/exports/events/[eventId]/attendees/route";
import { resolvePublicJudgingEvent } from "@/lib/publicJudgingPage";
import { resolveEventContext, listOrgEvents } from "@/lib/mobile/organiser";
import { judgingPermissionsFor } from "@/lib/judgingPermissions";
import { eventUsesJudging } from "@/lib/eventDashboard/judging";
import type { EventDashboardContext } from "@/lib/eventDashboard/context";
import { hashTeamManageToken } from "@/lib/teamToken";
import { hashSubmissionLinkToken } from "@/lib/submissionToken";
import { joinTeamWithExistingRsvp, organiserDeleteTeam, organiserMoveMember, resolveOrganiserEvent, resolveRsvpByTicketToken, respondToJoinRequest } from "@/lib/core/teams";
import { deleteRsvpForUser, restoreRsvpForUser } from "@/lib/core/rsvpAdmin";
import { resolveJudgeContext, resolveJudgingOrganiser, type JudgeContext, type JudgingOrganiserContext } from "@/lib/judgingAccess";
import {
  assignJudge,
  buildJudgingExportRows,
  createEventAward,
  createJudgingCriterion,
  disqualifySubmission,
  listSubmissionsForJudge,
  listSubmissionsForOrganiser,
  loadEntrantSubmission,
  loadJudgeProgress,
  loadJudgingResults,
  loadJudgingResultsPage,
  loadProjectGallery,
  loadPublicResults,
  loadSubmissionForJudge,
  publishResults,
  reinstateSubmission,
  requestSubmissionLink,
  resolveEntrantBySubmissionLink,
  resolveEntrantByTeamManageToken,
  resolveEntrantForUser,
  saveJudgeScores,
  saveSubmissionDraft,
  searchAwardCandidates,
  setAwardWinner,
  setJudgingStatus,
  submitJudgeReview,
  submitSubmission,
  unpublishResults,
  updateJudgingSettings,
  withdrawSubmission,
  type EntrantAuth,
} from "@/lib/core/judging";
import type { TeamRegistrationIntent } from "@/lib/validators";

/*
 * docs/HACKATHON.md "Tests": the scenario suite for submissions, judging, and
 * results against PostgreSQL. lib/core/judging.ts owns every rule; this file
 * drives the cores the way Server Actions and route handlers do.
 */

const suffix = randomUUID().replaceAll("-", "");
const orgSlug = `judging-${suffix}`;
const otherOrgSlug = `judging-other-${suffix}`;
const startedAt = new Date();
const HOUR = 3_600_000;

let organisationId = "";
let otherOrganisationId = "";
let organiserId = "";
let otherOrganiserId = "";
const judgeIds: string[] = [];
const userIds: string[] = [];
let sequence = 0;

type EventOptions = {
  organisation?: string;
  registrationMode?: RegistrationMode;
  privacyType?: EventPrivacyType;
  status?: EventStatus;
  pagePublished?: boolean;
  capacity?: number;
};

async function createEvent(options: EventOptions = {}): Promise<Event> {
  const mode = options.registrationMode ?? RegistrationMode.TEAM;
  return prisma.event.create({ data: {
    organisationId: options.organisation ?? organisationId,
    title: `Judging ${suffix}`,
    slug: `judging-${suffix}-${randomUUID().slice(0, 8)}`,
    startDateTime: new Date(Date.now() + 24 * HOUR),
    endDateTime: new Date(Date.now() + 48 * HOUR),
    timezone: "UTC",
    status: options.status ?? EventStatus.PUBLISHED,
    privacyType: options.privacyType ?? EventPrivacyType.PUBLIC,
    capacity: options.capacity,
    registrationMode: mode,
    teamMaxSize: mode === RegistrationMode.TEAM ? 4 : undefined,
    soloPolicy: SoloPolicy.SOLO_ALLOWED,
    page: { create: { isPublished: options.pagePublished ?? true } },
  } });
}

function slugFor(event: Event) {
  return event.organisationId === otherOrganisationId ? otherOrgSlug : orgSlug;
}

type Registered = { rsvpId: string; ticketToken: string; teamId: string | null; status: RsvpStatus };

async function register(event: Event, label: string, options: { team?: TeamRegistrationIntent; userId?: string } = {}): Promise<Registered> {
  sequence += 1;
  const result = await submitRsvpCore(
    {
      orgSlug: slugFor(event),
      eventSlug: event.slug,
      ...(options.userId ? {} : { guestEmail: `${label}-${sequence}-${suffix}@example.test` }),
      name: `${label} Person`,
      answers: {},
    },
    { userId: options.userId ?? null, ...(options.team ? { team: options.team } : {}) },
  );
  if (!result.ok || !result.data) throw new Error(`registration failed: ${result.ok ? "no data" : result.error}`);
  const rsvp = await prisma.rSVP.findUniqueOrThrow({ where: { checkInToken: result.data.ticketToken } });
  return { rsvpId: rsvp.id, ticketToken: result.data.ticketToken, teamId: rsvp.teamId, status: rsvp.status };
}

async function createTeam(event: Event, name: string, userId?: string) {
  const leader = await register(event, "leader", { team: { mode: "create", name }, userId });
  if (!leader.teamId) throw new Error("team was not created");
  return { leader, teamId: leader.teamId };
}

async function joinTeam(event: Event, teamId: string, options: { userId?: string; label?: string } = {}) {
  const team = await prisma.team.findUniqueOrThrow({ where: { id: teamId } });
  return register(event, options.label ?? "member", { team: { mode: "join", joinToken: team.joinToken }, userId: options.userId });
}

/** The raw management token only exists in the leader's outbox email; pick the one still valid. */
async function teamAuth(teamId: string): Promise<EntrantAuth> {
  const team = await prisma.team.findUniqueOrThrow({ where: { id: teamId }, select: { manageTokenHash: true } });
  const messages = await prisma.outboxMessage.findMany({ where: { kind: "team-created", payload: { path: ["teamId"], equals: teamId } } });
  const token = messages
    .map((message) => (message.payload as { manageToken?: string }).manageToken)
    .find((raw) => raw && hashTeamManageToken(raw) === team.manageTokenHash);
  if (!token) throw new Error("no valid management token queued");
  const auth = await resolveEntrantByTeamManageToken(token);
  if (!auth) throw new Error("management token did not resolve");
  return auth;
}

/** The raw submission token only exists in the emailed link; pick the one matching the stored digest. */
async function currentSubmissionToken(rsvpId: string) {
  const link = await prisma.submissionLink.findUniqueOrThrow({ where: { rsvpId } });
  const messages = await prisma.outboxMessage.findMany({ where: { kind: "submission-link", payload: { path: ["rsvpId"], equals: rsvpId } } });
  const token = messages
    .map((message) => (message.payload as { token?: string }).token)
    .find((raw) => raw && hashSubmissionLinkToken(raw) === link.tokenHash);
  if (!token) throw new Error("no valid submission link queued");
  return token;
}

async function soloAuth(rsvpId: string, eventId: string): Promise<EntrantAuth> {
  const requested = await requestSubmissionLink({ rsvpId, eventId });
  if (!requested.ok) throw new Error(requested.error);
  const auth = await resolveEntrantBySubmissionLink(await currentSubmissionToken(rsvpId));
  if (!auth) throw new Error("submission link did not resolve");
  return auth;
}

async function organiser(event: Event, userId = organiserId): Promise<JudgingOrganiserContext> {
  const ctx = await resolveJudgingOrganiser(userId, slugFor(event), event.id);
  if (!ctx) throw new Error("organiser context missing");
  return ctx;
}

async function setWindow(ctx: JudgingOrganiserContext, opensAt: Date, closesAt: Date, extra: { judgesSeeAll?: boolean; projectGalleryPublic?: boolean } = {}) {
  const result = await updateJudgingSettings(ctx, {
    submissionsEnabled: true,
    submissionsOpenAt: opensAt.toISOString(),
    submissionsCloseAt: closesAt.toISOString(),
    judgesSeeAll: extra.judgesSeeAll ?? true,
    projectGalleryPublic: extra.projectGalleryPublic ?? true,
  });
  if (!result.ok) throw new Error(result.error);
}

function openWindow(ctx: JudgingOrganiserContext, extra?: { judgesSeeAll?: boolean; projectGalleryPublic?: boolean }) {
  return setWindow(ctx, new Date(Date.now() - HOUR), new Date(Date.now() + HOUR), extra);
}

/** Close the window by moving it into the past (the gallery then becomes eligible). */
function closeWindow(ctx: JudgingOrganiserContext, extra?: { judgesSeeAll?: boolean; projectGalleryPublic?: boolean }) {
  return setWindow(ctx, new Date(Date.now() - 2 * HOUR), new Date(Date.now() - HOUR), extra);
}

async function createUser(label: string) {
  const user = await prisma.user.create({ data: { name: `${label} ${suffix.slice(0, 6)}`, email: `${label}-${randomUUID().slice(0, 8)}-${suffix}@example.test`, emailVerified: new Date() } });
  userIds.push(user.id);
  return user;
}

/** A user holding only the JUDGE grant on `event`. */
async function createJudge(event: Event, label = "judge"): Promise<{ userId: string; ctx: JudgeContext }> {
  const user = await createUser(label);
  judgeIds.push(user.id);
  await prisma.eventCollaborator.create({ data: { eventId: event.id, userId: user.id, permissions: [EventPermission.JUDGE] } });
  const ctx = await resolveJudgeContext(user.id, slugFor(event), event.id);
  if (!ctx) throw new Error("judge context missing");
  return { userId: user.id, ctx };
}

async function criterion(ctx: JudgingOrganiserContext, input: { name: string; weight: number; maxScore: number }) {
  const created = await createJudgingCriterion(ctx, input);
  if (!created.ok) throw new Error(created.error);
  return created.data.id;
}

async function submissionIdFor(entrant: { teamId?: string | null; rsvpId?: string }) {
  const row = await prisma.submission.findFirstOrThrow({ where: entrant.teamId ? { teamId: entrant.teamId } : { rsvpId: entrant.rsvpId } });
  return row.id;
}

/**
 * What `/{org}/{event}/results` and `/projects` do (docs/HACKATHON.md): the
 * event page's visibility, publication, and invite rules for this viewer
 * first (`resolvePublicJudgingEvent`), then the judging loader. Null is a 404.
 */
async function publicPage<T>(viewerUserId: string | null, eventId: string, load: (eventId: string) => Promise<T | null>) {
  const event = await prisma.event.findUniqueOrThrow({ where: { id: eventId }, select: { slug: true, organisationId: true } });
  authMock.mockResolvedValue(viewerUserId ? { user: { id: viewerUserId } } : null);
  try {
    const resolved = await resolvePublicJudgingEvent(event.organisationId === otherOrganisationId ? otherOrgSlug : orgSlug, event.slug);
    return resolved ? load(resolved.event.id) : null;
  } finally {
    authMock.mockResolvedValue(null);
  }
}

const content = { title: "Byte Me", summary: "A project.", repoUrl: "https://github.com/example/project" };

describe.sequential("hackathon judging integration", () => {
  beforeAll(async () => {
    const [org, otherOrg] = await Promise.all([
      prisma.organisation.create({ data: { name: `Judging ${suffix}`, slug: orgSlug } }),
      prisma.organisation.create({ data: { name: `Judging other ${suffix}`, slug: otherOrgSlug } }),
    ]);
    organisationId = org.id;
    otherOrganisationId = otherOrg.id;
    const [owner, otherOwner] = await Promise.all([createUser("organiser"), createUser("other-organiser")]);
    organiserId = owner.id;
    otherOrganiserId = otherOwner.id;
    await prisma.membership.createMany({ data: [
      { userId: organiserId, organisationId, role: MembershipRole.ADMIN },
      { userId: otherOrganiserId, organisationId: otherOrganisationId, role: MembershipRole.ADMIN },
    ] });
  });

  afterAll(async () => {
    if (organisationId) await prisma.organisation.delete({ where: { id: organisationId } });
    if (otherOrganisationId) await prisma.organisation.delete({ where: { id: otherOrganisationId } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.outboxMessage.deleteMany({ where: { createdAt: { gte: startedAt } } });
    await prisma.auditEvent.deleteMany({ where: { createdAt: { gte: startedAt }, OR: [{ action: { startsWith: "JUDGING_" } }, { action: { startsWith: "SUBMISSION_" } }] } });
    await prisma.$disconnect();
  });

  // -------------------------------------------------------------------------
  // Submissions
  // -------------------------------------------------------------------------

  it("refuses submissions outside the window, while disabled, and for unpublished events", async () => {
    const event = await createEvent();
    const ctx = await organiser(event);
    const { teamId } = await createTeam(event, `Window ${suffix}`);
    const auth = await teamAuth(teamId);
    const closed = { ok: false, error: "Submissions are not open right now." };

    // Not enabled yet.
    expect(await saveSubmissionDraft(auth, content)).toMatchObject(closed);
    expect(await loadEntrantSubmission(auth)).toBeNull();

    // Opens in the future.
    await setWindow(ctx, new Date(Date.now() + HOUR), new Date(Date.now() + 2 * HOUR));
    expect(await submitSubmission(auth, content)).toMatchObject(closed);
    expect(await loadEntrantSubmission(auth)).toMatchObject({ window: { isOpen: false }, canEdit: false, submission: null });

    // Open: draft, edit, submit.
    await openWindow(ctx);
    expect(await saveSubmissionDraft(auth, content)).toMatchObject({ ok: true, data: { status: SubmissionStatus.DRAFT } });
    expect(await submitSubmission(auth, content)).toMatchObject({ ok: true, data: { status: SubmissionStatus.SUBMITTED } });
    // Saving a draft of a submitted project is an edit; it stays submitted.
    expect(await saveSubmissionDraft(auth, { ...content, title: "Edited" })).toMatchObject({ ok: true, data: { status: SubmissionStatus.SUBMITTED } });

    // Closed (in the past): no edits, no withdrawal, content unchanged.
    await closeWindow(ctx);
    expect(await submitSubmission(auth, { ...content, title: "Too late" })).toMatchObject(closed);
    expect(await saveSubmissionDraft(auth, { ...content, title: "Too late" })).toMatchObject(closed);
    expect(await withdrawSubmission(auth)).toMatchObject(closed);
    expect(await prisma.submission.findFirstOrThrow({ where: { teamId } })).toMatchObject({ title: "Edited", status: SubmissionStatus.SUBMITTED });
    expect(await loadEntrantSubmission(auth)).toMatchObject({ canEdit: false, submission: { title: "Edited" } });

    // Open window but the event is no longer published.
    await openWindow(ctx);
    const solo = await register(event, "solo");
    await prisma.event.update({ where: { id: event.id }, data: { status: EventStatus.CANCELLED } });
    expect(await submitSubmission(auth, content)).toMatchObject(closed);
    expect(await requestSubmissionLink({ rsvpId: solo.rsvpId, eventId: event.id })).toMatchObject({ ok: false, error: "This event is not taking project submissions." });
    // The entrant pages follow the event page's publication rule: a real 404.
    expect(await loadEntrantSubmission(auth)).toBeNull();
    await prisma.event.update({ where: { id: event.id }, data: { status: EventStatus.PUBLISHED } });
    await prisma.eventPage.update({ where: { eventId: event.id }, data: { isPublished: false } });
    expect(await loadEntrantSubmission(auth)).toBeNull();
    await prisma.eventPage.update({ where: { eventId: event.id }, data: { isPublished: true } });
    expect(await loadEntrantSubmission(auth)).toMatchObject({ canEdit: true, submission: { title: "Edited" } });

    // Turning submissions off closes the window too.
    expect(await updateJudgingSettings(ctx, { submissionsEnabled: false, submissionsOpenAt: "", submissionsCloseAt: "", judgesSeeAll: true, projectGalleryPublic: false })).toMatchObject({ ok: true });
    expect(await submitSubmission(auth, content)).toMatchObject(closed);
    expect(await prisma.auditEvent.count({ where: { action: "JUDGING_SETTINGS_UPDATED", targetId: event.id } })).toBeGreaterThanOrEqual(5);
  });

  it("refuses non-confirmed entrants", async () => {
    const event = await createEvent();
    const ctx = await organiser(event);
    await openWindow(ctx);
    const notConfirmed = { ok: false, error: "Only confirmed registrations can submit a project." };

    // A team that drafted while confirmed, then went to the waitlist.
    const { teamId } = await createTeam(event, `Moved ${suffix}`);
    const auth = await teamAuth(teamId);
    expect(await saveSubmissionDraft(auth, content)).toMatchObject({ ok: true });
    for (const status of [RsvpStatus.WAITLISTED, RsvpStatus.PENDING_APPROVAL, RsvpStatus.REJECTED]) {
      await prisma.$transaction([
        prisma.team.update({ where: { id: teamId }, data: { status } }),
        prisma.rSVP.updateMany({ where: { teamId }, data: { status } }),
      ]);
      // A declined (REJECTED) team is final, like the team-side refusals in lib/core/teams.ts.
      const declined = status === RsvpStatus.REJECTED;
      const refusal = declined ? { ok: false, error: "The organisers declined this registration, so its project can't be submitted or changed." } : notConfirmed;
      expect(await submitSubmission(auth, content)).toMatchObject(refusal);
      expect(await saveSubmissionDraft(auth, content)).toMatchObject(refusal);
      expect(await withdrawSubmission(auth)).toMatchObject(refusal);
      expect(await loadEntrantSubmission(auth)).toMatchObject({ confirmed: false, declined, canEdit: false });
    }
    expect((await prisma.submission.findFirstOrThrow({ where: { teamId } })).status).toBe(SubmissionStatus.DRAFT);

    // Solo registrants: no link and no submission unless confirmed.
    const solo = await register(event, "solo");
    const link = await soloAuth(solo.rsvpId, event.id);
    await prisma.rSVP.update({ where: { id: solo.rsvpId }, data: { status: RsvpStatus.WAITLISTED } });
    expect(await submitSubmission(link, content)).toMatchObject(notConfirmed);
    await prisma.submissionLink.update({ where: { rsvpId: solo.rsvpId }, data: { createdAt: new Date(Date.now() - HOUR) } });
    expect(await requestSubmissionLink({ rsvpId: solo.rsvpId, eventId: event.id })).toMatchObject(notConfirmed);

    // A cancelled solo registration takes its submission with it.
    await prisma.rSVP.update({ where: { id: solo.rsvpId }, data: { status: RsvpStatus.CONFIRMED } });
    expect(await submitSubmission(link, content)).toMatchObject({ ok: true });
    await prisma.rSVP.delete({ where: { id: solo.rsvpId } });
    expect(await prisma.submission.count({ where: { rsvpId: solo.rsvpId } })).toBe(0);
    expect(await resolveEntrantBySubmissionLink(await prisma.outboxMessage.findFirstOrThrow({
      where: { kind: "submission-link", payload: { path: ["rsvpId"], equals: solo.rsvpId } },
    }).then((message) => (message.payload as { token: string }).token))).toBeNull();
  });

  it("keeps entrants, organisers, and judges inside their own event and organisation", async () => {
    const event = await createEvent();
    const sibling = await createEvent();
    const foreign = await createEvent({ organisation: otherOrganisationId });
    const ctx = await organiser(event);
    const siblingCtx = await organiser(sibling);
    const foreignCtx = await organiser(foreign, otherOrganiserId);
    for (const c of [ctx, siblingCtx, foreignCtx]) await openWindow(c);

    const { teamId } = await createTeam(event, `Home ${suffix}`);
    const auth = await teamAuth(teamId);
    expect(await submitSubmission(auth, content)).toMatchObject({ ok: true });
    const own = await submissionIdFor({ teamId });

    // An entrant proof re-scoped to another event (same org or another org) finds nothing.
    for (const eventId of [sibling.id, foreign.id]) {
      expect(await submitSubmission({ ...auth, eventId }, content)).toMatchObject({ ok: false, error: "Submission not found." });
      expect(await withdrawSubmission({ ...auth, eventId })).toMatchObject({ ok: false });
      expect(await loadEntrantSubmission({ ...auth, eventId })).toBeNull();
    }
    expect(await prisma.submission.count({ where: { eventId: { in: [sibling.id, foreign.id] } } })).toBe(0);
    // A team member account is only an entrant on its own event.
    const memberUser = await createUser("member");
    await joinTeam(event, teamId, { userId: memberUser.id });
    expect(await resolveEntrantForUser(memberUser.id, event.id)).toMatchObject({ kind: "team-member", teamId });
    expect(await resolveEntrantForUser(memberUser.id, sibling.id)).toBeNull();

    // Organisers: the resolver re-reads the event in the slug's organisation.
    expect(await resolveJudgingOrganiser(organiserId, orgSlug, foreign.id)).toBeNull();
    expect(await resolveJudgingOrganiser(organiserId, otherOrgSlug, foreign.id)).toBeNull();
    expect(await resolveJudgeContext(organiserId, orgSlug, foreign.id)).toBeNull();
    // A forged context (own organisation, foreign event) changes and reads nothing.
    const forged: JudgingOrganiserContext = { ...ctx, eventId: foreign.id, eventSlug: foreign.slug };
    expect(await updateJudgingSettings(forged, { submissionsEnabled: false, submissionsOpenAt: "", submissionsCloseAt: "", judgesSeeAll: true, projectGalleryPublic: false })).toMatchObject({ ok: false, error: "Event not found." });
    expect(await createJudgingCriterion(forged, { name: "X", weight: 1, maxScore: 5 })).toMatchObject({ ok: false });
    expect(await setJudgingStatus(forged, JudgingStatus.OPEN)).toMatchObject({ ok: false });
    expect(await publishResults(forged)).toMatchObject({ ok: false });
    expect(await loadJudgingResults(forged)).toBeNull();
    expect(await buildJudgingExportRows(forged)).toBeNull();
    expect(await listSubmissionsForOrganiser(forged)).toEqual({ submissions: [], nextCursor: null });
    expect(await loadJudgeProgress(forged)).toBeNull();
    expect(await loadJudgingResultsPage(forged)).toBeNull();
    expect(await searchAwardCandidates(forged)).toBeNull();
    expect((await prisma.event.findUniqueOrThrow({ where: { id: foreign.id } })).submissionsEnabled).toBe(true);

    // Ids from another event of the same organisation are refused.
    const siblingAward = await createEventAward(siblingCtx, { name: "Sibling award" });
    if (!siblingAward.ok) throw new Error(siblingAward.error);
    expect(await setAwardWinner(ctx, { awardId: siblingAward.data.id, submissionId: own })).toMatchObject({ ok: false, error: "Award not found." });
    expect(await setAwardWinner(siblingCtx, { awardId: siblingAward.data.id, submissionId: own })).toMatchObject({ ok: false, error: "Submission not found." });
    expect(await disqualifySubmission(siblingCtx, { submissionId: own, reason: "Nope" })).toMatchObject({ ok: false });
    const judge = await createJudge(event);
    expect(await assignJudge(siblingCtx, { judgeUserId: judge.userId, submissionId: own })).toMatchObject({ ok: false });
    expect((await prisma.submission.findUniqueOrThrow({ where: { id: own } })).status).toBe(SubmissionStatus.SUBMITTED);

    // A judge's context forged onto another event, and another event's criterion.
    const forgedJudge: JudgeContext = { ...judge.ctx, eventId: foreign.id };
    expect(await listSubmissionsForJudge(forgedJudge)).toBeNull();
    expect(await listSubmissionsForJudge({ ...judge.ctx, eventId: sibling.id })).toBeNull();
    const homeCriterion = await criterion(ctx, { name: "Impact", weight: 1, maxScore: 5 });
    const siblingCriterion = await criterion(siblingCtx, { name: "Sibling", weight: 1, maxScore: 5 });
    expect(await setJudgingStatus(ctx, JudgingStatus.OPEN)).toMatchObject({ ok: true });
    expect(await saveJudgeScores(judge.ctx, { submissionId: own, scores: [{ criterionId: siblingCriterion, score: 3 }] })).toMatchObject({ ok: false, error: "Unknown criterion." });
    expect(await saveJudgeScores(judge.ctx, { submissionId: own, scores: [{ criterionId: homeCriterion, score: 3 }] })).toMatchObject({ ok: true });
  });

  it("never lets a solo submission token edit another entrant", async () => {
    const event = await createEvent({ registrationMode: RegistrationMode.INDIVIDUAL });
    const other = await createEvent({ registrationMode: RegistrationMode.INDIVIDUAL });
    await openWindow(await organiser(event));
    await openWindow(await organiser(other));
    const alice = await register(event, "alice");
    const bob = await register(event, "bob");
    const carol = await register(other, "carol");

    // Holding a ticket only lets the holder ask for an email to the registration's own address.
    const holder = await resolveRsvpByTicketToken(alice.ticketToken, null);
    if (!holder) throw new Error("ticket did not resolve");
    expect(await requestSubmissionLink(holder)).toEqual({ ok: true, data: { sent: true } });
    const message = await prisma.outboxMessage.findFirstOrThrow({ where: { kind: "submission-link", payload: { path: ["rsvpId"], equals: alice.rsvpId } } });
    const aliceRsvp = await prisma.rSVP.findUniqueOrThrow({ where: { id: alice.rsvpId } });
    expect((message.payload as { to: string }).to).toBe(aliceRsvp.guestEmail);
    // Only the digest is stored.
    const stored = await prisma.submissionLink.findUniqueOrThrow({ where: { rsvpId: alice.rsvpId } });
    expect(stored.tokenHash).not.toBe((message.payload as { token: string }).token);

    const aliceAuth = await resolveEntrantBySubmissionLink(await currentSubmissionToken(alice.rsvpId));
    if (!aliceAuth || aliceAuth.kind !== "solo-link") throw new Error("link did not resolve");
    expect(await submitSubmission(aliceAuth, { title: "Alice" })).toMatchObject({ ok: true });

    // Alice's link with Bob's (or Carol's) registration id: nothing.
    for (const forged of [{ ...aliceAuth, rsvpId: bob.rsvpId }, { ...aliceAuth, rsvpId: carol.rsvpId, eventId: other.id }]) {
      expect(await submitSubmission(forged, { title: "Hijack" })).toMatchObject({ ok: false, error: "Submission not found." });
      expect(await saveSubmissionDraft(forged, { title: "Hijack" })).toMatchObject({ ok: false });
      expect(await withdrawSubmission(forged)).toMatchObject({ ok: false });
      expect(await loadEntrantSubmission(forged)).toBeNull();
    }
    expect(await prisma.submission.count({ where: { rsvpId: { in: [bob.rsvpId, carol.rsvpId] } } })).toBe(0);
    // A solo-owner proof for an account that does not own the RSVP.
    const stranger = await createUser("stranger");
    expect(await submitSubmission({ kind: "solo-owner", eventId: event.id, rsvpId: bob.rsvpId, userId: stranger.id }, { title: "Hijack" })).toMatchObject({ ok: false });
    expect(await resolveEntrantForUser(stranger.id, event.id)).toBeNull();
    // Malformed and unknown tokens.
    expect(await resolveEntrantBySubmissionLink("x".repeat(43))).toBeNull();
    expect(await resolveEntrantBySubmissionLink("short")).toBeNull();

    // Within the cooldown no new link is sent; after it, regenerating retires the old link.
    const firstToken = await currentSubmissionToken(alice.rsvpId);
    expect(await requestSubmissionLink(holder)).toEqual({ ok: true, data: { sent: false } });
    await prisma.submissionLink.update({ where: { rsvpId: alice.rsvpId }, data: { createdAt: new Date(Date.now() - HOUR) } });
    expect(await requestSubmissionLink(holder)).toEqual({ ok: true, data: { sent: true } });
    const secondToken = await currentSubmissionToken(alice.rsvpId);
    expect(secondToken).not.toBe(firstToken);
    expect(await resolveEntrantBySubmissionLink(firstToken)).toBeNull();
    expect(await submitSubmission(aliceAuth, { title: "Old link" })).toMatchObject({ ok: false });
    expect(await resolveEntrantBySubmissionLink(secondToken)).toMatchObject({ kind: "solo-link", rsvpId: alice.rsvpId });

    // Team members never get a solo link: their team page or account edits the team project.
    const teamEvent = await createEvent();
    await openWindow(await organiser(teamEvent));
    const { leader } = await createTeam(teamEvent, `Linkless ${suffix}`);
    expect(await requestSubmissionLink({ rsvpId: leader.rsvpId, eventId: teamEvent.id })).toMatchObject({ ok: false });
    // A ticket's registration id paired with another event is refused.
    expect(await requestSubmissionLink({ rsvpId: bob.rsvpId, eventId: other.id })).toMatchObject({ ok: false, error: "Submission not found." });
  });

  // -------------------------------------------------------------------------
  // Judges
  // -------------------------------------------------------------------------

  it("gives a JUDGE-only collaborator the judging workspace and nothing else", async () => {
    const event = await createEvent();
    const other = await createEvent();
    const ctx = await organiser(event);
    await openWindow(ctx);
    const { teamId } = await createTeam(event, `Judged ${suffix}`);
    await submitSubmission(await teamAuth(teamId), content);
    const judge = await createJudge(event);

    // No other permission check treats JUDGE as its grant.
    for (const permission of Object.values(EventPermission).filter((p) => p !== EventPermission.JUDGE)) {
      expect(await canAccessEvent({ userId: judge.userId, organisationId, eventId: event.id, permission }), permission).toBe(false);
    }
    expect(await canAccessEvent({ userId: judge.userId, organisationId, eventId: event.id, permission: EventPermission.JUDGE })).toBe(true);
    const grant = await prisma.eventCollaborator.findFirstOrThrow({ where: { eventId: event.id, userId: judge.userId } });
    expect(judgingPermissionsFor(false, false, grant.permissions)).toEqual({ canJudge: true, canManageJudging: false, isJudgeOnly: true });

    // No organiser read models: guests, teams, judging setup, mobile organiser API.
    expect(await resolveJudgingOrganiser(judge.userId, orgSlug, event.id)).toBeNull();
    expect(await resolveOrganiserEvent(judge.userId, orgSlug, event.id)).toBeNull();
    expect(await resolveEventContext(judge.userId, orgSlug, event.id)).toBeNull();
    expect(await listOrgEvents(judge.userId, orgSlug, "all", "https://yuyu.example.test")).toBeNull();

    // Not another event: no judge context, no workspace, no submission by id.
    expect(await resolveJudgeContext(judge.userId, orgSlug, other.id)).toBeNull();
    expect(await canAccessEvent({ userId: judge.userId, organisationId, eventId: other.id, permission: EventPermission.JUDGE })).toBe(false);
    await openWindow(await organiser(other));
    const { teamId: otherTeam } = await createTeam(other, `Elsewhere ${suffix}`);
    await submitSubmission(await teamAuth(otherTeam), content);
    const otherSubmission = await submissionIdFor({ teamId: otherTeam });
    expect(await listSubmissionsForJudge({ ...judge.ctx, eventId: other.id })).toBeNull();
    expect(await loadSubmissionForJudge(judge.ctx, otherSubmission)).toBeNull();

    // The workspace shows project content only: no emails, answers, tickets, or reasons.
    const workspace = await listSubmissionsForJudge(judge.ctx);
    expect(workspace?.submissions.map((s) => s.title)).toEqual([content.title]);
    const serialised = JSON.stringify([workspace, await loadSubmissionForJudge(judge.ctx, await submissionIdFor({ teamId }))]);
    expect(serialised).not.toMatch(/@example\.test|checkInToken|ticket|manageToken|joinToken|guestEmail|answers|disqualifiedReason/i);

    // Main's permission model (docs/PERMISSIONS.md): no registration, check-in
    // list, email draft, webhook, or export surface accepts a JUDGE-only grant.
    expect(await canManageRegistrationsFor({ userId: judge.userId, organisationId, eventId: event.id })).toBe(false);
    expect(eventCapabilities(null, grant.permissions)).toMatchObject({
      canJudge: true,
      isJudgeOnly: true,
      canManageJudging: false,
      canManageRegistrations: false,
      canExportAttendees: false,
      canViewAnalytics: false,
      canCheckIn: false,
      canCheckInToLists: false,
      canManageCheckInLists: false,
      canSendEmails: false,
      canEditPageContent: false,
      canManageCollaborators: false,
    });
    const someone = await register(event, "guest");
    const ref = { organisationSlug: orgSlug, eventId: event.id };
    expect(await approveRsvpForUser(judge.userId, { ...ref, rsvpId: someone.rsvpId })).toMatchObject({ ok: false });
    expect(await reacceptRsvpForUser(judge.userId, { ...ref, rsvpId: someone.rsvpId })).toMatchObject({ ok: false });
    expect(await deleteRsvpForUser(judge.userId, { ...ref, rsvpId: someone.rsvpId })).toMatchObject({ ok: false });
    expect(await createCheckInListForUser(judge.userId, { ...ref, name: "Swag" })).toEqual({ ok: false, error: "You do not have permission to manage check-in lists." });
    const list = await prisma.checkInList.create({ data: { eventId: event.id, name: `Lunch ${suffix}` } });
    expect(await checkInToListForUser(judge.userId, { ...ref, listId: list.id, rsvpId: someone.rsvpId })).toEqual({ ok: false, error: "You do not have permission to operate check-in." });
    expect(await lookupListAttendeesForUser(judge.userId, { ...ref, listId: list.id, query: "guest" })).toMatchObject({ ok: false });
    expect(await prisma.checkInListRecord.count({ where: { listId: list.id } })).toBe(0);
    const draft = { ...ref, subject: "Hi", body: "<p>Hi</p>", design: "minimal", statuses: ["CONFIRMED"], attendance: "ANY", templateId: null };
    expect(await saveEventBroadcastDraftForUser(judge.userId, draft)).toMatchObject({ ok: false });
    expect(await loadEventBroadcastDraftForUser(judge.userId, ref)).toMatchObject({ ok: false });
    expect(await prisma.eventBroadcastDraft.count({ where: { eventId: event.id } })).toBe(0);
    expect(canManageWebhooks(await getMembership(judge.userId, organisationId))).toBe(false);
    authMock.mockResolvedValue({ user: { id: judge.userId } });
    try {
      const response = await exportAttendees(new Request("https://yuyu.example.test/api/exports"), { params: Promise.resolve({ eventId: event.id }) });
      expect(response.status).toBe(404);
    } finally {
      authMock.mockResolvedValue(null);
    }

    // Revoking the grant closes the workspace immediately, even with an old context.
    await prisma.eventCollaborator.delete({ where: { id: grant.id } });
    expect(await resolveJudgeContext(judge.userId, orgSlug, event.id)).toBeNull();
    expect(await listSubmissionsForJudge(judge.ctx)).toBeNull();
  });

  it("hides conflicted submissions from judges and refuses their scores", async () => {
    const event = await createEvent();
    const ctx = await organiser(event);
    await openWindow(ctx);
    const judge = await createJudge(event, "conflicted");

    // The judge's account is a member (not leader) of one team.
    const { teamId: ownTeam } = await createTeam(event, `Own ${suffix}`);
    await joinTeam(event, ownTeam, { userId: judge.userId });
    const { teamId: fairTeam } = await createTeam(event, `Fair ${suffix}`);
    for (const teamId of [ownTeam, fairTeam]) expect(await submitSubmission(await teamAuth(teamId), content)).toMatchObject({ ok: true });
    const ownSubmission = await submissionIdFor({ teamId: ownTeam });
    const fairSubmission = await submissionIdFor({ teamId: fairTeam });

    // An org admin judging their own solo registration is conflicted too.
    const soloEvent = await createEvent({ registrationMode: RegistrationMode.INDIVIDUAL });
    const soloCtx = await organiser(soloEvent);
    await openWindow(soloCtx);
    const adminSolo = await register(soloEvent, "admin", { userId: organiserId });
    const adminEntrant = await resolveEntrantForUser(organiserId, soloEvent.id);
    expect(adminEntrant).toMatchObject({ kind: "solo-owner", rsvpId: adminSolo.rsvpId });
    expect(await submitSubmission(adminEntrant!, { title: "Admin project" })).toMatchObject({ ok: true });
    const adminJudge = await resolveJudgeContext(organiserId, orgSlug, soloEvent.id);
    expect(adminJudge).toMatchObject({ isAdmin: true });
    expect((await listSubmissionsForJudge(adminJudge!))?.submissions).toEqual([]);

    const c = await criterion(ctx, { name: "Impact", weight: 1, maxScore: 5 });
    expect(await setJudgingStatus(ctx, JudgingStatus.OPEN)).toMatchObject({ ok: true });

    const visible = (await listSubmissionsForJudge(judge.ctx))?.submissions.map((s) => s.id);
    expect(visible).toEqual([fairSubmission]);
    expect(await loadSubmissionForJudge(judge.ctx, ownSubmission)).toBeNull();
    expect(await saveJudgeScores(judge.ctx, { submissionId: ownSubmission, scores: [{ criterionId: c, score: 5 }] })).toMatchObject({ ok: false, error: "Submission not found." });
    expect(await submitJudgeReview(judge.ctx, { submissionId: ownSubmission, comment: "Mine!", submit: false })).toMatchObject({ ok: false });
    expect(await assignJudge(ctx, { judgeUserId: judge.userId, submissionId: ownSubmission })).toMatchObject({ ok: false, error: "This judge is registered on this entry, so they can't judge it." });
    expect(await prisma.judgeScore.count({ where: { submissionId: ownSubmission } })).toBe(0);
    expect(await prisma.judgeReview.count({ where: { submissionId: ownSubmission } })).toBe(0);

    // With per-judge assignment, unassigned submissions are hidden and unscorable.
    await openWindow(ctx, { judgesSeeAll: false });
    expect((await listSubmissionsForJudge(judge.ctx))?.submissions).toEqual([]);
    expect(await saveJudgeScores(judge.ctx, { submissionId: fairSubmission, scores: [{ criterionId: c, score: 4 }] })).toMatchObject({ ok: false });
    expect(await assignJudge(ctx, { judgeUserId: judge.userId, submissionId: fairSubmission })).toMatchObject({ ok: true });
    expect((await listSubmissionsForJudge(judge.ctx))?.submissions.map((s) => s.id)).toEqual([fairSubmission]);
    expect(await saveJudgeScores(judge.ctx, { submissionId: fairSubmission, scores: [{ criterionId: c, score: 4 }] })).toMatchObject({ ok: true });
    // Someone with no judging grant cannot be assigned.
    const outsider = await createUser("outsider");
    expect(await assignJudge(ctx, { judgeUserId: outsider.id, submissionId: fairSubmission })).toMatchObject({ ok: false, error: "This person is not a judge for this event." });
  });

  // -------------------------------------------------------------------------
  // Scoring
  // -------------------------------------------------------------------------

  it("refuses scores unless judging is open and the submission is submitted", async () => {
    const event = await createEvent();
    const ctx = await organiser(event);
    await openWindow(ctx);
    const judge = await createJudge(event);
    const { teamId } = await createTeam(event, `Scored ${suffix}`);
    const auth = await teamAuth(teamId);
    await submitSubmission(auth, content);
    const submissionId = await submissionIdFor({ teamId });
    const notOpen = { ok: false, error: "Judging is not open." };

    // Opening needs a rubric.
    expect(await setJudgingStatus(ctx, JudgingStatus.OPEN)).toMatchObject({ ok: false });
    const c = await criterion(ctx, { name: "Impact", weight: 1, maxScore: 5 });
    const score = (value: number) => saveJudgeScores(judge.ctx, { submissionId, scores: [{ criterionId: c, score: value }] });

    // NOT_STARTED.
    expect(await score(3)).toMatchObject(notOpen);
    expect(await submitJudgeReview(judge.ctx, { submissionId, comment: "Early" })).toMatchObject(notOpen);
    expect(await setJudgingStatus(ctx, JudgingStatus.CLOSED)).toMatchObject({ ok: false });

    // OPEN: the rubric freezes; scores must fit the criterion.
    expect(await setJudgingStatus(ctx, JudgingStatus.OPEN)).toMatchObject({ ok: true, data: { judgingStatus: JudgingStatus.OPEN } });
    expect(await createJudgingCriterion(ctx, { name: "Late", weight: 1, maxScore: 5 })).toMatchObject({ ok: false, error: "The rubric can only be changed before judging starts." });
    expect(await score(6)).toMatchObject({ ok: false });
    expect(await saveJudgeScores(judge.ctx, { submissionId, scores: [{ criterionId: c, score: -1 }] })).toMatchObject({ ok: false });
    expect(await saveJudgeScores(judge.ctx, { submissionId, scores: [{ criterionId: c, score: 2.5 }] })).toMatchObject({ ok: false });
    expect(await score(3)).toEqual({ ok: true, data: { scored: 1, total: 1 } });

    // Drafts and withdrawn projects are not judged.
    expect(await withdrawSubmission(auth)).toMatchObject({ ok: true });
    expect(await score(4)).toMatchObject({ ok: false, error: "Submission not found." });
    expect(await saveSubmissionDraft(auth, content)).toMatchObject({ ok: true, data: { status: SubmissionStatus.DRAFT } });
    expect(await score(4)).toMatchObject({ ok: false });
    expect(await submitSubmission(auth, content)).toMatchObject({ ok: true });
    expect(await score(4)).toMatchObject({ ok: true });

    // Disqualified projects are not judged either; reinstating restores them.
    expect(await disqualifySubmission(ctx, { submissionId, reason: "Copied" })).toMatchObject({ ok: true });
    expect(await score(5)).toMatchObject({ ok: false });
    expect(await reinstateSubmission(ctx, submissionId)).toMatchObject({ ok: true });
    expect(await submitJudgeReview(judge.ctx, { submissionId, comment: "Good" })).toEqual({ ok: true, data: { submitted: true } });

    // CLOSED freezes everything.
    expect(await setJudgingStatus(ctx, JudgingStatus.CLOSED)).toMatchObject({ ok: true });
    expect(await score(1)).toMatchObject(notOpen);
    expect(await submitJudgeReview(judge.ctx, { submissionId, comment: "Changed my mind" })).toMatchObject(notOpen);
    expect(await prisma.judgeScore.findFirstOrThrow({ where: { submissionId, judgeUserId: judge.userId } })).toMatchObject({ score: 4 });
    // Once scored, judging cannot go back to NOT_STARTED.
    expect(await setJudgingStatus(ctx, JudgingStatus.NOT_STARTED)).toMatchObject({ ok: false });
    expect(await prisma.auditEvent.count({ where: { action: "JUDGING_STATUS_CHANGED", targetId: event.id } })).toBe(2);
    expect(await prisma.auditEvent.count({ where: { action: { in: ["SUBMISSION_DISQUALIFIED", "SUBMISSION_REINSTATED"] }, targetId: submissionId } })).toBe(2);
    // The organiser-only reason never reaches the audit metadata.
    expect(JSON.stringify(await prisma.auditEvent.findMany({ where: { targetId: submissionId } }))).not.toContain("Copied");
  });

  it("keeps concurrent score, review, and submission writes unique", async () => {
    const event = await createEvent();
    // Hackathon emails are opt-in (off by default); this test covers sending them.
    await prisma.event.update({ where: { id: event.id }, data: { emailEntrantsOnResults: true, emailSubmissionReceipts: true } });
    const ctx = await organiser(event);
    await openWindow(ctx);
    const { teamId } = await createTeam(event, `Race ${suffix}`);
    const memberUser = await createUser("racer");
    await joinTeam(event, teamId, { userId: memberUser.id });
    const leaderAuth = await teamAuth(teamId);
    const memberAuth = await resolveEntrantForUser(memberUser.id, event.id);
    if (!memberAuth) throw new Error("member entrant missing");

    // Two people save the team's first draft at once: one row.
    const saves = await Promise.all([
      saveSubmissionDraft(leaderAuth, { title: "Leader" }),
      saveSubmissionDraft(memberAuth, { title: "Member" }),
      submitSubmission(leaderAuth, { title: "Leader submit" }),
      submitSubmission(memberAuth, { title: "Member submit" }),
    ]);
    expect(saves.some((save) => save.ok)).toBe(true);
    for (const save of saves) if (!save.ok) expect(save.error).toBe("This was changed by someone else. Refresh and try again.");
    expect(await prisma.submission.count({ where: { teamId } })).toBe(1);
    await submitSubmission(leaderAuth, content);
    const submissionId = await submissionIdFor({ teamId });
    const receipts = () => prisma.outboxMessage.count({ where: { kind: "submission-received", payload: { path: ["submissionId"], equals: submissionId } } });
    expect(await receipts()).toBe(1);
    // Concurrent submits of one existing draft: one transition, one receipt.
    expect(await withdrawSubmission(leaderAuth)).toMatchObject({ ok: true });
    expect(await saveSubmissionDraft(memberAuth, content)).toMatchObject({ ok: true, data: { status: SubmissionStatus.DRAFT } });
    const resubmits = await Promise.all([leaderAuth, memberAuth, leaderAuth, memberAuth].map((auth) => submitSubmission(auth, content)));
    expect(resubmits.every((result) => result.ok)).toBe(true);
    expect(await receipts()).toBe(2);

    const [first, second] = [await createJudge(event, "racer-a"), await createJudge(event, "racer-b")];
    const criteria = [await criterion(ctx, { name: "A", weight: 1, maxScore: 10 }), await criterion(ctx, { name: "B", weight: 2, maxScore: 10 })];
    await setJudgingStatus(ctx, JudgingStatus.OPEN);

    const writes = await Promise.all(
      [first, second].flatMap((judge) => [1, 2, 3, 4, 5, 6].map((value) => saveJudgeScores(judge.ctx, {
        submissionId,
        scores: criteria.map((criterionId) => ({ criterionId, score: value })),
      }))),
    );
    expect(writes.every((write) => write.ok)).toBe(true);
    expect(await prisma.judgeScore.count({ where: { submissionId } })).toBe(4);

    const reviews = await Promise.all([first, second].flatMap((judge) => [true, false, true].map((submit, index) => submitJudgeReview(judge.ctx, { submissionId, comment: `Take ${index}`, submit }))));
    expect(reviews.every((review) => review.ok)).toBe(true);
    expect(await prisma.judgeReview.count({ where: { submissionId } })).toBe(2);
    // A later draft save never un-submits a submitted review.
    expect(await prisma.judgeReview.count({ where: { submissionId, submittedAt: null } })).toBe(0);
  });

  it("computes the result score formula with shared tie ranks", async () => {
    const event = await createEvent();
    const ctx = await organiser(event);
    await openWindow(ctx);
    const teams = await Promise.all(["One", "Two", "Three", "Four"].map((name) => createTeam(event, `${name} ${suffix}`)));
    for (const team of teams) expect(await submitSubmission(await teamAuth(team.teamId), { title: `Project ${team.teamId.slice(-4)}` })).toMatchObject({ ok: true });
    const [s1, s2, s3, s4] = await Promise.all(teams.map((team) => submissionIdFor({ teamId: team.teamId })));

    const design = await criterion(ctx, { name: "Design", weight: 2, maxScore: 5 });
    const impact = await criterion(ctx, { name: "Impact", weight: 1, maxScore: 10 });
    const [j1, j2, j3] = [await createJudge(event, "j1"), await createJudge(event, "j2"), await createJudge(event, "j3")];
    await setJudgingStatus(ctx, JudgingStatus.OPEN);

    async function review(judge: JudgeContext, submissionId: string, designScore: number, impactScore: number, submit = true) {
      expect(await saveJudgeScores(judge, { submissionId, scores: [{ criterionId: design, score: designScore }, { criterionId: impact, score: impactScore }] })).toMatchObject({ ok: true });
      expect(await submitJudgeReview(judge, { submissionId, comment: "Private note", submit })).toMatchObject({ ok: true, data: { submitted: submit } });
    }

    // Σ(weight × score / maxScore) / Σ weight × 100, averaged over submitted reviews.
    // S1: J1 (5, 10) = 100; J2 (3, 4) = (1.2 + 0.4) / 3 = 53.33…; mean 76.67 -> 76.7.
    //     J3 saved scores but never submitted: not counted.
    await review(j1.ctx, s1, 5, 10);
    await review(j2.ctx, s1, 3, 4);
    await review(j3.ctx, s1, 0, 0, false);
    // S2: J1 (4, 8) = (1.6 + 0.8) / 3 = 80.
    await review(j1.ctx, s2, 4, 8);
    // S3: J2 (5, 4) = (2 + 0.4) / 3 = 80 — a tie with S2.
    await review(j2.ctx, s3, 5, 4);
    // S4: partial scores only; a submitted review needs every criterion.
    expect(await saveJudgeScores(j3.ctx, { submissionId: s4, scores: [{ criterionId: design, score: 5 }] })).toEqual({ ok: true, data: { scored: 1, total: 2 } });
    expect(await submitJudgeReview(j3.ctx, { submissionId: s4 })).toMatchObject({ ok: false, error: "Score every criterion before submitting your review." });

    const results = await loadJudgingResults(ctx);
    const row = (id: string) => results?.rows.find((r) => r.submissionId === id);
    expect(results?.rows.map((r) => [r.submissionId, r.score, r.rank, r.judgesCounted])).toEqual([
      [s2, 80, 1, 1],
      [s3, 80, 1, 1],
      [s1, 76.7, 3, 2],
      [s4, null, null, 0],
    ]);
    expect(row(s1)?.criterionAverages).toEqual([{ criterionId: design, average: 4 }, { criterionId: impact, average: 7 }]);
    const progress = await loadJudgeProgress(ctx);
    expect(progress?.find((j) => j.userId === j1.userId)).toMatchObject({ visible: 4, reviewsSubmitted: 2 });
    expect(progress?.find((j) => j.userId === j3.userId)).toMatchObject({ reviewsSubmitted: 0 });

    // The CSV rows carry the result and per-judge scores, never comments or emails.
    const csv = await buildJudgingExportRows(ctx);
    expect(csv?.[0]).toEqual(["Rank", "Project", "Entrant", "Status", "Result score", "Raw score", "Adjusted score", "Judges counted", "Judge", "Review submitted (UTC)", "Counted in score", "Design (/5, weight 2)", "Impact (/10, weight 1)"]);
    expect(csv?.filter((line) => line[4] === "76.7")).toHaveLength(3);
    expect(JSON.stringify(csv)).not.toMatch(/Private note|@example\.test/);
    // Review times use the event's clock, as ISO 8601 with the offset, like the dashboard.
    expect(csv?.slice(1).filter((line) => line[9]).every((line) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+00:00$/.test(line[9]!))).toBe(true);
    await prisma.event.update({ where: { id: event.id }, data: { timezone: "Asia/Kolkata" } });
    const zoned = await buildJudgingExportRows(ctx);
    expect(zoned?.[0]?.[9]).toBe("Review submitted (Asia/Kolkata)");
    const stamped = zoned?.slice(1).map((line) => line[9]).filter(Boolean) ?? [];
    expect(stamped.length).toBeGreaterThan(0);
    for (const stamp of stamped) {
      expect(stamp).toMatch(/\+05:30$/);
      // Same instant as the stored review time.
      expect(Number.isNaN(new Date(stamp!).getTime())).toBe(false);
    }
    const stored = await prisma.judgeReview.findMany({ where: { submission: { eventId: event.id }, submittedAt: { not: null } }, select: { submittedAt: true } });
    const instants = new Set(stored.map((review) => Math.floor(review.submittedAt!.getTime() / 1000)));
    expect(stamped.every((stamp) => instants.has(new Date(stamp!).getTime() / 1000))).toBe(true);

    // A disqualified project drops out of the ranking; the rest re-rank.
    expect(await disqualifySubmission(ctx, { submissionId: s2, reason: "Rules" })).toMatchObject({ ok: true });
    const after = await loadJudgingResults(ctx);
    expect(after?.rows.map((r) => [r.submissionId, r.score, r.rank])).toEqual([
      [s3, 80, 1],
      [s1, 76.7, 2],
      [s4, null, null],
      [s2, null, null],
    ]);
  });

  it("shows the Judging dashboard tab only on events that use judging", async () => {
    const event = await createEvent();
    const ctx = await organiser(event);
    const dashboard = async () => ({ event: await prisma.event.findUniqueOrThrow({ where: { id: event.id } }) }) as unknown as EventDashboardContext;
    expect(await eventUsesJudging(await dashboard())).toBe(false);
    await openWindow(ctx);
    expect(await eventUsesJudging(await dashboard())).toBe(true);
    const { teamId } = await createTeam(event, `Tab ${suffix}`);
    await saveSubmissionDraft(await teamAuth(teamId), { title: "Kept" });
    // Turned off with a project left: the tab stays so organisers can still manage it.
    expect(await updateJudgingSettings(ctx, { submissionsEnabled: false, submissionsOpenAt: "", submissionsCloseAt: "", judgesSeeAll: true, projectGalleryPublic: false })).toMatchObject({ ok: true });
    expect(await eventUsesJudging(await dashboard())).toBe(true);
    await prisma.submission.deleteMany({ where: { teamId } });
    expect(await eventUsesJudging(await dashboard())).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Entrant lifecycle (an entrant is a team or one RSVP, never both)
  // -------------------------------------------------------------------------

  it("never carries a solo project into a team the registrant joins", async () => {
    const event = await createEvent();
    const ctx = await organiser(event);
    await openWindow(ctx);
    const teamsCtx = await resolveOrganiserEvent(organiserId, orgSlug, event.id);
    const { teamId } = await createTeam(event, `Joiners ${suffix}`);

    // A SUBMITTED solo project blocks joining (entrant side) and an organiser move.
    const solo = await register(event, "solo");
    const soloEntrant = await soloAuth(solo.rsvpId, event.id);
    expect(await submitSubmission(soloEntrant, { title: "Solo project" })).toMatchObject({ ok: true });
    const invite = await prisma.teamJoinRequest.create({ data: { teamId, rsvpId: solo.rsvpId, direction: "INVITE" } });
    const holder = await resolveRsvpByTicketToken(solo.ticketToken, null);
    const accept = () => respondToJoinRequest({ actor: { kind: "seeker", holder: holder! }, requestId: invite.id, accept: true });
    expect(await accept()).toMatchObject({ ok: false, error: expect.stringContaining("Withdraw that project") });
    expect(await organiserMoveMember(teamsCtx!, { rsvpId: solo.rsvpId, targetTeamId: teamId })).toMatchObject({ ok: false, error: expect.stringContaining("disqualify it") });
    expect(await prisma.rSVP.findUniqueOrThrow({ where: { id: solo.rsvpId } })).toMatchObject({ teamId: null });

    // Once withdrawn, joining discards the solo project and retires its link.
    expect(await withdrawSubmission(soloEntrant)).toMatchObject({ ok: true });
    expect(await accept()).toMatchObject({ ok: true, data: { accepted: true } });
    expect(await prisma.submission.count({ where: { rsvpId: solo.rsvpId } })).toBe(0);
    expect(await prisma.submissionLink.count({ where: { rsvpId: solo.rsvpId } })).toBe(0);
    expect(await saveSubmissionDraft(soloEntrant, content)).toMatchObject({ ok: false });

    // A DISQUALIFIED solo project can't be shed by joining, but an organiser move removes it.
    const other = await register(event, "other");
    const otherEntrant = await soloAuth(other.rsvpId, event.id);
    expect(await submitSubmission(otherEntrant, { title: "Copied project" })).toMatchObject({ ok: true });
    const copied = await submissionIdFor({ rsvpId: other.rsvpId });
    expect(await disqualifySubmission(ctx, { submissionId: copied, reason: "Copied" })).toMatchObject({ ok: true });
    const otherInvite = await prisma.teamJoinRequest.create({ data: { teamId, rsvpId: other.rsvpId, direction: "INVITE" } });
    const otherHolder = await resolveRsvpByTicketToken(other.ticketToken, null);
    expect(await respondToJoinRequest({ actor: { kind: "seeker", holder: otherHolder! }, requestId: otherInvite.id, accept: true })).toMatchObject({ ok: false, error: expect.stringContaining("disqualified") });
    expect(await organiserMoveMember(teamsCtx!, { rsvpId: other.rsvpId, targetTeamId: teamId })).toMatchObject({ ok: true });
    expect(await prisma.submission.count({ where: { id: copied } })).toBe(0);
    expect(await prisma.submissionLink.count({ where: { rsvpId: other.rsvpId } })).toBe(0);

    // Only the team's own project remains for this event's entrants.
    expect(await submitSubmission(await teamAuth(teamId), { title: "Team project" })).toMatchObject({ ok: true });
    expect((await prisma.submission.findMany({ where: { eventId: event.id } })).map((row) => row.teamId)).toEqual([teamId]);
  });

  it("applies the solo project rules when a solo registrant joins a team by link", async () => {
    await prisma.webhookEndpoint.create({
      data: {
        organisationId,
        url: "https://hooks.example.test/judging",
        eventTypes: ["registration.status_changed"],
        secretEncrypted: "v1.placeholder.placeholder.placeholder",
      },
    });
    const since = new Date();
    const statusHooksFor = async (rsvpId: string) => {
      await flushWebhookEmits();
      const rows = await prisma.webhookDelivery.findMany({ where: { organisationId, eventType: "registration.status_changed", createdAt: { gte: since } } });
      return rows.filter((row) => (row.payload as { data: { registration: { id: string } } }).data.registration.id === rsvpId);
    };
    try {
      // One unit: the solo registrant is confirmed, the team waits.
      const event = await createEvent({ capacity: 1 });
      const ctx = await organiser(event);
      await openWindow(ctx);
      const solo = await register(event, "link-solo");
      expect(solo.status).toBe(RsvpStatus.CONFIRMED);
      const { teamId } = await createTeam(event, `Linkers ${suffix}`);
      const team = await prisma.team.findUniqueOrThrow({ where: { id: teamId } });
      const holder = await resolveRsvpByTicketToken(solo.ticketToken, null);
      if (!holder) throw new Error("ticket did not resolve");

      // A SUBMITTED solo project blocks the join; nothing moves or is emitted.
      const soloEntrant = await soloAuth(solo.rsvpId, event.id);
      expect(await submitSubmission(soloEntrant, { title: "Solo by link" })).toMatchObject({ ok: true });
      expect(await joinTeamWithExistingRsvp(holder, team.joinToken)).toMatchObject({ ok: false, error: expect.stringContaining("Withdraw that project") });
      expect(await prisma.rSVP.findUniqueOrThrow({ where: { id: solo.rsvpId } })).toMatchObject({ teamId: null, status: RsvpStatus.CONFIRMED });
      expect(await prisma.submission.findFirstOrThrow({ where: { rsvpId: solo.rsvpId } })).toMatchObject({ status: SubmissionStatus.SUBMITTED });
      expect(await statusHooksFor(solo.rsvpId)).toHaveLength(0);

      // Withdrawn: the join discards the solo project and retires its link,
      // and the status webhooks are still sent after the transaction commits.
      expect(await withdrawSubmission(soloEntrant)).toMatchObject({ ok: true });
      expect(await joinTeamWithExistingRsvp(holder, team.joinToken)).toMatchObject({ ok: true, data: { teamName: team.name } });
      expect(await prisma.rSVP.findUniqueOrThrow({ where: { id: solo.rsvpId } })).toMatchObject({ teamId });
      expect(await prisma.submission.count({ where: { rsvpId: solo.rsvpId } })).toBe(0);
      expect(await prisma.submissionLink.count({ where: { rsvpId: solo.rsvpId } })).toBe(0);
      expect(await saveSubmissionDraft(soloEntrant, content)).toMatchObject({ ok: false });
      expect((await statusHooksFor(solo.rsvpId)).length).toBeGreaterThan(0);

      // A DISQUALIFIED solo project can't be shed by joining with a link either.
      const open = await createEvent();
      const openCtx = await organiser(open);
      await openWindow(openCtx);
      const { teamId: openTeamId } = await createTeam(open, `Open linkers ${suffix}`);
      const openTeam = await prisma.team.findUniqueOrThrow({ where: { id: openTeamId } });
      const flagged = await register(open, "link-flagged");
      expect(await submitSubmission(await soloAuth(flagged.rsvpId, open.id), { title: "Flagged" })).toMatchObject({ ok: true });
      expect(await disqualifySubmission(openCtx, { submissionId: await submissionIdFor({ rsvpId: flagged.rsvpId }), reason: "Copied" })).toMatchObject({ ok: true });
      const flaggedHolder = await resolveRsvpByTicketToken(flagged.ticketToken, null);
      expect(await joinTeamWithExistingRsvp(flaggedHolder!, openTeam.joinToken)).toMatchObject({ ok: false, error: expect.stringContaining("disqualified") });
      expect(await prisma.rSVP.findUniqueOrThrow({ where: { id: flagged.rsvpId } })).toMatchObject({ teamId: null });

      // A draft is simply discarded.
      const drafter = await register(open, "link-drafter");
      expect(await saveSubmissionDraft(await soloAuth(drafter.rsvpId, open.id), content)).toMatchObject({ ok: true });
      const drafterHolder = await resolveRsvpByTicketToken(drafter.ticketToken, null);
      expect(await joinTeamWithExistingRsvp(drafterHolder!, openTeam.joinToken)).toMatchObject({ ok: true });
      expect(await prisma.submission.count({ where: { rsvpId: drafter.rsvpId } })).toBe(0);
    } finally {
      await prisma.webhookEndpoint.deleteMany({ where: { organisationId } });
    }
  });

  it("stores project links in canonical https:// form", async () => {
    const event = await createEvent();
    const ctx = await organiser(event);
    await openWindow(ctx);
    const { teamId } = await createTeam(event, `Caps ${suffix}`);
    // An auto-capitalised scheme and a slashless one both satisfy the database CHECK.
    expect(await submitSubmission(await teamAuth(teamId), { title: "Caps", repoUrl: "HTTPS://GitHub.com/acme/app", demoUrl: "https:demo.example.test/x" })).toMatchObject({ ok: true });
    expect(await prisma.submission.findFirstOrThrow({ where: { teamId } })).toMatchObject({ repoUrl: "https://github.com/acme/app", demoUrl: "https://demo.example.test/x" });
  });

  it("restores a deleted team's project and judging record on undo", async () => {
    const event = await createEvent();
    const ctx = await organiser(event);
    await openWindow(ctx);
    const teamsCtx = await resolveOrganiserEvent(organiserId, orgSlug, event.id);
    const { teamId } = await createTeam(event, `Undo ${suffix}`);
    expect(await submitSubmission(await teamAuth(teamId), { title: "Undo me" })).toMatchObject({ ok: true });
    const submissionId = await submissionIdFor({ teamId });
    const c = await criterion(ctx, { name: "Impact", weight: 1, maxScore: 10 });
    const judge = await createJudge(event, "undo-judge");
    await setJudgingStatus(ctx, JudgingStatus.OPEN);
    expect(await saveJudgeScores(judge.ctx, { submissionId, scores: [{ criterionId: c, score: 7 }] })).toMatchObject({ ok: true });
    expect(await submitJudgeReview(judge.ctx, { submissionId, comment: "Solid" })).toMatchObject({ ok: true });
    const award = await createEventAward(ctx, { name: "Overall winner" });
    if (!award.ok) throw new Error(award.error);
    expect(await setAwardWinner(ctx, { awardId: award.data.id, submissionId, place: 1 })).toMatchObject({ ok: true });

    const deleted = await organiserDeleteTeam(teamsCtx!, teamId);
    if (!deleted.ok || !deleted.data) throw new Error("delete failed");
    expect(await prisma.submission.count({ where: { id: submissionId } })).toBe(0);
    expect(await restoreRsvpForUser(organiserId, { organisationSlug: orgSlug, undoId: deleted.data.undoId })).toEqual({ ok: true });
    expect(await prisma.submission.findUniqueOrThrow({ where: { id: submissionId } })).toMatchObject({ teamId, status: SubmissionStatus.SUBMITTED, title: "Undo me" });
    expect(await prisma.judgeScore.findMany({ where: { submissionId }, select: { judgeUserId: true, score: true } })).toEqual([{ judgeUserId: judge.userId, score: 7 }]);
    expect(await prisma.judgeReview.findFirstOrThrow({ where: { submissionId } })).toMatchObject({ comment: "Solid", submittedAt: expect.any(Date) });
    expect(await prisma.eventAwardWinner.count({ where: { submissionId, place: 1 } })).toBe(1);
    expect((await loadJudgingResults(ctx))?.rows[0]).toMatchObject({ submissionId, score: 70, judgesCounted: 1 });

    // A solo registration's project survives a delete and undo too (new RSVP id).
    const solo = await register(event, "solo-undo");
    expect(await submitSubmission(await soloAuth(solo.rsvpId, event.id), { title: "Solo undo" })).toMatchObject({ ok: true });
    const soloSubmission = await submissionIdFor({ rsvpId: solo.rsvpId });
    const removed = await deleteRsvpForUser(organiserId, { organisationSlug: orgSlug, eventId: event.id, rsvpId: solo.rsvpId });
    if (!removed.ok || !removed.data) throw new Error("rsvp delete failed");
    expect(await prisma.submission.count({ where: { id: soloSubmission } })).toBe(0);
    expect(await restoreRsvpForUser(organiserId, { organisationSlug: orgSlug, undoId: removed.data.undoId })).toEqual({ ok: true });
    const restored = await prisma.submission.findUniqueOrThrow({ where: { id: soloSubmission }, include: { rsvp: true } });
    expect(restored).toMatchObject({ title: "Solo undo", status: SubmissionStatus.SUBMITTED });
    expect(restored.rsvp?.attendeeKey).toBeTruthy();
  });

  it("restores the project, judging record, and check-in list records from one team undo snapshot", async () => {
    const event = await createEvent();
    const ctx = await organiser(event);
    await openWindow(ctx);
    const teamsCtx = await resolveOrganiserEvent(organiserId, orgSlug, event.id);
    const c = await criterion(ctx, { name: "Craft", weight: 1, maxScore: 10 });
    const judge = await createJudge(event, "snapshot-judge");
    const swag = await prisma.checkInList.create({ data: { eventId: event.id, name: `Swag ${suffix}` } });
    const at = new Date(Date.now() - HOUR);

    async function teamWithEverything(name: string) {
      const { teamId, leader } = await createTeam(event, name);
      const member = await joinTeam(event, teamId);
      expect(await submitSubmission(await teamAuth(teamId), { title: name })).toMatchObject({ ok: true });
      const submissionId = await submissionIdFor({ teamId });
      await prisma.checkInListRecord.createMany({ data: [
        { listId: swag.id, rsvpId: leader.rsvpId, source: "mobile-scan", checkedInAt: at },
        { listId: swag.id, rsvpId: member.rsvpId, source: "online", checkedInAt: at },
      ] });
      return { teamId, submissionId, rsvpIds: [leader.rsvpId, member.rsvpId] };
    }
    async function deleteTeam(teamId: string) {
      const deleted = await organiserDeleteTeam(teamsCtx!, teamId);
      if (!deleted.ok || !deleted.data) throw new Error("delete failed");
      return deleted.data.undoId;
    }
    const restore = (undoId: string) => restoreRsvpForUser(organiserId, { organisationSlug: orgSlug, undoId });

    // Current format: both the judging record and the list records come back.
    await setJudgingStatus(ctx, JudgingStatus.OPEN);
    const full = await teamWithEverything(`Snapshot full ${suffix}`);
    expect(await saveJudgeScores(judge.ctx, { submissionId: full.submissionId, scores: [{ criterionId: c, score: 6 }] })).toMatchObject({ ok: true });
    const undoId = await deleteTeam(full.teamId);
    const payload = (await prisma.rsvpDeletionUndo.findUniqueOrThrow({ where: { id: undoId } })).payload as { submission?: unknown; rsvps: Array<{ listCheckIns?: unknown[] }> };
    expect(payload.submission).toBeTruthy();
    expect(payload.rsvps.every((rsvp) => rsvp.listCheckIns?.length === 1)).toBe(true);
    expect(await restore(undoId)).toEqual({ ok: true });
    expect(await prisma.submission.findUniqueOrThrow({ where: { id: full.submissionId } })).toMatchObject({ teamId: full.teamId, status: SubmissionStatus.SUBMITTED });
    expect(await prisma.judgeScore.count({ where: { submissionId: full.submissionId, score: 6 } })).toBe(1);
    expect((await prisma.checkInListRecord.findMany({ where: { listId: swag.id, rsvpId: { in: full.rsvpIds } }, select: { rsvpId: true } })).map((row) => row.rsvpId).sort()).toEqual([...full.rsvpIds].sort());

    // Older formats still restore: team registration's (no project, no list
    // records) and the judging branch's (project, no list records).
    for (const keepSubmission of [false, true]) {
      const older = await teamWithEverything(`Snapshot ${keepSubmission ? "judging" : "teams"} ${suffix}`);
      const id = await deleteTeam(older.teamId);
      const row = await prisma.rsvpDeletionUndo.findUniqueOrThrow({ where: { id } });
      const legacy = structuredClone(row.payload) as Record<string, unknown> & { rsvps: Array<Record<string, unknown>> };
      if (!keepSubmission) delete legacy.submission;
      for (const rsvp of legacy.rsvps) delete rsvp.listCheckIns;
      await prisma.rsvpDeletionUndo.update({ where: { id }, data: { payload: legacy as never } });
      expect(await restore(id)).toEqual({ ok: true });
      expect(await prisma.rSVP.count({ where: { teamId: older.teamId } })).toBe(2);
      expect(await prisma.checkInListRecord.count({ where: { rsvpId: { in: older.rsvpIds } } })).toBe(0);
      expect(await prisma.submission.count({ where: { id: older.submissionId } })).toBe(keepSubmission ? 1 : 0);
    }
  });

  it("counts only reviews by current judges without a conflict of interest", async () => {
    const event = await createEvent();
    const ctx = await organiser(event);
    await openWindow(ctx);
    const { teamId } = await createTeam(event, `Counted ${suffix}`);
    expect(await submitSubmission(await teamAuth(teamId), { title: "Counted" })).toMatchObject({ ok: true });
    const submissionId = await submissionIdFor({ teamId });
    const c = await criterion(ctx, { name: "Impact", weight: 1, maxScore: 10 });
    const stays = await createJudge(event, "stays");
    const revoked = await createJudge(event, "revoked");
    const conflicted = await createJudge(event, "conflicted-later");
    await setJudgingStatus(ctx, JudgingStatus.OPEN);
    for (const [judge, score] of [[stays, 8], [revoked, 2], [conflicted, 10]] as const) {
      expect(await saveJudgeScores(judge.ctx, { submissionId, scores: [{ criterionId: c, score }] })).toMatchObject({ ok: true });
      expect(await submitJudgeReview(judge.ctx, { submissionId })).toMatchObject({ ok: true, data: { submitted: true } });
    }
    expect((await loadJudgingResults(ctx))?.rows[0]).toMatchObject({ score: 66.7, judgesCounted: 3 });

    // Submissions (the whole feature) can't be switched off once judging has started.
    expect(await updateJudgingSettings(ctx, { submissionsEnabled: false, submissionsOpenAt: "", submissionsCloseAt: "", judgesSeeAll: true, projectGalleryPublic: false })).toMatchObject({ ok: false, fieldErrors: { submissionsEnabled: [expect.any(String)] } });
    expect(await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).toMatchObject({ submissionsEnabled: true });

    // The JUDGE grant is revoked; another judge's account later joins the team.
    await prisma.eventCollaborator.deleteMany({ where: { eventId: event.id, userId: revoked.userId } });
    await joinTeam(event, teamId, { userId: conflicted.userId });
    const results = await loadJudgingResults(ctx);
    expect(results?.rows[0]).toMatchObject({ submissionId, score: 80, judgesCounted: 1 });
    const progress = await loadJudgeProgress(ctx);
    expect(progress?.find((j) => j.userId === revoked.userId)).toMatchObject({ visible: 0, reviewsSubmitted: 0 });
    expect(progress?.find((j) => j.userId === conflicted.userId)).toMatchObject({ visible: 0, reviewsSubmitted: 0 });
    expect(progress?.find((j) => j.userId === stays.userId)).toMatchObject({ visible: 1, reviewsSubmitted: 1 });
    // Their reviews stay on record, marked as not counted in the export.
    const csv = await buildJudgingExportRows(ctx);
    const counted = csv?.slice(1).map((line) => [line[8], line[10]]).sort();
    expect(counted).toEqual([
      [`conflicted-later ${suffix.slice(0, 6)}`, "No"],
      [`revoked ${suffix.slice(0, 6)}`, "No"],
      [`stays ${suffix.slice(0, 6)}`, "Yes"],
    ]);
  });

  it("emails each confirmed registration the results announcement once across re-publication", async () => {
    const event = await createEvent();
    // Hackathon emails are opt-in (off by default); this test covers sending them.
    await prisma.event.update({ where: { id: event.id }, data: { emailEntrantsOnResults: true, emailSubmissionReceipts: true } });
    const ctx = await organiser(event);
    await openWindow(ctx);
    const { teamId, leader } = await createTeam(event, `Announce ${suffix}`);
    const solo = await register(event, "announce-solo");
    expect(await submitSubmission(await teamAuth(teamId), { title: "Announced" })).toMatchObject({ ok: true });
    await criterion(ctx, { name: "Impact", weight: 1, maxScore: 10 });
    await setJudgingStatus(ctx, JudgingStatus.OPEN);
    await setJudgingStatus(ctx, JudgingStatus.CLOSED);
    const announcements = { kind: "results-published", payload: { path: ["eventId"], equals: event.id } };
    const emails = await prisma.rSVP.findMany({ where: { id: { in: [leader.rsvpId, solo.rsvpId] } }, select: { id: true, guestEmail: true } });
    const leaderEmail = emails.find((row) => row.id === leader.rsvpId)!.guestEmail!.toLowerCase();
    const soloEmail = emails.find((row) => row.id === solo.rsvpId)!.guestEmail!.toLowerCase();

    // Nothing delivered before the unpublish: the next publication announces again.
    expect(await publishResults(ctx)).toMatchObject({ ok: true, data: { queued: 2 } });
    expect(await unpublishResults(ctx)).toMatchObject({ ok: true });
    expect(await prisma.outboxMessage.count({ where: announcements })).toBe(0);
    expect(await publishResults(ctx)).toMatchObject({ ok: true, data: { queued: 2 } });

    // The leader's copy is delivered, the solo registrant's is still queued.
    const leaderMessage = (await prisma.outboxMessage.findMany({ where: announcements })).find((m) => (m.payload as { to: string }).to === leaderEmail)!;
    await prisma.outboxMessage.update({ where: { id: leaderMessage.id }, data: { status: "SENT", sentAt: new Date() } });
    expect(await unpublishResults(ctx)).toMatchObject({ ok: true });
    expect(await publishResults(ctx)).toMatchObject({ ok: true, data: { queued: 1 } });
    const rows = await prisma.outboxMessage.findMany({ where: announcements });
    const perAddress = (to: string) => rows.filter((m) => (m.payload as { to: string }).to === to).length;
    expect(perAddress(leaderEmail)).toBe(1);
    expect(perAddress(soloEmail)).toBe(1);
  });

  // -------------------------------------------------------------------------
  // Awards and results
  // -------------------------------------------------------------------------

  it("only lets submitted projects win awards", async () => {
    const event = await createEvent();
    const ctx = await organiser(event);
    await openWindow(ctx);
    const [draftTeam, withdrawnTeam, dqTeam, winnerTeam] = await Promise.all(["Draft", "Withdrawn", "DQ", "Winner"].map((name) => createTeam(event, `${name} ${suffix}`)));
    await saveSubmissionDraft(await teamAuth(draftTeam.teamId), { title: "Draft" });
    const withdrawnAuth = await teamAuth(withdrawnTeam.teamId);
    await submitSubmission(withdrawnAuth, { title: "Withdrawn" });
    await withdrawSubmission(withdrawnAuth);
    await submitSubmission(await teamAuth(dqTeam.teamId), { title: "DQ" });
    const winnerAuth = await teamAuth(winnerTeam.teamId);
    await submitSubmission(winnerAuth, { title: "Winner" });
    const [draft, withdrawn, dq, winner] = await Promise.all([draftTeam, withdrawnTeam, dqTeam, winnerTeam].map((team) => submissionIdFor({ teamId: team.teamId })));
    await disqualifySubmission(ctx, { submissionId: dq, reason: "Late" });

    const award = await createEventAward(ctx, { name: "Overall winner", description: "Best project" });
    if (!award.ok) throw new Error(award.error);
    const onlySubmitted = { ok: false, error: "Only submitted projects can win an award." };
    for (const submissionId of [draft, withdrawn, dq]) {
      expect(await setAwardWinner(ctx, { awardId: award.data.id, submissionId })).toMatchObject(onlySubmitted);
    }
    expect(await setAwardWinner(ctx, { awardId: award.data.id, submissionId: winner })).toMatchObject({ ok: true });
    expect(await setAwardWinner(ctx, { awardId: award.data.id, submissionId: dq, place: 2 })).toMatchObject(onlySubmitted);
    expect(await prisma.eventAwardWinner.findMany({ where: { awardId: award.data.id }, select: { submissionId: true, place: true } })).toEqual([{ submissionId: winner, place: 1 }]);

    // Disqualifying or withdrawing a winner removes the win.
    expect(await reinstateSubmission(ctx, dq)).toMatchObject({ ok: true });
    expect(await setAwardWinner(ctx, { awardId: award.data.id, submissionId: dq, place: 2 })).toMatchObject({ ok: true });
    expect(await disqualifySubmission(ctx, { submissionId: dq, reason: "Again" })).toMatchObject({ ok: true });
    expect(await withdrawSubmission(winnerAuth)).toMatchObject({ ok: true });
    expect(await prisma.eventAwardWinner.count({ where: { awardId: award.data.id } })).toBe(0);
    // The database also refuses a place below 1.
    await expect(prisma.eventAwardWinner.create({ data: { awardId: award.data.id, submissionId: draft, place: 0 } })).rejects.toThrow();
  });

  it("hides the results page until published and for non-public events", async () => {
    const event = await createEvent();
    // Hackathon emails are opt-in (off by default); this test covers sending them.
    await prisma.event.update({ where: { id: event.id }, data: { emailEntrantsOnResults: true, emailSubmissionReceipts: true } });
    const ctx = await organiser(event);
    await openWindow(ctx);
    const { teamId, leader } = await createTeam(event, `Champions ${suffix}`);
    const winnerAuth = await teamAuth(teamId);
    await submitSubmission(winnerAuth, { ...content, title: "Champion project" });
    const solo = await register(event, "solo");
    const winner = await submissionIdFor({ teamId });
    const c = await criterion(ctx, { name: "Impact", weight: 1, maxScore: 5 });
    const award = await createEventAward(ctx, { name: "Overall winner" });
    if (!award.ok) throw new Error(award.error);
    await setAwardWinner(ctx, { awardId: award.data.id, submissionId: winner });
    const judge = await createJudge(event);
    await setJudgingStatus(ctx, JudgingStatus.OPEN);
    await saveJudgeScores(judge.ctx, { submissionId: winner, scores: [{ criterionId: c, score: 5 }] });
    await submitJudgeReview(judge.ctx, { submissionId: winner, comment: "Secret judge comment" });

    // Unpublished: a 404 for everyone, on a fully public event.
    expect(await publicPage(null, event.id, loadPublicResults)).toBeNull();
    // Publishing needs judging closed.
    expect(await publishResults(ctx)).toMatchObject({ ok: false, error: "Close judging before publishing results." });
    expect(await publicPage(null, event.id, loadPublicResults)).toBeNull();
    await setJudgingStatus(ctx, JudgingStatus.CLOSED);
    const published = await publishResults(ctx);
    expect(published).toMatchObject({ ok: true, data: { alreadyPublished: false, queued: 2 } });
    const recipients = await prisma.outboxMessage.findMany({ where: { kind: "results-published", payload: { path: ["eventId"], equals: event.id } } });
    const emails = await prisma.rSVP.findMany({ where: { id: { in: [leader.rsvpId, solo.rsvpId] } }, select: { guestEmail: true } });
    expect(recipients.map((m) => (m.payload as { to: string }).to).sort()).toEqual(emails.map((r) => r.guestEmail!.toLowerCase()).sort());
    expect(await prisma.auditEvent.count({ where: { action: "JUDGING_RESULTS_PUBLISHED", targetId: event.id } })).toBe(1);

    const results = await publicPage(null, event.id, loadPublicResults);
    expect(results?.awards).toEqual([expect.objectContaining({ name: "Overall winner", winners: [expect.objectContaining({ place: 1, title: "Champion project", entrantName: `Champions ${suffix}`, isTeam: true })] })]);
    expect(JSON.stringify(results)).not.toMatch(/Secret judge comment|"score"|@example\.test|checkInToken|Impact/);
    // Judging cannot reopen under published results.
    expect(await setJudgingStatus(ctx, JudgingStatus.OPEN)).toMatchObject({ ok: false });

    // The same published results are a 404 when the event page itself is not public.
    await prisma.eventPage.update({ where: { eventId: event.id }, data: { isPublished: false } });
    expect(await publicPage(null, event.id, loadPublicResults)).toBeNull();
    await prisma.eventPage.update({ where: { eventId: event.id }, data: { isPublished: true } });
    for (const status of [EventStatus.DRAFT, EventStatus.HIDDEN, EventStatus.CANCELLED]) {
      await prisma.event.update({ where: { id: event.id }, data: { status } });
      expect(await publicPage(null, event.id, loadPublicResults), status).toBeNull();
      expect(await publicPage(judge.userId, event.id, loadPublicResults), status).toBeNull();
      // Exactly like the event page, organisers who can edit it get a preview.
      expect(await publicPage(organiserId, event.id, loadPublicResults), status).not.toBeNull();
    }
    await prisma.event.update({ where: { id: event.id }, data: { status: EventStatus.PUBLISHED, privacyType: EventPrivacyType.INVITE_ONLY } });
    const invited = await createUser("invited");
    const uninvited = await createUser("uninvited");
    await prisma.eventInvite.create({ data: { eventId: event.id, email: invited.email!.toLowerCase() } });
    expect(await publicPage(null, event.id, loadPublicResults)).toBeNull();
    expect(await publicPage(uninvited.id, event.id, loadPublicResults)).toBeNull();
    expect(await publicPage(invited.id, event.id, loadPublicResults)).not.toBeNull();
    // A judge's grant is not an invite either.
    expect(await publicPage(judge.userId, event.id, loadPublicResults)).toBeNull();
    // The gallery follows the same rules once the window has closed.
    await closeWindow(ctx);
    expect(await publicPage(null, event.id, loadProjectGallery)).toBeNull();
    expect((await publicPage(invited.id, event.id, loadProjectGallery))?.projects.map((p) => p.title)).toEqual(["Champion project"]);
    await prisma.event.update({ where: { id: event.id }, data: { privacyType: EventPrivacyType.PUBLIC } });
    expect((await publicPage(null, event.id, loadProjectGallery))?.projects).toHaveLength(1);
    await closeWindow(ctx, { projectGalleryPublic: false });
    expect(await publicPage(null, event.id, loadProjectGallery)).toBeNull();

    // Publishing again is idempotent; unpublishing hides the page and drops unsent announcements.
    expect(await publishResults(ctx)).toMatchObject({ ok: true, data: { alreadyPublished: true, queued: 0 } });
    expect(await unpublishResults(ctx)).toMatchObject({ ok: true });
    expect(await publicPage(null, event.id, loadPublicResults)).toBeNull();
    expect(await prisma.outboxMessage.count({ where: { kind: "results-published", status: "PENDING", payload: { path: ["eventId"], equals: event.id } } })).toBe(0);
    expect(await prisma.auditEvent.count({ where: { action: "JUDGING_RESULTS_UNPUBLISHED", targetId: event.id } })).toBe(1);

    // Another organisation's organiser cannot publish this event's results.
    const foreignCtx: JudgingOrganiserContext = { ...ctx, userId: otherOrganiserId, organisationId: otherOrganisationId, orgSlug: otherOrgSlug };
    expect(await publishResults(foreignCtx)).toMatchObject({ ok: false, error: "Event not found." });
    expect(await publicPage(null, event.id, loadPublicResults)).toBeNull();
  });
});
