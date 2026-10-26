import "server-only";

import crypto from "node:crypto";
import {
  EventPermission,
  EventStatus,
  JudgingStatus,
  OutboxStatus,
  Prisma,
  RsvpStatus,
  ScoreNormalization,
  SubmissionStatus,
} from "@prisma/client";
import { prisma } from "@/lib/db";
import { flattenZodErrors } from "@/app/actions/utils";
import { recordAuditEvent } from "@/lib/audit";
import { isOrgAdmin } from "@/lib/permissions";
import { escapeLikePattern, resolveTeamByManageToken } from "@/lib/core/teams";
import {
  clampPage,
  decodeSubmissionCursor,
  encodeSubmissionCursor,
  JUDGE_SUBMISSIONS_PAGE_SIZE,
  judgeSubmissionsQuerySchema,
  parseGalleryFilterParam,
  parseGallerySortParam,
  parseSearchParam,
  PROJECT_GALLERY_PAGE_SIZE,
  totalPagesFor,
  type JudgeSubmissionCounts,
  type JudgeSubmissionFilter,
} from "@/lib/judgingPaging";
import { asResultsPublishedPayload, enqueueResultsPublished, enqueueSubmissionLink, enqueueSubmissionReceived } from "@/lib/outbox";
import { generateSubmissionLinkToken, hashSubmissionLinkToken, isSubmissionTokenShape } from "@/lib/submissionToken";
import { computeJudgingResultsFromReviews, type CountedReview, type CriterionAverage } from "@/lib/judgingScore";
import { decodeTimeCursor, encodeTimeCursor } from "@/lib/keysetCursor";
import {
  AWARD_CANDIDATES_PAGE_SIZE,
  awardCandidatesQuerySchema,
  countScoreFilters,
  JUDGING_RESULTS_PAGE_SIZE,
  judgingResultsQuerySchema,
  matchesProjectQuery,
  matchesScoreFilter,
  numberedPage,
  offsetPage,
  ORGANISER_SUBMISSIONS_PAGE_SIZE,
  organiserSubmissionsQuerySchema,
  type NumberedPage,
  type OrganiserSubmissionFilter,
  type OffsetPage,
  type ResultsScoreFilter,
  type SubmissionViewFilter,
} from "@/lib/judgingOrganiserPaging";
import type { JudgeContext, JudgingOrganiserContext } from "@/lib/judgingAccess";
import { listUnsubmittedEntrants } from "@/lib/core/judgingEntrants";
import { galleryFromSql, galleryOrderSql, galleryWhereSql, projectSearchSql } from "@/lib/galleryQuery";
import { safeTimeZone, zonedIsoWithOffset } from "@/lib/timeZone";
import {
  entrantDisplayName,
  entrantSubmissionView,
  judgeSubmissionDto,
  judgingCriterionDto,
  organiserSubmissionDto,
  publicGalleryItemDto,
  publicWinnerDto,
  type EntrantSubmissionDto,
  type JudgeSubmissionDetailDto,
  type JudgeSubmissionsPageDto,
  type JudgeWorkspaceDto,
  type JudgingCriterionDto,
  type OrganiserSubmissionDto,
  type PublicAwardBadgeDto,
  type PublicGalleryDto,
  type PublicResultsDto,
} from "@/lib/judgingDto";
import {
  awardWinnerSchema,
  disqualifySubmissionSchema,
  EVENT_AWARD_PLACE_MAX,
  EVENT_AWARDS_LIMIT,
  eventAwardSchema,
  JUDGING_CRITERIA_LIMIT,
  judgeAssignmentSchema,
  judgeReviewSchema,
  judgeScoresSchema,
  judgingCriterionSchema,
  judgingReorderSchema,
  judgingSettingsSchema,
  judgingStatusSchema,
  removeAwardWinnerSchema,
  scoreNormalizationSchema,
  submissionContentSchema,
} from "@/lib/validators";

/**
 * Hackathon submission, judging, and results cores (docs/HACKATHON.md),
 * shared by Server Actions and route handlers. Callers authenticate the
 * capability or session, rate limit, and revalidate; these functions own the
 * rules and write the audit events the spec requires (settings, judging
 * status, disqualification, reinstatement, results publication) in the same
 * transaction as the change.
 *
 * Every id from a browser is re-read together with its `eventId`, and the
 * event together with its `organisationId`. Entrant authority (management
 * token, team membership, RSVP ownership, or submission link) is re-checked
 * inside the write transaction, and the submission window is compared with
 * server time there too.
 *
 * Locking: entrant and judge writes take `FOR SHARE` on the Event row;
 * organiser changes take `FOR UPDATE`. So closing the window, freezing the
 * rubric, or closing judging serialises with in-flight submissions and scores.
 */

export type JudgingResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

/** How an entrant proved who they are. Re-verified in every transaction. */
export type EntrantAuth =
  | { kind: "team-token"; eventId: string; teamId: string; manageTokenHash: string }
  | { kind: "team-member"; eventId: string; teamId: string; userId: string }
  | { kind: "solo-owner"; eventId: string; rsvpId: string; userId: string }
  | { kind: "solo-link"; eventId: string; rsvpId: string; tokenHash: string };

const NOT_FOUND = "Submission not found.";
const EVENT_NOT_FOUND = "Event not found.";
const WINDOW_CLOSED = "Submissions are not open right now.";
const NOT_CONFIRMED = "Only confirmed registrations can submit a project.";
/** A REJECTED team or registration: final, like the team-side refusals in lib/core/teams.ts. */
const DECLINED = "The organisers declined this registration, so its project can't be submitted or changed.";

function entrantRefusal(status: RsvpStatus): string | null {
  if (status === RsvpStatus.CONFIRMED) return null;
  return status === RsvpStatus.REJECTED ? DECLINED : NOT_CONFIRMED;
}
const RUBRIC_FROZEN = "The rubric can only be changed before judging starts.";
const JUDGING_NOT_OPEN = "Judging is not open.";
const CHANGED = "This was changed by someone else. Refresh and try again.";

function ok<T>(data: T): { ok: true; data: T } {
  return { ok: true, data };
}

function okEmpty(): { ok: true; data: undefined } {
  return { ok: true, data: undefined };
}

function fail(error: string, fieldErrors?: Record<string, string[]>): { ok: false; error: string; fieldErrors?: Record<string, string[]> } {
  return fieldErrors ? { ok: false, error, fieldErrors } : { ok: false, error };
}

function invalid(error: Parameters<typeof flattenZodErrors>[0]) {
  return fail("Check the highlighted fields.", flattenZodErrors(error));
}

function isId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 128;
}

function isUniqueViolation(error: unknown) {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002";
}

function isForeignKeyViolation(error: unknown) {
  return typeof error === "object" && error !== null && ((error as { code?: string }).code === "P2003" || (error as { code?: string }).code === "P2025");
}

function personEmail(person: { guestEmail: string | null; user: { email: string | null } | null } | null | undefined) {
  return person?.user?.email?.trim() || person?.guestEmail?.trim() || null;
}

function personName(person: { guestName: string | null; user: { name: string | null } | null } | null | undefined) {
  return person?.user?.name?.trim() || person?.guestName?.trim() || undefined;
}

const nameSourceSelect = {
  team: { select: { name: true } },
  rsvp: { select: { guestName: true, user: { select: { name: true } } } },
} satisfies Prisma.SubmissionSelect;

const projectSelect = {
  id: true,
  title: true,
  summary: true,
  repoUrl: true,
  demoUrl: true,
  videoUrl: true,
  ...nameSourceSelect,
} satisfies Prisma.SubmissionSelect;

// ---------------------------------------------------------------------------
// Event locks and window
// ---------------------------------------------------------------------------

const judgingEventSelect = {
  id: true,
  organisationId: true,
  title: true,
  slug: true,
  timezone: true,
  status: true,
  submissionsEnabled: true,
  submissionsOpenAt: true,
  submissionsCloseAt: true,
  judgingStatus: true,
  judgesSeeAll: true,
  projectGalleryPublic: true,
  resultsPublishedAt: true,
} satisfies Prisma.EventSelect;

type JudgingEvent = Prisma.EventGetPayload<{ select: typeof judgingEventSelect }>;

async function lockEventShared(tx: Prisma.TransactionClient, eventId: string): Promise<JudgingEvent | null> {
  await tx.$queryRaw`SELECT "id" FROM "Event" WHERE "id" = ${eventId} FOR SHARE`;
  return tx.event.findUnique({ where: { id: eventId }, select: judgingEventSelect });
}

/** Organiser lock, re-scoped by organisation. */
async function lockEventForOrganiser(tx: Prisma.TransactionClient, ctx: { eventId: string; organisationId: string }): Promise<JudgingEvent | null> {
  await tx.$queryRaw`SELECT "id" FROM "Event" WHERE "id" = ${ctx.eventId} AND "organisationId" = ${ctx.organisationId} FOR UPDATE`;
  return tx.event.findFirst({ where: { id: ctx.eventId, organisationId: ctx.organisationId }, select: judgingEventSelect });
}

/** Whether the submission window is open at `now` (server time). */
export function isSubmissionWindowOpen(
  event: { submissionsEnabled: boolean; submissionsOpenAt: Date | null; submissionsCloseAt: Date | null; status?: EventStatus },
  now: Date = new Date(),
): boolean {
  if (!event.submissionsEnabled || !event.submissionsOpenAt || !event.submissionsCloseAt) return false;
  if (event.status !== undefined && event.status !== EventStatus.PUBLISHED) return false;
  return event.submissionsOpenAt <= now && now < event.submissionsCloseAt;
}

/** The public gallery is visible once the window has closed and the organiser turned it on. */
export function isProjectGalleryVisible(
  event: { submissionsEnabled: boolean; projectGalleryPublic: boolean; submissionsCloseAt: Date | null },
  now: Date = new Date(),
): boolean {
  return event.submissionsEnabled && event.projectGalleryPublic && event.submissionsCloseAt != null && event.submissionsCloseAt <= now;
}

// ---------------------------------------------------------------------------
// Entrant resolution
// ---------------------------------------------------------------------------

/** Team leader via `/team/{manageToken}`. The raw token is hashed and never stored or logged. */
export async function resolveEntrantByTeamManageToken(rawToken: string): Promise<EntrantAuth | null> {
  const leader = await resolveTeamByManageToken(rawToken);
  if (!leader || leader.kind !== "token") return null;
  return { kind: "team-token", eventId: leader.eventId, teamId: leader.teamId, manageTokenHash: leader.manageTokenHash };
}

/**
 * A signed-in user on one event: a member of a team (any member may edit the
 * team's submission) or the owner of a solo registration.
 */
export async function resolveEntrantForUser(userId: string, eventId: string): Promise<EntrantAuth | null> {
  if (!isId(userId) || !isId(eventId)) return null;
  const rsvp = await prisma.rSVP.findFirst({ where: { eventId, userId }, select: { id: true, teamId: true } });
  if (!rsvp) return null;
  return rsvp.teamId
    ? { kind: "team-member", eventId, teamId: rsvp.teamId, userId }
    : { kind: "solo-owner", eventId, rsvpId: rsvp.id, userId };
}

/** `/submit/{token}`: a solo registrant's emailed link. */
export async function resolveEntrantBySubmissionLink(rawToken: string): Promise<EntrantAuth | null> {
  if (!isSubmissionTokenShape(rawToken)) return null;
  const tokenHash = hashSubmissionLinkToken(rawToken);
  const link = await prisma.submissionLink.findUnique({ where: { tokenHash }, select: { rsvpId: true, rsvp: { select: { eventId: true, teamId: true } } } });
  if (!link?.rsvp.eventId || link.rsvp.teamId) return null;
  return { kind: "solo-link", eventId: link.rsvp.eventId, rsvpId: link.rsvpId, tokenHash };
}

type EntrantRow = {
  eventId: string;
  teamId: string | null;
  rsvpId: string | null;
  status: RsvpStatus;
  displayName: string;
  /** Where the submission-received email goes: the person acting. */
  submitter: { email: string | null; name?: string };
};

const personSelect = { guestEmail: true, guestName: true, user: { select: { email: true, name: true } } } as const;

/** Re-read the entrant by (id, eventId) and confirm the proof still holds. */
async function lockedEntrant(tx: Prisma.TransactionClient, auth: EntrantAuth): Promise<EntrantRow | null> {
  if (auth.kind === "team-token" || auth.kind === "team-member") {
    const team = await tx.team.findFirst({
      where: { id: auth.teamId, eventId: auth.eventId },
      select: { id: true, name: true, status: true, manageTokenHash: true, leaderRsvp: { select: personSelect } },
    });
    if (!team) return null;
    if (auth.kind === "team-token") {
      if (team.manageTokenHash !== auth.manageTokenHash) return null;
      return {
        eventId: auth.eventId,
        teamId: team.id,
        rsvpId: null,
        status: team.status,
        displayName: team.name,
        submitter: { email: personEmail(team.leaderRsvp), name: personName(team.leaderRsvp) },
      };
    }
    const member = await tx.rSVP.findFirst({ where: { teamId: team.id, eventId: auth.eventId, userId: auth.userId }, select: personSelect });
    if (!member) return null;
    return {
      eventId: auth.eventId,
      teamId: team.id,
      rsvpId: null,
      status: team.status,
      displayName: team.name,
      submitter: { email: personEmail(member), name: personName(member) },
    };
  }
  const rsvp = await tx.rSVP.findFirst({
    where: {
      id: auth.rsvpId,
      eventId: auth.eventId,
      teamId: null,
      ...(auth.kind === "solo-owner" ? { userId: auth.userId } : { submissionLink: { is: { tokenHash: auth.tokenHash } } }),
    },
    select: { id: true, status: true, ...personSelect },
  });
  if (!rsvp) return null;
  return {
    eventId: auth.eventId,
    teamId: null,
    rsvpId: rsvp.id,
    status: rsvp.status,
    displayName: entrantDisplayName({ team: null, rsvp }),
    submitter: { email: personEmail(rsvp), name: personName(rsvp) },
  };
}

/**
 * Serialise writes for one entrant: lock its Team or RSVP row (taken after the
 * Event lock, the same order as every team mutation). Without it, two
 * concurrent submits of one DRAFT both see "not yet submitted" and both queue
 * `submission-received`.
 */
async function lockEntrantRow(tx: Prisma.TransactionClient, auth: EntrantAuth): Promise<void> {
  if (auth.kind === "team-token" || auth.kind === "team-member") {
    await tx.$queryRaw`SELECT "id" FROM "Team" WHERE "id" = ${auth.teamId} AND "eventId" = ${auth.eventId} FOR UPDATE`;
  } else {
    await tx.$queryRaw`SELECT "id" FROM "RSVP" WHERE "id" = ${auth.rsvpId} AND "eventId" = ${auth.eventId} FOR UPDATE`;
  }
}

function entrantWhere(entrant: { eventId: string; teamId: string | null; rsvpId: string | null }): Prisma.SubmissionWhereInput {
  return entrant.teamId ? { eventId: entrant.eventId, teamId: entrant.teamId } : { eventId: entrant.eventId, rsvpId: entrant.rsvpId! };
}

// ---------------------------------------------------------------------------
// Entrant actions
// ---------------------------------------------------------------------------

const submissionStateSelect = { id: true, status: true, submittedAt: true } satisfies Prisma.SubmissionSelect;

async function writeSubmission(
  auth: EntrantAuth,
  input: unknown,
  mode: "draft" | "submit",
): Promise<JudgingResult<{ submissionId: string; status: SubmissionStatus }>> {
  const parsed = submissionContentSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  try {
    return await prisma.$transaction(async (tx): Promise<JudgingResult<{ submissionId: string; status: SubmissionStatus }>> => {
      const event = await lockEventShared(tx, auth.eventId);
      if (!event) return fail(EVENT_NOT_FOUND);
      await lockEntrantRow(tx, auth);
      const entrant = await lockedEntrant(tx, auth);
      if (!entrant) return fail(NOT_FOUND);
      const refusal = entrantRefusal(entrant.status);
      if (refusal) return fail(refusal);
      if (!isSubmissionWindowOpen(event, new Date())) return fail(WINDOW_CLOSED);
      const existing = await tx.submission.findFirst({ where: entrantWhere(entrant), select: submissionStateSelect });
      if (existing?.status === SubmissionStatus.DISQUALIFIED) return fail("This submission can no longer be changed. Contact the organisers.");

      const now = new Date();
      const wasSubmitted = existing?.status === SubmissionStatus.SUBMITTED;
      const status = mode === "submit" || wasSubmitted ? SubmissionStatus.SUBMITTED : SubmissionStatus.DRAFT;
      const submittedAt = mode === "submit" && !wasSubmitted ? now : wasSubmitted ? existing.submittedAt ?? now : null;
      const content = {
        title: parsed.data.title,
        summary: parsed.data.summary,
        repoUrl: parsed.data.repoUrl,
        demoUrl: parsed.data.demoUrl,
        videoUrl: parsed.data.videoUrl,
        status,
        submittedAt,
      };
      const saved = existing
        ? await tx.submission.update({ where: { id: existing.id }, data: content, select: { id: true, status: true } })
        : await tx.submission.create({
            data: { ...content, eventId: entrant.eventId, teamId: entrant.teamId, rsvpId: entrant.rsvpId },
            select: { id: true, status: true },
          });
      if (mode === "submit" && !wasSubmitted && entrant.submitter.email) {
        await enqueueSubmissionReceived(tx, {
          to: entrant.submitter.email,
          submissionId: saved.id,
          ...(entrant.submitter.name ? { recipientName: entrant.submitter.name.slice(0, 200) } : {}),
        });
      }
      return ok({ submissionId: saved.id, status: saved.status });
    });
  } catch (error) {
    // A concurrent first save for the same entrant, or the team/RSVP was
    // removed mid-flight. Never report internals.
    if (isUniqueViolation(error) || isForeignKeyViolation(error)) return fail(CHANGED);
    throw error;
  }
}

/** Save the project without submitting it. A SUBMITTED project stays submitted (an edit). */
export function saveSubmissionDraft(auth: EntrantAuth, input: unknown) {
  return writeSubmission(auth, input, "draft");
}

/** Save and submit. Queues `submission-received` to the person acting when the project becomes SUBMITTED. */
export function submitSubmission(auth: EntrantAuth, input: unknown) {
  return writeSubmission(auth, input, "submit");
}

/** Withdraw a draft or submitted project while the window is open. Withdrawn projects can be re-submitted. */
export async function withdrawSubmission(auth: EntrantAuth): Promise<JudgingResult<{ status: SubmissionStatus }>> {
  return prisma.$transaction(async (tx): Promise<JudgingResult<{ status: SubmissionStatus }>> => {
    const event = await lockEventShared(tx, auth.eventId);
    if (!event) return fail(EVENT_NOT_FOUND);
    await lockEntrantRow(tx, auth);
    const entrant = await lockedEntrant(tx, auth);
    if (!entrant) return fail(NOT_FOUND);
    const refusal = entrantRefusal(entrant.status);
    if (refusal) return fail(refusal);
    if (!isSubmissionWindowOpen(event, new Date())) return fail(WINDOW_CLOSED);
    const existing = await tx.submission.findFirst({ where: entrantWhere(entrant), select: submissionStateSelect });
    if (!existing) return fail(NOT_FOUND);
    if (existing.status !== SubmissionStatus.DRAFT && existing.status !== SubmissionStatus.SUBMITTED) return fail("This submission cannot be withdrawn.");
    const updated = await tx.submission.updateMany({
      where: { id: existing.id, status: existing.status },
      data: { status: SubmissionStatus.WITHDRAWN, submittedAt: null },
    });
    if (updated.count !== 1) return fail(CHANGED);
    // Only SUBMITTED projects can hold an award.
    await tx.eventAwardWinner.deleteMany({ where: { submissionId: existing.id } });
    return ok({ status: SubmissionStatus.WITHDRAWN });
  });
}

/**
 * The entrant's own view. Never includes the disqualification reason. Like
 * the event page, it exists only while the event is published and its
 * website released: a draft, hidden, or cancelled event has no submission
 * page. Invite-only rules are not re-applied here, because the entrant's
 * proof (a registration on this event) already shows they were admitted.
 */
export async function loadEntrantSubmission(auth: EntrantAuth, now: Date = new Date()): Promise<EntrantSubmissionDto | null> {
  const event = await prisma.event.findUnique({
    where: { id: auth.eventId },
    select: { ...judgingEventSelect, page: { select: { isPublished: true } } },
  });
  if (!event?.submissionsEnabled || event.status !== EventStatus.PUBLISHED || event.page?.isPublished !== true) return null;
  const entrant = await lockedEntrant(prisma, auth);
  if (!entrant) return null;
  const submission = await prisma.submission.findFirst({
    where: entrantWhere(entrant),
    select: { title: true, summary: true, repoUrl: true, demoUrl: true, videoUrl: true, status: true, submittedAt: true },
  });
  const isOpen = isSubmissionWindowOpen(event, now);
  const confirmed = entrant.status === RsvpStatus.CONFIRMED;
  return {
    entrantName: entrant.displayName,
    isTeam: entrant.teamId != null,
    eventTitle: event.title,
    timezone: event.timezone,
    window: { opensAt: event.submissionsOpenAt, closesAt: event.submissionsCloseAt, isOpen },
    confirmed,
    declined: entrant.status === RsvpStatus.REJECTED,
    canEdit: isOpen && confirmed && submission?.status !== SubmissionStatus.DISQUALIFIED,
    submission: entrantSubmissionView(submission),
  };
}

/** Minimum time between two emailed links for one registration. */
const SUBMISSION_LINK_COOLDOWN_MS = 60_000;

/**
 * A solo registrant asks for their `/submit/{token}` link from the ticket
 * page. The link goes only to the registration's own address through the
 * outbox, so holding the ticket QR alone is never enough. Regenerating
 * replaces the stored digest, retiring the previous link. The raw token is
 * never returned.
 */
export async function requestSubmissionLink(holder: { rsvpId: string; eventId: string }): Promise<JudgingResult<{ sent: boolean }>> {
  if (!isId(holder.rsvpId) || !isId(holder.eventId)) return fail(NOT_FOUND);
  try {
    return await prisma.$transaction(async (tx): Promise<JudgingResult<{ sent: boolean }>> => {
      const event = await lockEventShared(tx, holder.eventId);
      if (!event?.submissionsEnabled || event.status !== EventStatus.PUBLISHED) return fail("This event is not taking project submissions.");
      const rsvp = await tx.rSVP.findFirst({
        where: { id: holder.rsvpId, eventId: event.id },
        select: { id: true, teamId: true, status: true, ...personSelect, submissionLink: { select: { createdAt: true } } },
      });
      if (!rsvp) return fail(NOT_FOUND);
      if (rsvp.teamId) return fail("Your team's project is submitted from the team page, or by any member signed in to their account.");
      if (rsvp.status !== RsvpStatus.CONFIRMED) return fail(NOT_CONFIRMED);
      const to = personEmail(rsvp);
      if (!to) return fail("This registration has no email address to send the link to.");
      if (rsvp.submissionLink && Date.now() - rsvp.submissionLink.createdAt.getTime() < SUBMISSION_LINK_COOLDOWN_MS) {
        return ok({ sent: false });
      }
      const token = generateSubmissionLinkToken();
      await tx.submissionLink.upsert({
        where: { rsvpId: rsvp.id },
        create: { rsvpId: rsvp.id, tokenHash: token.hash },
        update: { tokenHash: token.hash, createdAt: new Date() },
      });
      await enqueueSubmissionLink(tx, { to: to.toLowerCase(), rsvpId: rsvp.id, token: token.raw });
      return ok({ sent: true });
    });
  } catch (error) {
    if (isUniqueViolation(error)) return fail("A link was just sent. Check your inbox.");
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Organiser: settings, rubric, awards, moderation
// ---------------------------------------------------------------------------

export type JudgingSettingsDto = {
  submissionsEnabled: boolean;
  submissionsOpenAt: Date | null;
  submissionsCloseAt: Date | null;
  judgingStatus: JudgingStatus;
  judgesSeeAll: boolean;
  projectGalleryPublic: boolean;
  resultsPublishedAt: Date | null;
  timezone: string;
};

function settingsDto(event: JudgingEvent): JudgingSettingsDto {
  return {
    submissionsEnabled: event.submissionsEnabled,
    submissionsOpenAt: event.submissionsOpenAt,
    submissionsCloseAt: event.submissionsCloseAt,
    judgingStatus: event.judgingStatus,
    judgesSeeAll: event.judgesSeeAll,
    projectGalleryPublic: event.projectGalleryPublic,
    resultsPublishedAt: event.resultsPublishedAt,
    timezone: event.timezone,
  };
}

/** Why submissions can't be turned off right now, or null when they can. */
export function submissionsLockedOnReason(event: { submissionsEnabled: boolean; judgingStatus: JudgingStatus; resultsPublishedAt: Date | null }): string | null {
  if (!event.submissionsEnabled) return null;
  if (event.resultsPublishedAt) return "Results are published, so submissions stay on. Unpublish the results first.";
  if (event.judgingStatus !== JudgingStatus.NOT_STARTED) return "Judging has started, so submissions stay on. To stop taking projects, change the closing time.";
  return null;
}

/**
 * Save submission and judging settings. Audited (JUDGING_SETTINGS_UPDATED).
 * `submissionsEnabled` switches the whole feature (judge workspace, results,
 * gallery), so it can't be turned off once judging has started or results are
 * published; closing the window is how an organiser stops new projects.
 */
export async function updateJudgingSettings(ctx: JudgingOrganiserContext, input: unknown): Promise<JudgingResult<JudgingSettingsDto>> {
  const parsed = judgingSettingsSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return prisma.$transaction(async (tx): Promise<JudgingResult<JudgingSettingsDto>> => {
    const event = await lockEventForOrganiser(tx, ctx);
    if (!event) return fail(EVENT_NOT_FOUND);
    const locked = parsed.data.submissionsEnabled ? null : submissionsLockedOnReason(event);
    if (locked) return fail(locked, { submissionsEnabled: [locked] });
    const updated = await tx.event.update({
      where: { id: event.id },
      data: {
        submissionsEnabled: parsed.data.submissionsEnabled,
        submissionsOpenAt: parsed.data.submissionsOpenAt,
        submissionsCloseAt: parsed.data.submissionsCloseAt,
        judgesSeeAll: parsed.data.judgesSeeAll,
        projectGalleryPublic: parsed.data.projectGalleryPublic,
      },
      select: judgingEventSelect,
    });
    await recordAuditEvent({
      client: tx,
      action: "JUDGING_SETTINGS_UPDATED",
      actorUserId: ctx.userId,
      organisationId: ctx.organisationId,
      targetType: "Event",
      targetId: event.id,
      metadata: {
        submissionsEnabled: updated.submissionsEnabled,
        judgesSeeAll: updated.judgesSeeAll,
        projectGalleryPublic: updated.projectGalleryPublic,
      },
    });
    return ok(settingsDto(updated));
  });
}

async function withRubricLock<T>(ctx: JudgingOrganiserContext, run: (tx: Prisma.TransactionClient, event: JudgingEvent) => Promise<JudgingResult<T>>): Promise<JudgingResult<T>> {
  return prisma.$transaction(async (tx): Promise<JudgingResult<T>> => {
    const event = await lockEventForOrganiser(tx, ctx);
    if (!event) return fail(EVENT_NOT_FOUND);
    if (event.judgingStatus !== JudgingStatus.NOT_STARTED) return fail(RUBRIC_FROZEN);
    return run(tx, event);
  });
}

export async function createJudgingCriterion(ctx: JudgingOrganiserContext, input: unknown): Promise<JudgingResult<{ id: string }>> {
  const parsed = judgingCriterionSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return withRubricLock(ctx, async (tx, event) => {
    const existing = await tx.judgingCriterion.aggregate({ where: { eventId: event.id }, _count: { _all: true }, _max: { position: true } });
    if (existing._count._all >= JUDGING_CRITERIA_LIMIT) return fail(`A rubric can have up to ${JUDGING_CRITERIA_LIMIT} criteria.`);
    const created = await tx.judgingCriterion.create({
      data: { eventId: event.id, ...parsed.data, position: (existing._max.position ?? -1) + 1 },
      select: { id: true },
    });
    return ok({ id: created.id });
  });
}

export async function updateJudgingCriterion(ctx: JudgingOrganiserContext, criterionId: string, input: unknown): Promise<JudgingResult> {
  if (!isId(criterionId)) return fail("Criterion not found.");
  const parsed = judgingCriterionSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return withRubricLock(ctx, async (tx, event) => {
    const updated = await tx.judgingCriterion.updateMany({ where: { id: criterionId, eventId: event.id }, data: parsed.data });
    return updated.count === 1 ? okEmpty() : fail("Criterion not found.");
  });
}

export async function deleteJudgingCriterion(ctx: JudgingOrganiserContext, criterionId: string): Promise<JudgingResult> {
  if (!isId(criterionId)) return fail("Criterion not found.");
  return withRubricLock(ctx, async (tx, event) => {
    const deleted = await tx.judgingCriterion.deleteMany({ where: { id: criterionId, eventId: event.id } });
    return deleted.count === 1 ? okEmpty() : fail("Criterion not found.");
  });
}

/** Apply a full new order; `ids` must be exactly the event's criteria. */
export async function reorderJudgingCriteria(ctx: JudgingOrganiserContext, ids: unknown): Promise<JudgingResult> {
  const parsed = judgingReorderSchema.safeParse(ids);
  if (!parsed.success) return fail("Invalid order.");
  return withRubricLock(ctx, async (tx, event) => {
    const current = await tx.judgingCriterion.findMany({ where: { eventId: event.id }, select: { id: true } });
    if (!sameIdSet(current.map((row) => row.id), parsed.data)) return fail(CHANGED);
    for (const [position, id] of parsed.data.entries()) {
      await tx.judgingCriterion.updateMany({ where: { id, eventId: event.id }, data: { position } });
    }
    return okEmpty();
  });
}

function sameIdSet(current: string[], next: string[]) {
  if (current.length !== next.length) return false;
  const wanted = new Set(next);
  return current.every((id) => wanted.has(id));
}

async function withOrganiserLock<T>(ctx: JudgingOrganiserContext, run: (tx: Prisma.TransactionClient, event: JudgingEvent) => Promise<JudgingResult<T>>): Promise<JudgingResult<T>> {
  return prisma.$transaction(async (tx): Promise<JudgingResult<T>> => {
    const event = await lockEventForOrganiser(tx, ctx);
    if (!event) return fail(EVENT_NOT_FOUND);
    return run(tx, event);
  });
}

export async function createEventAward(ctx: JudgingOrganiserContext, input: unknown): Promise<JudgingResult<{ id: string }>> {
  const parsed = eventAwardSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return withOrganiserLock(ctx, async (tx, event) => {
    const existing = await tx.eventAward.aggregate({ where: { eventId: event.id }, _count: { _all: true }, _max: { position: true } });
    if (existing._count._all >= EVENT_AWARDS_LIMIT) return fail(`An event can have up to ${EVENT_AWARDS_LIMIT} awards.`);
    const created = await tx.eventAward.create({
      data: { eventId: event.id, ...parsed.data, position: (existing._max.position ?? -1) + 1 },
      select: { id: true },
    });
    return ok({ id: created.id });
  });
}

export async function updateEventAward(ctx: JudgingOrganiserContext, awardId: string, input: unknown): Promise<JudgingResult> {
  if (!isId(awardId)) return fail("Award not found.");
  const parsed = eventAwardSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return withOrganiserLock(ctx, async (tx, event) => {
    const updated = await tx.eventAward.updateMany({ where: { id: awardId, eventId: event.id }, data: parsed.data });
    return updated.count === 1 ? okEmpty() : fail("Award not found.");
  });
}

export async function deleteEventAward(ctx: JudgingOrganiserContext, awardId: string): Promise<JudgingResult> {
  if (!isId(awardId)) return fail("Award not found.");
  return withOrganiserLock(ctx, async (tx, event) => {
    const deleted = await tx.eventAward.deleteMany({ where: { id: awardId, eventId: event.id } });
    return deleted.count === 1 ? okEmpty() : fail("Award not found.");
  });
}

export async function reorderEventAwards(ctx: JudgingOrganiserContext, ids: unknown): Promise<JudgingResult> {
  const parsed = judgingReorderSchema.safeParse(ids);
  if (!parsed.success) return fail("Invalid order.");
  return withOrganiserLock(ctx, async (tx, event) => {
    const current = await tx.eventAward.findMany({ where: { eventId: event.id }, select: { id: true } });
    if (!sameIdSet(current.map((row) => row.id), parsed.data)) return fail(CHANGED);
    for (const [position, id] of parsed.data.entries()) {
      await tx.eventAward.updateMany({ where: { id, eventId: event.id }, data: { position } });
    }
    return okEmpty();
  });
}

/**
 * Put a SUBMITTED project in a place of an award. Replaces whoever held that
 * place, and moves the project if it already held another place in this award.
 */
export async function setAwardWinner(ctx: JudgingOrganiserContext, input: unknown): Promise<JudgingResult> {
  const parsed = awardWinnerSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return withOrganiserLock(ctx, async (tx, event) => {
    const award = await tx.eventAward.findFirst({ where: { id: parsed.data.awardId, eventId: event.id }, select: { id: true } });
    if (!award) return fail("Award not found.");
    const submission = await tx.submission.findFirst({ where: { id: parsed.data.submissionId, eventId: event.id }, select: { id: true, status: true } });
    if (!submission) return fail(NOT_FOUND);
    if (submission.status !== SubmissionStatus.SUBMITTED) return fail("Only submitted projects can win an award.");
    await tx.eventAwardWinner.deleteMany({ where: { awardId: award.id, OR: [{ place: parsed.data.place }, { submissionId: submission.id }] } });
    await tx.eventAwardWinner.create({ data: { awardId: award.id, submissionId: submission.id, place: parsed.data.place } });
    return okEmpty();
  });
}

export async function removeAwardWinner(ctx: JudgingOrganiserContext, input: unknown): Promise<JudgingResult> {
  const parsed = removeAwardWinnerSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid input.");
  return withOrganiserLock(ctx, async (tx, event) => {
    const deleted = await tx.eventAwardWinner.deleteMany({ where: { place: parsed.data.place, award: { id: parsed.data.awardId, eventId: event.id } } });
    return deleted.count === 1 ? okEmpty() : fail("Winner not found.");
  });
}

/** Disqualify a SUBMITTED project with an organiser-only reason. Removes its awards. Audited. */
export async function disqualifySubmission(ctx: JudgingOrganiserContext, input: unknown): Promise<JudgingResult> {
  const parsed = disqualifySubmissionSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return withOrganiserLock(ctx, async (tx, event) => {
    const updated = await tx.submission.updateMany({
      where: { id: parsed.data.submissionId, eventId: event.id, status: SubmissionStatus.SUBMITTED },
      data: { status: SubmissionStatus.DISQUALIFIED, disqualifiedReason: parsed.data.reason },
    });
    if (updated.count !== 1) return fail("Only submitted projects can be disqualified.");
    await tx.eventAwardWinner.deleteMany({ where: { submissionId: parsed.data.submissionId } });
    // The reason is organiser free text; it stays out of audit metadata.
    await recordAuditEvent({
      client: tx,
      action: "SUBMISSION_DISQUALIFIED",
      actorUserId: ctx.userId,
      organisationId: ctx.organisationId,
      targetType: "Submission",
      targetId: parsed.data.submissionId,
      metadata: { eventId: event.id },
    });
    return okEmpty();
  });
}

/** Undo a disqualification: back to SUBMITTED, reason cleared. Audited. */
export async function reinstateSubmission(ctx: JudgingOrganiserContext, submissionId: string): Promise<JudgingResult> {
  if (!isId(submissionId)) return fail(NOT_FOUND);
  return withOrganiserLock(ctx, async (tx, event) => {
    const updated = await tx.submission.updateMany({
      where: { id: submissionId, eventId: event.id, status: SubmissionStatus.DISQUALIFIED },
      data: { status: SubmissionStatus.SUBMITTED, disqualifiedReason: null },
    });
    if (updated.count !== 1) return fail("Only disqualified projects can be reinstated.");
    await recordAuditEvent({
      client: tx,
      action: "SUBMISSION_REINSTATED",
      actorUserId: ctx.userId,
      organisationId: ctx.organisationId,
      targetType: "Submission",
      targetId: submissionId,
      metadata: { eventId: event.id },
    });
    return okEmpty();
  });
}

// ---------------------------------------------------------------------------
// Judges: eligibility, assignment, conflict of interest
// ---------------------------------------------------------------------------

/** Org OWNER/ADMIN or a JUDGE collaborator on this event, read inside the caller's transaction. */
async function isEligibleJudge(tx: Prisma.TransactionClient, organisationId: string, eventId: string, userId: string): Promise<boolean> {
  const [membership, grant] = await Promise.all([
    tx.membership.findUnique({ where: { userId_organisationId: { userId, organisationId } }, select: { role: true } }),
    tx.eventCollaborator.findFirst({ where: { eventId, userId, permissions: { has: EventPermission.JUDGE } }, select: { id: true } }),
  ]);
  return Boolean((membership && isOrgAdmin(membership.role)) || grant);
}

export type ConflictKeys = { rsvpIds: Set<string>; teamIds: Set<string> };

/** Registrations the judge's own account owns on this event: those entrants are off limits. */
export async function conflictKeysFor(tx: Prisma.TransactionClient, eventId: string, userIds: string[]): Promise<Map<string, ConflictKeys>> {
  const result = new Map<string, ConflictKeys>(userIds.map((id) => [id, { rsvpIds: new Set<string>(), teamIds: new Set<string>() }]));
  if (userIds.length === 0) return result;
  const rows = await tx.rSVP.findMany({ where: { eventId, userId: { in: userIds } }, select: { id: true, teamId: true, userId: true } });
  for (const row of rows) {
    const keys = row.userId ? result.get(row.userId) : undefined;
    if (!keys) continue;
    keys.rsvpIds.add(row.id);
    if (row.teamId) keys.teamIds.add(row.teamId);
  }
  return result;
}

/** True when the judge's own account owns an RSVP on this entrant. */
export function hasConflictOfInterest(submission: { teamId: string | null; rsvpId: string | null }, keys: ConflictKeys | undefined): boolean {
  if (!keys) return false;
  return Boolean((submission.teamId && keys.teamIds.has(submission.teamId)) || (submission.rsvpId && keys.rsvpIds.has(submission.rsvpId)));
}

export type EligibleJudgeDto = { userId: string; name: string; email: string | null; kind: "admin" | "judge" };

/** Organisation owners/admins and this event's JUDGE collaborators (organiser view). */
export async function listEligibleJudges(ctx: JudgingOrganiserContext): Promise<EligibleJudgeDto[]> {
  const [admins, grants] = await Promise.all([
    prisma.membership.findMany({
      where: { organisationId: ctx.organisationId, role: { in: ["OWNER", "ADMIN"] } },
      select: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.eventCollaborator.findMany({
      where: { eventId: ctx.eventId, event: { organisationId: ctx.organisationId }, permissions: { has: EventPermission.JUDGE } },
      select: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: "asc" },
    }),
  ]);
  const seen = new Map<string, EligibleJudgeDto>();
  for (const grant of grants) seen.set(grant.user.id, { userId: grant.user.id, name: grant.user.name?.trim() || "Judge", email: grant.user.email, kind: "judge" });
  for (const admin of admins) {
    if (!seen.has(admin.user.id)) seen.set(admin.user.id, { userId: admin.user.id, name: admin.user.name?.trim() || "Organiser", email: admin.user.email, kind: "admin" });
  }
  return [...seen.values()];
}

/** Assign one submission to one judge. Refused for ineligible judges and conflicts of interest. */
export async function assignJudge(ctx: JudgingOrganiserContext, input: unknown): Promise<JudgingResult> {
  const parsed = judgeAssignmentSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid input.");
  return withOrganiserLock(ctx, async (tx, event) => {
    const submission = await tx.submission.findFirst({ where: { id: parsed.data.submissionId, eventId: event.id }, select: { id: true, teamId: true, rsvpId: true } });
    if (!submission) return fail(NOT_FOUND);
    if (!(await isEligibleJudge(tx, event.organisationId, event.id, parsed.data.judgeUserId))) return fail("This person is not a judge for this event.");
    const conflicts = await conflictKeysFor(tx, event.id, [parsed.data.judgeUserId]);
    if (hasConflictOfInterest(submission, conflicts.get(parsed.data.judgeUserId))) return fail("This judge is registered on this entry, so they can't judge it.");
    await tx.judgeAssignment.createMany({
      data: [{ eventId: event.id, judgeUserId: parsed.data.judgeUserId, submissionId: submission.id }],
      skipDuplicates: true,
    });
    return okEmpty();
  });
}

export async function unassignJudge(ctx: JudgingOrganiserContext, input: unknown): Promise<JudgingResult> {
  const parsed = judgeAssignmentSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid input.");
  return withOrganiserLock(ctx, async (tx, event) => {
    await tx.judgeAssignment.deleteMany({ where: { eventId: event.id, judgeUserId: parsed.data.judgeUserId, submissionId: parsed.data.submissionId } });
    return okEmpty();
  });
}

// ---------------------------------------------------------------------------
// Judging status and results publication
// ---------------------------------------------------------------------------

/**
 * NOT_STARTED -> OPEN (needs a rubric), OPEN -> CLOSED (freezes scores),
 * CLOSED -> OPEN (only while results are unpublished), and back to
 * NOT_STARTED only before anyone has scored. Audited (JUDGING_STATUS_CHANGED).
 */
export async function setJudgingStatus(ctx: JudgingOrganiserContext, status: unknown): Promise<JudgingResult<{ judgingStatus: JudgingStatus }>> {
  const parsed = judgingStatusSchema.safeParse(status);
  if (!parsed.success) return fail("Invalid judging status.");
  const next = parsed.data as JudgingStatus;
  return withOrganiserLock(ctx, async (tx, event) => {
    const from = event.judgingStatus;
    if (from === next) return ok({ judgingStatus: from });
    if (next === JudgingStatus.OPEN) {
      if (!event.submissionsEnabled) return fail("Turn on submissions first.");
      if (event.resultsPublishedAt) return fail("Unpublish the results before reopening judging.");
      const criteria = await tx.judgingCriterion.count({ where: { eventId: event.id } });
      if (criteria === 0) return fail("Add at least one rubric criterion before opening judging.");
    } else if (next === JudgingStatus.CLOSED) {
      if (from !== JudgingStatus.OPEN) return fail("Only open judging can be closed.");
    } else {
      const [scores, reviews] = await Promise.all([
        tx.judgeScore.count({ where: { submission: { eventId: event.id } } }),
        tx.judgeReview.count({ where: { submission: { eventId: event.id } } }),
      ]);
      if (scores > 0 || reviews > 0) return fail("Judges have already scored, so judging can't be reset.");
      if (event.resultsPublishedAt) return fail("Unpublish the results first.");
    }
    const updated = await tx.event.updateMany({ where: { id: event.id, judgingStatus: from }, data: { judgingStatus: next } });
    if (updated.count !== 1) return fail(CHANGED);
    await recordAuditEvent({
      client: tx,
      action: "JUDGING_STATUS_CHANGED",
      actorUserId: ctx.userId,
      organisationId: ctx.organisationId,
      targetType: "Event",
      targetId: event.id,
      metadata: { from, to: next },
    });
    return ok({ judgingStatus: next });
  });
}

/**
 * "Adjust for harsh/generous judges": which result score ranks the projects
 * (lib/judgingScore.ts). Both scores are always computed and shown to
 * organisers; this only picks the one that ranks, in the Results table, the
 * Awards picker, and the CSV's rank. It can change at any time, since ranks
 * only guide the organisers' manual award choices and public pages never
 * show scores or ranks. Audited (JUDGING_SCORE_NORMALIZATION_CHANGED).
 */
export async function setScoreNormalization(ctx: JudgingOrganiserContext, input: unknown): Promise<JudgingResult<{ scoreNormalization: ScoreNormalization }>> {
  const parsed = scoreNormalizationSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid score method.");
  const next = parsed.data as ScoreNormalization;
  return withOrganiserLock(ctx, async (tx, event) => {
    const current = await tx.event.findUnique({ where: { id: event.id }, select: { scoreNormalization: true } });
    const from = current?.scoreNormalization ?? ScoreNormalization.RAW;
    if (from === next) return ok({ scoreNormalization: next });
    await tx.event.update({ where: { id: event.id }, data: { scoreNormalization: next } });
    await recordAuditEvent({
      client: tx,
      action: "JUDGING_SCORE_NORMALIZATION_CHANGED",
      actorUserId: ctx.userId,
      organisationId: ctx.organisationId,
      targetType: "Event",
      targetId: event.id,
      metadata: { from, to: next },
    });
    return ok({ scoreNormalization: next });
  });
}

/**
 * Publish results (judging must be CLOSED). Idempotent: publishing again while
 * published changes nothing and queues nothing. The first publication queues
 * one `results-published` email per confirmed entrant member (every CONFIRMED
 * registration of the event; team members share their team's status),
 * deduplicated by address, and records `resultsAnnouncedAt`. A re-publication
 * after an unpublish never emails an address a second time (see
 * `unpublishResults`). Audited (JUDGING_RESULTS_PUBLISHED).
 */
export type PublishResultsOutcome = { publishedAt: Date; queued: number; alreadyPublished: boolean };

export async function publishResults(ctx: JudgingOrganiserContext): Promise<JudgingResult<PublishResultsOutcome>> {
  return withOrganiserLock<PublishResultsOutcome>(ctx, async (tx, event) => {
    if (event.resultsPublishedAt) return ok({ publishedAt: event.resultsPublishedAt, queued: 0, alreadyPublished: true });
    if (!event.submissionsEnabled) return fail("This event is not taking project submissions.");
    if (event.judgingStatus !== JudgingStatus.CLOSED) return fail("Close judging before publishing results.");
    const publishedAt = new Date();
    const announced = await tx.event.findUnique({ where: { id: event.id }, select: { resultsAnnouncedAt: true } });
    const firstAnnouncement = !announced?.resultsAnnouncedAt;
    const updated = await tx.event.updateMany({
      where: { id: event.id, resultsPublishedAt: null },
      data: { resultsPublishedAt: publishedAt, ...(firstAnnouncement ? { resultsAnnouncedAt: publishedAt } : {}) },
    });
    if (updated.count !== 1) return fail(CHANGED);

    // After an earlier announcement, only addresses whose copy was withdrawn
    // undelivered by the unpublish are emailed: anyone with a delivered (or
    // in-flight) announcement left in the outbox is skipped, and once those
    // rows have aged out nobody is emailed again.
    let alreadyTold: Set<string> | null = null;
    if (!firstAnnouncement) {
      const previous = await tx.outboxMessage.findMany({
        where: { kind: "results-published", payload: { path: ["eventId"], equals: event.id } },
        select: { payload: true },
      });
      alreadyTold = new Set(previous.map((row) => asResultsPublishedPayload(row.payload)?.to.toLowerCase()).filter((to): to is string => Boolean(to)));
    }
    const recipients = alreadyTold?.size === 0 ? [] : await tx.rSVP.findMany({
      where: { eventId: event.id, status: RsvpStatus.CONFIRMED },
      select: personSelect,
      orderBy: { createdAt: "asc" },
    });
    const seen = new Set<string>(alreadyTold ?? []);
    const payloads: Array<{ to: string; eventId: string; recipientName?: string }> = [];
    for (const person of recipients) {
      const email = personEmail(person)?.toLowerCase();
      if (!email || seen.has(email)) continue;
      seen.add(email);
      const name = personName(person)?.slice(0, 200);
      payloads.push({ to: email, eventId: event.id, ...(name ? { recipientName: name } : {}) });
    }
    await enqueueResultsPublished(tx, payloads);
    await recordAuditEvent({
      client: tx,
      action: "JUDGING_RESULTS_PUBLISHED",
      actorUserId: ctx.userId,
      organisationId: ctx.organisationId,
      targetType: "Event",
      targetId: event.id,
      metadata: { recipients: payloads.length, republished: !firstAnnouncement },
    });
    return ok({ publishedAt, queued: payloads.length, alreadyPublished: false });
  });
}

/**
 * Hide the results page again. Undelivered announcements for this event are
 * withdrawn. When none had been delivered, the announcement counts as never
 * made (`resultsAnnouncedAt` is cleared), so the next publication emails
 * everyone; otherwise it emails only those whose copy was withdrawn, and
 * nobody gets the announcement twice. Audited.
 */
export async function unpublishResults(ctx: JudgingOrganiserContext): Promise<JudgingResult> {
  return withOrganiserLock(ctx, async (tx, event) => {
    if (!event.resultsPublishedAt) return okEmpty();
    const announcement = { kind: "results-published", payload: { path: ["eventId"], equals: event.id } } satisfies Prisma.OutboxMessageWhereInput;
    const withdrawn = await tx.outboxMessage.deleteMany({ where: { ...announcement, status: OutboxStatus.PENDING } });
    const delivered = withdrawn.count > 0 ? await tx.outboxMessage.count({ where: announcement }) : 1;
    await tx.event.update({
      where: { id: event.id },
      data: { resultsPublishedAt: null, ...(delivered === 0 ? { resultsAnnouncedAt: null } : {}) },
    });
    await recordAuditEvent({
      client: tx,
      action: "JUDGING_RESULTS_UNPUBLISHED",
      actorUserId: ctx.userId,
      organisationId: ctx.organisationId,
      targetType: "Event",
      targetId: event.id,
    });
    return okEmpty();
  });
}

// ---------------------------------------------------------------------------
// Judge workspace
// ---------------------------------------------------------------------------

async function criteriaFor(client: Prisma.TransactionClient, eventId: string): Promise<JudgingCriterionDto[]> {
  const rows = await client.judgingCriterion.findMany({
    where: { eventId },
    select: { id: true, name: true, description: true, weight: true, maxScore: true },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
  });
  return rows.map(judgingCriterionDto);
}

/** Submissions this judge may see: SUBMITTED, assigned (unless judgesSeeAll), and no conflict of interest. */
async function visibleSubmissionIds(client: Prisma.TransactionClient, event: { id: string; judgesSeeAll: boolean }, judgeUserId: string, onlyId?: string) {
  const rows = await client.submission.findMany({
    where: {
      eventId: event.id,
      status: SubmissionStatus.SUBMITTED,
      ...(onlyId ? { id: onlyId } : {}),
      ...(event.judgesSeeAll ? {} : { assignments: { some: { judgeUserId } } }),
    },
    select: { id: true, teamId: true, rsvpId: true },
  });
  const conflicts = (await conflictKeysFor(client, event.id, [judgeUserId])).get(judgeUserId);
  return rows.filter((row) => !hasConflictOfInterest(row, conflicts)).map((row) => row.id);
}

/**
 * SQL conditions (on `"Submission" s`) for the submissions this judge may see,
 * the same rule as visibleSubmissionIds: SUBMITTED, in this event, assigned
 * unless judgesSeeAll, and not an entrant the judge's own account belongs to.
 */
function judgeVisibleSql(event: { id: string; judgesSeeAll: boolean }, judgeUserId: string, conflicts: ConflictKeys | undefined): Prisma.Sql[] {
  const conditions: Prisma.Sql[] = [
    Prisma.sql`s."eventId" = ${event.id}`,
    Prisma.sql`s."status" = ${SubmissionStatus.SUBMITTED}::"SubmissionStatus"`,
  ];
  if (!event.judgesSeeAll) {
    conditions.push(Prisma.sql`EXISTS (SELECT 1 FROM "JudgeAssignment" ja WHERE ja."submissionId" = s."id" AND ja."judgeUserId" = ${judgeUserId})`);
  }
  const teamIds = [...(conflicts?.teamIds ?? [])];
  const rsvpIds = [...(conflicts?.rsvpIds ?? [])];
  if (teamIds.length) conditions.push(Prisma.sql`(s."teamId" IS NULL OR s."teamId" NOT IN (${Prisma.join(teamIds)}))`);
  if (rsvpIds.length) conditions.push(Prisma.sql`(s."rsvpId" IS NULL OR s."rsvpId" NOT IN (${Prisma.join(rsvpIds)}))`);
  return conditions;
}

function reviewedBySql(judgeUserId: string): Prisma.Sql {
  return Prisma.sql`EXISTS (SELECT 1 FROM "JudgeReview" jr WHERE jr."submissionId" = s."id" AND jr."judgeUserId" = ${judgeUserId} AND jr."submittedAt" IS NOT NULL)`;
}

function scoredBySql(judgeUserId: string): Prisma.Sql {
  return Prisma.sql`EXISTS (SELECT 1 FROM "JudgeScore" js WHERE js."submissionId" = s."id" AND js."judgeUserId" = ${judgeUserId})`;
}

function judgeFilterSql(filter: JudgeSubmissionFilter, judgeUserId: string): Prisma.Sql | null {
  if (filter === "reviewed") return reviewedBySql(judgeUserId);
  if (filter === "todo") return Prisma.sql`NOT ${reviewedBySql(judgeUserId)}`;
  if (filter === "in_progress") return Prisma.sql`(NOT ${reviewedBySql(judgeUserId)} AND ${scoredBySql(judgeUserId)})`;
  return null;
}

const EMPTY_JUDGE_COUNTS: JudgeSubmissionCounts = { all: 0, todo: 0, in_progress: 0, reviewed: 0 };

/** The event and the judge's conflict keys, once eligibility is confirmed; null otherwise. */
async function judgeListScope(ctx: JudgeContext) {
  const event = await prisma.event.findFirst({ where: { id: ctx.eventId, organisationId: ctx.organisationId }, select: judgingEventSelect });
  if (!event?.submissionsEnabled) return null;
  if (!(await isEligibleJudge(prisma, event.organisationId, event.id, ctx.userId))) return null;
  const conflicts = (await conflictKeysFor(prisma, event.id, [ctx.userId])).get(ctx.userId);
  return { event, visible: judgeVisibleSql(event, ctx.userId, conflicts) };
}

/** Totals over every submission this judge may see (ignores the search and the page). */
async function judgeSubmissionCounts(visible: Prisma.Sql[], judgeUserId: string): Promise<JudgeSubmissionCounts> {
  const reviewed = reviewedBySql(judgeUserId);
  const [row] = await prisma.$queryRaw<Array<{ all: bigint; reviewed: bigint; in_progress: bigint }>>`
    SELECT count(*) AS "all",
           count(*) FILTER (WHERE ${reviewed}) AS "reviewed",
           count(*) FILTER (WHERE NOT ${reviewed} AND ${scoredBySql(judgeUserId)}) AS "in_progress"
    FROM "Submission" s
    WHERE ${Prisma.join(visible, " AND ")}`;
  if (!row) return { ...EMPTY_JUDGE_COUNTS };
  const all = Number(row.all);
  const done = Number(row.reviewed);
  return { all, reviewed: done, in_progress: Number(row.in_progress), todo: all - done };
}

/** One bounded page of the judge's list (keyset on `submittedAt, id`), with progress for those rows only. */
async function judgeSubmissionsPage(
  scope: { event: { id: string }; visible: Prisma.Sql[] },
  judgeUserId: string,
  query: { query: string; filter: JudgeSubmissionFilter; cursor?: string | null },
): Promise<Omit<JudgeSubmissionsPageDto, "counts">> {
  const empty = { submissions: [], nextCursor: null };
  const conditions = [...scope.visible];
  const filter = judgeFilterSql(query.filter, judgeUserId);
  if (filter) conditions.push(filter);
  const search = projectSearchSql(query.query);
  if (search) conditions.push(search);
  if (query.cursor) {
    const after = decodeSubmissionCursor(query.cursor);
    if (!after) return empty;
    // `submittedAt` is a UTC wall-clock timestamp(3) column.
    const at = after.submittedAt.toISOString().replace("Z", "");
    conditions.push(Prisma.sql`(s."submittedAt", s."id") > (${at}::timestamp(3), ${after.id})`);
  }
  const ids = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT s."id" FROM "Submission" s
    WHERE ${Prisma.join(conditions, " AND ")}
    ORDER BY s."submittedAt" ASC, s."id" ASC
    LIMIT ${JUDGE_SUBMISSIONS_PAGE_SIZE + 1}`;
  const pageIds = ids.slice(0, JUDGE_SUBMISSIONS_PAGE_SIZE).map((row) => row.id);
  if (pageIds.length === 0) return empty;
  const [rows, scoreCounts, reviews] = await Promise.all([
    prisma.submission.findMany({
      where: { id: { in: pageIds }, eventId: scope.event.id, status: SubmissionStatus.SUBMITTED },
      select: { ...projectSelect, submittedAt: true },
      orderBy: [{ submittedAt: "asc" }, { id: "asc" }],
    }),
    prisma.judgeScore.groupBy({ by: ["submissionId"], where: { judgeUserId, submissionId: { in: pageIds } }, _count: { _all: true } }),
    prisma.judgeReview.findMany({ where: { judgeUserId, submissionId: { in: pageIds }, submittedAt: { not: null } }, select: { submissionId: true } }),
  ]);
  const scored = new Map(scoreCounts.map((row) => [row.submissionId, row._count._all]));
  const submitted = new Set(reviews.map((row) => row.submissionId));
  const last = rows[rows.length - 1];
  return {
    submissions: rows.map((row) => judgeSubmissionDto(row, { scoredCriteria: scored.get(row.id) ?? 0, reviewSubmitted: submitted.has(row.id) })),
    nextCursor: ids.length > JUDGE_SUBMISSIONS_PAGE_SIZE && last?.submittedAt ? encodeSubmissionCursor({ submittedAt: last.submittedAt, id: last.id }) : null,
  };
}

/**
 * The judge's workspace: the rubric, totals, and the first page of the list
 * (or the page `input` asks for). Project content and this judge's own
 * progress only. Null when the event is gone, not a judging event, or the
 * user is not a judge for it; an invalid `input` gives an empty page.
 */
export async function listSubmissionsForJudge(ctx: JudgeContext, input: unknown = {}): Promise<JudgeWorkspaceDto | null> {
  const scope = await judgeListScope(ctx);
  if (!scope) return null;
  const parsed = judgeSubmissionsQuerySchema.safeParse(input);
  const [criteria, counts, page] = await Promise.all([
    criteriaFor(prisma, scope.event.id),
    judgeSubmissionCounts(scope.visible, ctx.userId),
    parsed.success ? judgeSubmissionsPage(scope, ctx.userId, parsed.data) : Promise.resolve({ submissions: [], nextCursor: null }),
  ]);
  return { judgingStatus: scope.event.judgingStatus, criteria, counts, ...page };
}

/** One page of the judge's list for a filter, a search, or "Load more", with fresh totals. */
export async function listJudgeSubmissionsPage(ctx: JudgeContext, input: unknown): Promise<JudgeSubmissionsPageDto | null> {
  const scope = await judgeListScope(ctx);
  if (!scope) return null;
  const parsed = judgeSubmissionsQuerySchema.safeParse(input);
  const [counts, page] = await Promise.all([
    judgeSubmissionCounts(scope.visible, ctx.userId),
    parsed.success ? judgeSubmissionsPage(scope, ctx.userId, parsed.data) : Promise.resolve({ submissions: [], nextCursor: null }),
  ]);
  return { counts, ...page };
}

/** One submission for scoring, with this judge's own scores and review. */
export async function loadSubmissionForJudge(ctx: JudgeContext, submissionId: string): Promise<JudgeSubmissionDetailDto | null> {
  if (!isId(submissionId)) return null;
  const event = await prisma.event.findFirst({ where: { id: ctx.eventId, organisationId: ctx.organisationId }, select: judgingEventSelect });
  if (!event?.submissionsEnabled) return null;
  if (!(await isEligibleJudge(prisma, event.organisationId, event.id, ctx.userId))) return null;
  const ids = await visibleSubmissionIds(prisma, event, ctx.userId, submissionId);
  if (!ids.includes(submissionId)) return null;
  const [criteria, row, scores, review] = await Promise.all([
    criteriaFor(prisma, event.id),
    prisma.submission.findFirst({ where: { id: submissionId, eventId: event.id }, select: projectSelect }),
    prisma.judgeScore.findMany({ where: { submissionId, judgeUserId: ctx.userId }, select: { criterionId: true, score: true } }),
    prisma.judgeReview.findUnique({ where: { submissionId_judgeUserId: { submissionId, judgeUserId: ctx.userId } }, select: { comment: true, submittedAt: true } }),
  ]);
  if (!row) return null;
  return {
    judgingStatus: event.judgingStatus,
    criteria,
    submission: judgeSubmissionDto(row, { scoredCriteria: scores.length, reviewSubmitted: Boolean(review?.submittedAt) }),
    myScores: scores.map((score) => ({ criterionId: score.criterionId, score: score.score })),
    myReview: review ? { comment: review.comment, submittedAt: review.submittedAt } : null,
  };
}

export type JudgeNextDto = {
  /** The project to score next, loaded as for scoring; null when nothing is left (or judging is not open). */
  next: JudgeSubmissionDetailDto | null;
  /** Projects this judge may still review, including `next`. */
  remaining: number;
};

/**
 * "Score next project": among the projects this judge may score now (judging
 * OPEN; SUBMITTED; assigned unless judgesSeeAll; no conflict of interest)
 * that they have not submitted a review for, the one they already started
 * (saved scores or a draft comment), then the one with the fewest submitted
 * reviews from anyone, then the oldest `submittedAt`, then id. So the
 * workload spreads evenly and a half-done review is finished first. Chosen on
 * the server in one query with the list's visibility rules; the pick is then
 * loaded through `loadSubmissionForJudge`, which re-checks access. Null when
 * the user is not a judge for this event.
 */
export async function nextSubmissionForJudge(ctx: JudgeContext): Promise<JudgeNextDto | null> {
  const scope = await judgeListScope(ctx);
  if (!scope) return null;
  if (scope.event.judgingStatus !== JudgingStatus.OPEN) return { next: null, remaining: 0 };
  const notReviewed = Prisma.sql`NOT ${reviewedBySql(ctx.userId)}`;
  const conditions = [...scope.visible, notReviewed];
  const started = Prisma.sql`(${scoredBySql(ctx.userId)} OR EXISTS (SELECT 1 FROM "JudgeReview" jd WHERE jd."submissionId" = s."id" AND jd."judgeUserId" = ${ctx.userId}))`;
  const [picked, [remainingRow]] = await Promise.all([
    prisma.$queryRaw<Array<{ id: string }>>`
      SELECT s."id" FROM "Submission" s
      WHERE ${Prisma.join(conditions, " AND ")}
      ORDER BY (CASE WHEN ${started} THEN 0 ELSE 1 END) ASC,
               (SELECT count(*) FROM "JudgeReview" rc WHERE rc."submissionId" = s."id" AND rc."submittedAt" IS NOT NULL) ASC,
               s."submittedAt" ASC NULLS LAST,
               s."id" ASC
      LIMIT 1`,
    prisma.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) AS "count" FROM "Submission" s WHERE ${Prisma.join(conditions, " AND ")}`,
  ]);
  const remaining = Number(remainingRow?.count ?? 0);
  const id = picked[0]?.id;
  if (!id) return { next: null, remaining: 0 };
  const next = await loadSubmissionForJudge(ctx, id);
  return { next, remaining: next ? remaining : 0 };
}

/** Lock the event, then confirm judging is open and this judge may score this submission. */
async function lockedJudgeTarget(tx: Prisma.TransactionClient, ctx: JudgeContext, submissionId: string): Promise<JudgingResult<{ event: JudgingEvent }>> {
  const event = await lockEventShared(tx, ctx.eventId);
  if (!event || event.organisationId !== ctx.organisationId || !event.submissionsEnabled) return fail(EVENT_NOT_FOUND);
  if (!(await isEligibleJudge(tx, event.organisationId, event.id, ctx.userId))) return fail(NOT_FOUND);
  if (event.judgingStatus !== JudgingStatus.OPEN) return fail(JUDGING_NOT_OPEN);
  const visible = await visibleSubmissionIds(tx, event, ctx.userId, submissionId);
  if (!visible.includes(submissionId)) return fail(NOT_FOUND);
  return ok({ event });
}

/**
 * Save some or all scores for one submission. Each score is a whole number in
 * 0..maxScore for a criterion of this event. Upserts on the unique
 * (submission, judge, criterion) key, so concurrent saves never duplicate.
 */
export async function saveJudgeScores(ctx: JudgeContext, input: unknown): Promise<JudgingResult<{ scored: number; total: number }>> {
  const parsed = judgeScoresSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { submissionId, scores } = parsed.data;
  return prisma.$transaction(async (tx): Promise<JudgingResult<{ scored: number; total: number }>> => {
    const target = await lockedJudgeTarget(tx, ctx, submissionId);
    if (!target.ok) return target;
    const criteria = await criteriaFor(tx, target.data.event.id);
    const byId = new Map(criteria.map((criterion) => [criterion.id, criterion]));
    for (const entry of scores) {
      const criterion = byId.get(entry.criterionId);
      if (!criterion) return fail("Unknown criterion.");
      if (entry.score > criterion.maxScore) return fail(`Scores for “${criterion.name}” go up to ${criterion.maxScore}.`);
    }
    for (const entry of scores) {
      await tx.$executeRaw`
        INSERT INTO "JudgeScore" ("id", "submissionId", "judgeUserId", "criterionId", "score", "createdAt", "updatedAt")
        VALUES (${crypto.randomUUID()}, ${submissionId}, ${ctx.userId}, ${entry.criterionId}, ${entry.score}, NOW(), NOW())
        ON CONFLICT ("submissionId", "judgeUserId", "criterionId")
        DO UPDATE SET "score" = EXCLUDED."score", "updatedAt" = NOW()`;
    }
    const scored = await tx.judgeScore.count({ where: { submissionId, judgeUserId: ctx.userId, criterionId: { in: criteria.map((c) => c.id) } } });
    return ok({ scored, total: criteria.length });
  });
}

/**
 * Save the judge's private comment, and with `submit` (the default) mark the
 * review complete. Submitting needs every criterion scored. Upserts on the
 * unique (submission, judge) key.
 */
export async function submitJudgeReview(ctx: JudgeContext, input: unknown): Promise<JudgingResult<{ submitted: boolean }>> {
  const parsed = judgeReviewSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { submissionId, comment, submit } = parsed.data;
  return prisma.$transaction(async (tx): Promise<JudgingResult<{ submitted: boolean }>> => {
    const target = await lockedJudgeTarget(tx, ctx, submissionId);
    if (!target.ok) return target;
    if (submit) {
      const criteria = await criteriaFor(tx, target.data.event.id);
      if (criteria.length === 0) return fail("This event has no rubric yet.");
      const scored = await tx.judgeScore.count({ where: { submissionId, judgeUserId: ctx.userId, criterionId: { in: criteria.map((c) => c.id) } } });
      if (scored < criteria.length) return fail("Score every criterion before submitting your review.");
    }
    const submittedAt = submit ? new Date() : null;
    await tx.$executeRaw`
      INSERT INTO "JudgeReview" ("id", "submissionId", "judgeUserId", "comment", "submittedAt", "createdAt", "updatedAt")
      VALUES (${crypto.randomUUID()}, ${submissionId}, ${ctx.userId}, ${comment}, ${submittedAt}, NOW(), NOW())
      ON CONFLICT ("submissionId", "judgeUserId")
      DO UPDATE SET "comment" = EXCLUDED."comment",
                    "submittedAt" = COALESCE(EXCLUDED."submittedAt", "JudgeReview"."submittedAt"),
                    "updatedAt" = NOW()`;
    const review = await tx.judgeReview.findUnique({ where: { submissionId_judgeUserId: { submissionId, judgeUserId: ctx.userId } }, select: { submittedAt: true } });
    return ok({ submitted: Boolean(review?.submittedAt) });
  });
}

// ---------------------------------------------------------------------------
// Organiser read models
// ---------------------------------------------------------------------------

export type OrganiserAwardDto = {
  id: string;
  name: string;
  description: string;
  winners: Array<{ place: number; submissionId: string; title: string; entrantName: string }>;
};

export type JudgingSetupDto = {
  settings: JudgingSettingsDto;
  criteria: JudgingCriterionDto[];
  awards: OrganiserAwardDto[];
  counts: Record<SubmissionStatus, number>;
};

/** Everything the organiser Judging tab needs to render its settings, rubric, and awards. */
export async function loadJudgingSetup(ctx: JudgingOrganiserContext): Promise<JudgingSetupDto | null> {
  const event = await prisma.event.findFirst({ where: { id: ctx.eventId, organisationId: ctx.organisationId }, select: judgingEventSelect });
  if (!event) return null;
  const [criteria, awards, grouped] = await Promise.all([
    criteriaFor(prisma, event.id),
    prisma.eventAward.findMany({
      where: { eventId: event.id },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        name: true,
        description: true,
        winners: { orderBy: { place: "asc" }, select: { place: true, submission: { select: { id: true, title: true, ...nameSourceSelect } } } },
      },
    }),
    prisma.submission.groupBy({ by: ["status"], where: { eventId: event.id }, _count: { _all: true } }),
  ]);
  const counts = { DRAFT: 0, SUBMITTED: 0, WITHDRAWN: 0, DISQUALIFIED: 0 } as Record<SubmissionStatus, number>;
  for (const row of grouped) counts[row.status] = row._count._all;
  return {
    settings: settingsDto(event),
    criteria,
    awards: awards.map((award) => ({
      id: award.id,
      name: award.name,
      description: award.description,
      winners: award.winners.map((winner) => ({
        place: winner.place,
        submissionId: winner.submission.id,
        title: winner.submission.title,
        entrantName: entrantDisplayName(winner.submission),
      })),
    })),
    counts,
  };
}

export type OrganiserSubmissionsPage = { submissions: OrganiserSubmissionDto[]; nextCursor: string | null };

/**
 * Judging → Submissions, one bounded page at a time (oldest first, keyset
 * paging on `createdAt, id`), with status, organiser-only reason, and
 * assigned judges. The status filter and the search (project title, or the
 * entrant's name: the team name, else the registrant's name) run in SQL,
 * within this event of this organisation only. Per-status totals come from
 * `loadJudgingSetup().counts`.
 */
export async function listSubmissionsForOrganiser(
  ctx: JudgingOrganiserContext,
  input: unknown = {},
  options: { pageSize?: number } = {},
): Promise<OrganiserSubmissionsPage> {
  // The dashboard pages 50 at a time; the Submissions CSV reads larger,
  // still bounded, batches through the same query.
  const pageSize = Math.min(Math.max(1, Math.floor(options.pageSize ?? ORGANISER_SUBMISSIONS_PAGE_SIZE)), JUDGING_EXPORT_BATCH_SIZE);
  const empty: OrganiserSubmissionsPage = { submissions: [], nextCursor: null };
  const parsed = organiserSubmissionsQuerySchema.safeParse(input);
  if (!parsed.success) return empty;
  const { query, status, cursor } = parsed.data;
  const event = await prisma.event.findFirst({ where: { id: ctx.eventId, organisationId: ctx.organisationId }, select: { id: true } });
  if (!event) return empty;

  const conditions: Prisma.Sql[] = [Prisma.sql`s."eventId" = ${event.id}`];
  if (status !== "all") conditions.push(Prisma.sql`s."status" = ${status}::"SubmissionStatus"`);
  if (query) {
    const pattern = `%${escapeLikePattern(query)}%`;
    conditions.push(Prisma.sql`(
      s."title" ILIKE ${pattern}
      OR COALESCE(t."name", NULLIF(btrim(u."name"), ''), NULLIF(btrim(r."guestName"), ''), '') ILIKE ${pattern}
    )`);
  }
  if (cursor) {
    const after = decodeTimeCursor(cursor);
    if (!after) return empty;
    // `createdAt` is a UTC wall-clock timestamp(3) column.
    const at = after.at.toISOString().replace("Z", "");
    conditions.push(Prisma.sql`(s."createdAt", s."id") > (${at}::timestamp(3), ${after.id})`);
  }
  const ids = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT s."id" FROM "Submission" s
    LEFT JOIN "Team" t ON t."id" = s."teamId"
    LEFT JOIN "RSVP" r ON r."id" = s."rsvpId"
    LEFT JOIN "User" u ON u."id" = r."userId"
    WHERE ${Prisma.join(conditions, " AND ")}
    ORDER BY s."createdAt" ASC, s."id" ASC
    LIMIT ${pageSize + 1}`;
  const pageIds = ids.slice(0, pageSize).map((row) => row.id);
  if (pageIds.length === 0) return empty;

  const rows = await prisma.submission.findMany({
    where: { id: { in: pageIds }, eventId: event.id },
    select: {
      ...projectSelect,
      status: true,
      createdAt: true,
      submittedAt: true,
      updatedAt: true,
      disqualifiedReason: true,
      assignments: { select: { judgeUserId: true }, orderBy: [{ createdAt: "asc" }, { judgeUserId: "asc" }] },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const last = rows[rows.length - 1];
  return {
    submissions: rows.map((row) => organiserSubmissionDto(row, row.assignments.map((assignment) => assignment.judgeUserId))),
    nextCursor: ids.length > pageSize && last ? encodeTimeCursor({ at: last.createdAt, id: last.id }) : null,
  };
}

export type OrganiserReviewDto = {
  judgeName: string;
  submittedAt: Date | null;
  comment: string;
  scores: Array<{ criterionId: string; score: number }>;
};

/** Judges' reviews of one submission, with private comments. Organisers only. */
export async function loadSubmissionReviewsForOrganiser(ctx: JudgingOrganiserContext, submissionId: string): Promise<OrganiserReviewDto[] | null> {
  if (!isId(submissionId)) return null;
  const submission = await prisma.submission.findFirst({
    where: { id: submissionId, eventId: ctx.eventId, event: { organisationId: ctx.organisationId } },
    select: {
      reviews: { select: { judgeUserId: true, comment: true, submittedAt: true, judge: { select: { name: true } } }, orderBy: { createdAt: "asc" } },
      scores: { select: { judgeUserId: true, criterionId: true, score: true } },
    },
  });
  if (!submission) return null;
  return submission.reviews.map((review) => ({
    judgeName: review.judge.name?.trim() || "Judge",
    submittedAt: review.submittedAt,
    comment: review.comment,
    scores: submission.scores.filter((score) => score.judgeUserId === review.judgeUserId).map((score) => ({ criterionId: score.criterionId, score: score.score })),
  }));
}

export type ResultRowDto = {
  submissionId: string;
  title: string;
  entrantName: string;
  status: SubmissionStatus;
  /** The active method's score, which ranks (rawScore or adjustedScore). */
  score: number | null;
  rawScore: number | null;
  adjustedScore: number | null;
  judgesCounted: number;
  rank: number | null;
  criterionAverages: CriterionAverage[];
};

export type JudgeProgressDto = {
  userId: string;
  name: string;
  /** Submissions this judge can see (assignment rule and conflicts applied). */
  visible: number;
  reviewsSubmitted: number;
};

export type JudgingResultsDto = {
  judgingStatus: JudgingStatus;
  resultsPublishedAt: Date | null;
  /** Which score ranks: RAW, or ZSCORE ("Adjust for harsh/generous judges"). */
  scoreNormalization: ScoreNormalization;
  criteria: JudgingCriterionDto[];
  /** SUBMITTED projects ranked; DISQUALIFIED ones follow with no rank. */
  rows: ResultRowDto[];
  /** `submissionId\0judgeUserId` of every review counted in the scores (server-side only, for the CSV export). */
  countedReviewKeys: string[];
};

/**
 * The organiser's ranked score table, computed over every SUBMITTED and
 * DISQUALIFIED project (ranks need the whole set). The dashboard shows it a
 * page at a time (`loadJudgingResultsPage`); the CSV export uses all of it.
 * Per-judge progress comes from `loadJudgeProgress`, with aggregates.
 */
/** One judge's work on one SUBMITTED project: a review row, saved scores, or both. */
export type JudgePairWork = {
  submissionId: string;
  judgeUserId: string;
  /** A review row exists (draft or submitted). */
  reviewed: boolean;
  /** The review's submission time; null for a draft review or scores without a review. */
  submittedAt: Date | null;
  /** Saved score rows. */
  scored: number;
  /** The newest saved score; null without scores. */
  lastSavedAt: Date | null;
  /** The saved scores by criterion id (empty unless read `withScores`). */
  scores: Map<string, number>;
};

/**
 * Every (judge, SUBMITTED project) pair of the event with a review row or
 * saved scores, aggregated in SQL: one row per pair rather than one per
 * score. Scores are grouped per project through the
 * `JudgeScore (submissionId, judgeUserId, criterionId)` unique index, so the
 * read is proportional to this event's projects and never sorts or scans
 * every score of the instance. Sorted by project then judge. Eligibility
 * and conflicts of interest are the caller's to apply.
 */
export async function judgeWorkOnSubmitted(client: Prisma.TransactionClient, eventId: string, options: { withScores: boolean }): Promise<JudgePairWork[]> {
  const arrays = options.withScores
    ? Prisma.sql`array_agg(js."criterionId") AS "criterionIds", array_agg(js."score") AS "scores"`
    : Prisma.sql`'{}'::text[] AS "criterionIds", '{}'::int[] AS "scores"`;
  const submitted = Prisma.sql`s."eventId" = ${eventId} AND s."status" = ${SubmissionStatus.SUBMITTED}::"SubmissionStatus"`;
  const [scoreRows, reviewRows] = await Promise.all([
    client.$queryRaw<Array<{ submissionId: string; judgeUserId: string; scored: number; lastSavedAt: Date; criterionIds: string[]; scores: number[] }>>`
      SELECT s."id" AS "submissionId", x."judgeUserId", x."scored", x."lastSavedAt", x."criterionIds", x."scores"
      FROM "Submission" s
      CROSS JOIN LATERAL (
        -- Both arrays come from one aggregate pass, so their elements pair up.
        SELECT js."judgeUserId", count(*)::int AS "scored", max(js."updatedAt") AS "lastSavedAt", ${arrays}
        FROM "JudgeScore" js
        WHERE js."submissionId" = s."id"
        GROUP BY js."judgeUserId"
      ) x
      WHERE ${submitted}`,
    client.$queryRaw<Array<{ submissionId: string; judgeUserId: string; submittedAt: Date | null }>>`
      SELECT jr."submissionId", jr."judgeUserId", jr."submittedAt"
      FROM "JudgeReview" jr JOIN "Submission" s ON s."id" = jr."submissionId"
      WHERE ${submitted}`,
  ]);
  const pairs = new Map<string, JudgePairWork>();
  for (const row of scoreRows) {
    pairs.set(`${row.submissionId}\u0000${row.judgeUserId}`, {
      submissionId: row.submissionId,
      judgeUserId: row.judgeUserId,
      reviewed: false,
      submittedAt: null,
      scored: Number(row.scored),
      lastSavedAt: row.lastSavedAt,
      scores: new Map(row.criterionIds.map((criterionId, index) => [criterionId, Number(row.scores[index])])),
    });
  }
  for (const row of reviewRows) {
    const key = `${row.submissionId}\u0000${row.judgeUserId}`;
    const pair = pairs.get(key);
    if (pair) {
      pair.reviewed = true;
      pair.submittedAt = row.submittedAt;
    } else {
      pairs.set(key, { submissionId: row.submissionId, judgeUserId: row.judgeUserId, reviewed: true, submittedAt: row.submittedAt, scored: 0, lastSavedAt: null, scores: new Map() });
    }
  }
  const byId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  return [...pairs.values()].sort((a, b) => byId(a.submissionId, b.submissionId) || byId(a.judgeUserId, b.judgeUserId));
}

/** Submitted reviews of SUBMITTED projects with their scores (eligibility and conflicts still to apply). */
async function submittedReviewScores(client: Prisma.TransactionClient, eventId: string): Promise<CountedReview[]> {
  const pairs = await judgeWorkOnSubmitted(client, eventId, { withScores: true });
  return pairs.filter((pair) => pair.submittedAt != null).map((pair) => ({ submissionId: pair.submissionId, judgeUserId: pair.judgeUserId, scores: pair.scores }));
}

export async function loadJudgingResults(ctx: JudgingOrganiserContext, options: { method?: ScoreNormalization } = {}): Promise<JudgingResultsDto | null> {
  const event = await prisma.event.findFirst({ where: { id: ctx.eventId, organisationId: ctx.organisationId }, select: { ...judgingEventSelect, scoreNormalization: true } });
  if (!event) return null;
  const [criteria, submissions, reviews, eligible] = await Promise.all([
    criteriaFor(prisma, event.id),
    prisma.submission.findMany({
      where: { eventId: event.id, status: { in: [SubmissionStatus.SUBMITTED, SubmissionStatus.DISQUALIFIED] } },
      select: { id: true, title: true, status: true, teamId: true, rsvpId: true, ...nameSourceSelect },
      orderBy: [{ submittedAt: "asc" }, { id: "asc" }],
    }),
    submittedReviewScores(prisma, event.id),
    listEligibleJudges(ctx),
  ]);
  const submitted = submissions.filter((row) => row.status === SubmissionStatus.SUBMITTED);
  const byId = new Map(submissions.map((row) => [row.id, row]));
  const eligibleIds = new Set(eligible.map((judge) => judge.userId));
  const reviewAuthorIds = [...new Set(reviews.map((review) => review.judgeUserId))];
  const authorConflicts = await conflictKeysFor(prisma, event.id, reviewAuthorIds);
  // Only reviews that may count: submitted, of a SUBMITTED project (both
  // checked in SQL above), by someone who can still judge this event, with no
  // conflict of interest now. A revoked JUDGE grant or a judge who later
  // registered on that entrant drops out of the score (their rows stay, for
  // the organiser's record).
  const submittedReviews = reviews.filter((review) => {
    const row = byId.get(review.submissionId);
    return Boolean(row?.status === SubmissionStatus.SUBMITTED && eligibleIds.has(review.judgeUserId) && !hasConflictOfInterest(row, authorConflicts.get(review.judgeUserId)));
  });
  // The saved method ranks, unless the caller names one (the Results CSV
  // passes the method the organiser's table is showing).
  const method = options.method ?? event.scoreNormalization;
  const results = computeJudgingResultsFromReviews({ submissionIds: submitted.map((row) => row.id), criteria, reviews: submittedReviews, method });
  const rows: ResultRowDto[] = [
    ...results.map((result) => {
      const row = byId.get(result.submissionId)!;
      return { ...result, title: row.title, entrantName: entrantDisplayName(row), status: row.status };
    }),
    ...submissions
      .filter((row) => row.status === SubmissionStatus.DISQUALIFIED)
      .map((row) => ({
        submissionId: row.id,
        title: row.title,
        entrantName: entrantDisplayName(row),
        status: row.status,
        score: null,
        rawScore: null,
        adjustedScore: null,
        judgesCounted: 0,
        rank: null,
        criterionAverages: criteria.map((criterion) => ({ criterionId: criterion.id, average: null })),
      })),
  ];

  const countedReviewKeys = submittedReviews.map((review) => `${review.submissionId}\u0000${review.judgeUserId}`);
  return { judgingStatus: event.judgingStatus, resultsPublishedAt: event.resultsPublishedAt, scoreNormalization: method, criteria, rows, countedReviewKeys };
}

export type JudgingResultsPageDto = NumberedPage<ResultRowDto> & {
  criteria: JudgingCriterionDto[];
  scoreNormalization: ScoreNormalization;
  /** The search the page was filtered by ("" for none). */
  query: string;
  /** Every row in the ranking, before any search. */
  rankedTotal: number;
  /** The score filter the page was filtered by ("all" for none). */
  scored: ResultsScoreFilter;
  /** Rows per score filter over the whole ranking (before the search), for the chips. */
  scoreCounts: Record<ResultsScoreFilter, number>;
};

/**
 * One numbered page of the ranked table. The ranking is computed over every
 * project first, so a rank (and a tie) is the same on every page and in
 * every search; a search only filters which ranked rows are shown.
 */
export async function loadJudgingResultsPage(ctx: JudgingOrganiserContext, input: unknown = {}): Promise<JudgingResultsPageDto | null> {
  const parsed = judgingResultsQuerySchema.safeParse(input);
  if (!parsed.success) return null;
  const results = await loadJudgingResults(ctx);
  if (!results) return null;
  const { query, page, scored } = parsed.data;
  const matching = results.rows.filter((row) => matchesScoreFilter(row, scored) && (!query || matchesProjectQuery(row, query)));
  return {
    ...numberedPage(matching, page, JUDGING_RESULTS_PAGE_SIZE),
    criteria: results.criteria,
    scoreNormalization: results.scoreNormalization,
    query,
    rankedTotal: results.rows.length,
    scored,
    scoreCounts: countScoreFilters(results.rows),
  };
}

export type AwardCandidateDto = { submissionId: string; title: string; entrantName: string; rank: number | null; score: number | null };

/**
 * Projects for the Awards winner picker: SUBMITTED only (setAwardWinner
 * refuses anything else), in ranking order, searchable by title or entrant,
 * in short "Show more" steps.
 */
export async function searchAwardCandidates(ctx: JudgingOrganiserContext, input: unknown = {}): Promise<OffsetPage<AwardCandidateDto> | null> {
  const parsed = awardCandidatesQuerySchema.safeParse(input);
  if (!parsed.success) return null;
  const results = await loadJudgingResults(ctx);
  if (!results) return null;
  const { query, offset } = parsed.data;
  const candidates = results.rows
    .filter((row) => row.status === SubmissionStatus.SUBMITTED && matchesProjectQuery(row, query))
    .map((row) => ({ submissionId: row.submissionId, title: row.title, entrantName: row.entrantName, rank: row.rank, score: row.score }));
  return offsetPage(candidates, offset, AWARD_CANDIDATES_PAGE_SIZE);
}

export type JudgeProgressRowDto = EligibleJudgeDto & {
  /** Submissions this judge can see (assignment rule and conflicts applied); null for an organiser who hasn't judged yet. */
  visible: number | null;
  /** Reviews that count in the scores (see loadJudgingResults). */
  reviewsSubmitted: number;
  /** Assignments on any project of the event, whatever its status. */
  assigned: number;
};

function countBy(rows: Array<{ judgeUserId: string; _count: { _all: number } }>): Map<string, number> {
  return new Map(rows.map((row) => [row.judgeUserId, row._count._all]));
}

/**
 * Judging → Judges: one row per eligible judge (JUDGE collaborators, then
 * organisation owners and admins), plus anyone else whose review is on record
 * (a revoked judge: listed with no counted reviews). Counts come from
 * aggregates, not from loading every score: an eligible judge sees every
 * SUBMITTED project (or their assigned ones), less entrants their own
 * account is registered on; a review counts when it is submitted, on a
 * SUBMITTED project, and not such an entrant's. Organisers show "not judging
 * yet" (visible null) until they review, score, or are assigned.
 */
export async function loadJudgeProgress(ctx: JudgingOrganiserContext): Promise<JudgeProgressRowDto[] | null> {
  const event = await prisma.event.findFirst({ where: { id: ctx.eventId, organisationId: ctx.organisationId }, select: { id: true, judgesSeeAll: true } });
  if (!event) return null;
  const submittedOnly = { eventId: event.id, status: SubmissionStatus.SUBMITTED };
  const [eligible, reviewAuthors, scorers, assignedAll, assignedSubmitted, countedReviews, submittedCount] = await Promise.all([
    listEligibleJudges(ctx),
    prisma.judgeReview.groupBy({ by: ["judgeUserId"], where: { submission: { eventId: event.id } }, _count: { _all: true }, orderBy: { judgeUserId: "asc" } }),
    prisma.judgeScore.groupBy({ by: ["judgeUserId"], where: { submission: { eventId: event.id } }, _count: { _all: true }, orderBy: { judgeUserId: "asc" } }),
    prisma.judgeAssignment.groupBy({ by: ["judgeUserId"], where: { eventId: event.id, submission: { eventId: event.id } }, _count: { _all: true }, orderBy: { judgeUserId: "asc" } }),
    prisma.judgeAssignment.groupBy({ by: ["judgeUserId"], where: { eventId: event.id, submission: submittedOnly }, _count: { _all: true }, orderBy: { judgeUserId: "asc" } }),
    prisma.judgeReview.groupBy({ by: ["judgeUserId"], where: { submittedAt: { not: null }, submission: submittedOnly }, _count: { _all: true }, orderBy: { judgeUserId: "asc" } }),
    prisma.submission.count({ where: submittedOnly }),
  ]);
  const active = new Set([...reviewAuthors, ...scorers, ...assignedAll].map((row) => row.judgeUserId));
  const eligibleIds = new Set(eligible.map((judge) => judge.userId));
  const formerIds = reviewAuthors.map((row) => row.judgeUserId).filter((id) => !eligibleIds.has(id));
  const counted = new Set([...eligible.filter((judge) => judge.kind === "judge" || active.has(judge.userId)).map((judge) => judge.userId)]);

  // Conflicts of interest are rare and small (a judge's own registrations),
  // so the SUBMITTED projects they touch are read row by row.
  const conflicts = await conflictKeysFor(prisma, event.id, [...counted]);
  const teamIds = [...conflicts.values()].flatMap((keys) => [...keys.teamIds]);
  const rsvpIds = [...conflicts.values()].flatMap((keys) => [...keys.rsvpIds]);
  const conflicted =
    teamIds.length + rsvpIds.length === 0
      ? []
      : await prisma.submission.findMany({
          where: { ...submittedOnly, OR: [...(teamIds.length ? [{ teamId: { in: teamIds } }] : []), ...(rsvpIds.length ? [{ rsvpId: { in: rsvpIds } }] : [])] },
          select: {
            teamId: true,
            rsvpId: true,
            assignments: { where: { judgeUserId: { in: [...counted] } }, select: { judgeUserId: true } },
            reviews: { where: { judgeUserId: { in: [...counted] }, submittedAt: { not: null } }, select: { judgeUserId: true } },
          },
        });
  const formerNames =
    formerIds.length === 0 ? new Map<string, string>() : new Map((await prisma.user.findMany({ where: { id: { in: formerIds } }, select: { id: true, name: true } })).map((user) => [user.id, user.name?.trim() || "Judge"]));

  const assignedTotal = countBy(assignedAll);
  const assignedVisible = countBy(assignedSubmitted);
  const reviewsCounted = countBy(countedReviews);
  const progress = (userId: string) => {
    const own = conflicted.filter((row) => hasConflictOfInterest(row, conflicts.get(userId)));
    const hidden = own.filter((row) => event.judgesSeeAll || row.assignments.some((assignment) => assignment.judgeUserId === userId)).length;
    const hiddenReviews = own.filter((row) => row.reviews.some((review) => review.judgeUserId === userId)).length;
    return {
      visible: (event.judgesSeeAll ? submittedCount : assignedVisible.get(userId) ?? 0) - hidden,
      reviewsSubmitted: (reviewsCounted.get(userId) ?? 0) - hiddenReviews,
    };
  };
  const rows: JudgeProgressRowDto[] = eligible.map((judge) =>
    counted.has(judge.userId)
      ? { ...judge, ...progress(judge.userId), assigned: assignedTotal.get(judge.userId) ?? 0 }
      : { ...judge, visible: null, reviewsSubmitted: 0, assigned: assignedTotal.get(judge.userId) ?? 0 },
  );
  // A judge whose grant was revoked after reviewing stays listed for the record; their reviews no longer count.
  for (const userId of formerIds) {
    rows.push({ userId, name: formerNames.get(userId) ?? "Judge", email: null, kind: "judge", visible: 0, reviewsSubmitted: 0, assigned: assignedTotal.get(userId) ?? 0 });
  }
  return rows;
}

/** Projects per batch when a judging CSV streams (bounded reads of reviews and scores). */
export const JUDGING_EXPORT_BATCH_SIZE = 200;

/** A CSV export ready to stream: the header row, then bounded batches of rows. */
export type CsvExportPlan = {
  header: string[];
  batches: () => AsyncGenerator<string[][]>;
};

export type JudgingResultsExportView = {
  /** The Results search (title or entrant); ranks are computed over every project first. */
  query?: string;
  /** The Results score chip. */
  scored?: ResultsScoreFilter;
  /** The score method the table shows; the event's saved one when omitted. */
  method?: ScoreNormalization;
};

/**
 * `/api/exports/events/{eventId}/judging` (owners and admins only): one row
 * per review, with the result score (the active method's, which ranks) and
 * both the raw and the adjusted score. Judge names, no emails, no comments.
 * The ranking is computed over every project, like Judging → Results, and a
 * search keeps the matching ranked rows without renumbering them. Reviews
 * and scores are read for JUDGING_EXPORT_BATCH_SIZE projects at a time.
 * `rows` counts the projects in the file. Cells go through `buildCsv`.
 */
export async function planJudgingResultsExport(
  ctx: JudgingOrganiserContext,
  view: JudgingResultsExportView = {},
): Promise<(CsvExportPlan & { rows: number; method: ScoreNormalization }) | null> {
  const event = await prisma.event.findFirst({ where: { id: ctx.eventId, organisationId: ctx.organisationId }, select: { id: true, timezone: true } });
  if (!event) return null;
  const results = await loadJudgingResults(ctx, { method: view.method });
  if (!results) return null;
  const query = view.query?.trim() ?? "";
  const scored = view.scored ?? "all";
  // The same filters as loadJudgingResultsPage, over the whole ranking.
  const matching = results.rows.filter((row) => matchesScoreFilter(row, scored) && (!query || matchesProjectQuery(row, query)));
  // Same clock as the dashboard: ISO 8601 in the event timezone, with its offset.
  const timeZone = safeTimeZone(event.timezone);
  const counted = new Set(results.countedReviewKeys);
  const header = ["Rank", "Project", "Entrant", "Status", "Result score", "Raw score", "Adjusted score", "Judges counted", "Judge", `Review submitted (${timeZone})`, "Counted in score", ...results.criteria.map((criterion) => `${criterion.name} (/${criterion.maxScore}, weight ${criterion.weight})`)];

  async function* batches(): AsyncGenerator<string[][]> {
    for (let start = 0; start < matching.length; start += JUDGING_EXPORT_BATCH_SIZE) {
      const chunk = matching.slice(start, start + JUDGING_EXPORT_BATCH_SIZE);
      const ids = chunk.map((row) => row.submissionId);
      // Filter on the score and review rows' own `submissionId` (index lookups
      // for this batch only), with the event and organisation re-checked.
      const scoped = { submissionId: { in: ids }, submission: { eventId: event!.id, event: { organisationId: ctx.organisationId } } };
      const [scores, reviews] = await Promise.all([
        prisma.judgeScore.findMany({ where: scoped, select: { submissionId: true, judgeUserId: true, criterionId: true, score: true } }),
        prisma.judgeReview.findMany({
          where: scoped,
          select: { submissionId: true, judgeUserId: true, submittedAt: true, judge: { select: { name: true } } },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        }),
      ]);
      const scoreIndex = new Map(scores.map((score) => [`${score.submissionId}\u0000${score.judgeUserId}\u0000${score.criterionId}`, score.score]));
      const reviewsBySubmission = new Map<string, typeof reviews>();
      for (const review of reviews) {
        const list = reviewsBySubmission.get(review.submissionId) ?? [];
        list.push(review);
        reviewsBySubmission.set(review.submissionId, list);
      }
      const rows: string[][] = [];
      for (const row of chunk) {
        const rowReviews = reviewsBySubmission.get(row.submissionId) ?? [];
        const base = [
          row.rank?.toString() ?? "",
          row.title,
          row.entrantName,
          row.status,
          row.score?.toFixed(1) ?? "",
          row.rawScore?.toFixed(1) ?? "",
          row.adjustedScore?.toFixed(1) ?? "",
          String(row.judgesCounted),
        ];
        if (rowReviews.length === 0) {
          rows.push([...base, "", "", "", ...results!.criteria.map(() => "")]);
          continue;
        }
        for (const review of rowReviews) {
          const key = `${row.submissionId}\u0000${review.judgeUserId}`;
          rows.push([
            ...base,
            review.judge.name?.trim() || "Judge",
            review.submittedAt ? zonedIsoWithOffset(review.submittedAt, timeZone) : "",
            counted.has(key) ? "Yes" : "No",
            ...results!.criteria.map((criterion) => scoreIndex.get(`${key}\u0000${criterion.id}`)?.toString() ?? ""),
          ]);
        }
      }
      yield rows;
    }
  }

  return { header, batches, rows: matching.length, method: results.scoreNormalization };
}

/** Every row of the judging scores CSV, header first (tests and small callers; the route streams the plan). */
export async function buildJudgingExportRows(ctx: JudgingOrganiserContext, view: JudgingResultsExportView = {}): Promise<string[][] | null> {
  const plan = await planJudgingResultsExport(ctx, view);
  if (!plan) return null;
  const rows: string[][] = [plan.header];
  for await (const batch of plan.batches()) rows.push(...batch);
  return rows;
}

export type JudgingSubmissionsExportView = { query?: string; status?: SubmissionViewFilter };

/**
 * Judging → Submissions → "Export CSV" (owners and admins only): every
 * project matching the view's status filter and search, through the view's
 * own query (`listSubmissionsForOrganiser`) in keyset batches. One row per
 * project with its links, the organiser-only disqualification reason and
 * the assigned judges' names; no entrant emails, answers, tickets, scores or
 * comments. Times in the event timezone with the offset.
 */
export async function planJudgingSubmissionsExport(ctx: JudgingOrganiserContext, view: JudgingSubmissionsExportView = {}): Promise<CsvExportPlan | null> {
  const event = await prisma.event.findFirst({ where: { id: ctx.eventId, organisationId: ctx.organisationId }, select: { id: true, timezone: true } });
  if (!event) return null;
  const timeZone = safeTimeZone(event.timezone);
  if (view.status === "notSubmitted") return planUnsubmittedEntrantsExport(ctx, view.query?.trim() ?? "", timeZone);
  const header = ["Project", "Entrant", "Entry", "Status", `Submitted (${timeZone})`, `Last updated (${timeZone})`, "Summary", "Code", "Demo", "Video", "Assigned judges", "Disqualification reason"];
  const filter = { query: view.query?.trim() ?? "", status: (view.status ?? "all") as OrganiserSubmissionFilter };

  async function* batches(): AsyncGenerator<string[][]> {
    let cursor: string | null = null;
    do {
      const page = await listSubmissionsForOrganiser(ctx, { ...filter, cursor }, { pageSize: JUDGING_EXPORT_BATCH_SIZE });
      if (page.submissions.length === 0) break;
      const judgeIds = [...new Set(page.submissions.flatMap((submission) => submission.assignedJudgeIds))];
      const judges = judgeIds.length ? await prisma.user.findMany({ where: { id: { in: judgeIds } }, select: { id: true, name: true } }) : [];
      const judgeNames = new Map(judges.map((judge) => [judge.id, judge.name?.trim() || "Judge"]));
      yield page.submissions.map((submission) => [
        submission.title,
        submission.entrantName,
        submission.isTeam ? "Team" : "Solo",
        submission.status,
        submission.submittedAt ? zonedIsoWithOffset(submission.submittedAt, timeZone) : "",
        zonedIsoWithOffset(submission.updatedAt, timeZone),
        submission.summary,
        submission.repoUrl ?? "",
        submission.demoUrl ?? "",
        submission.videoUrl ?? "",
        submission.assignedJudgeIds.map((id) => judgeNames.get(id) ?? "Judge").join("; "),
        submission.status === SubmissionStatus.DISQUALIFIED ? submission.disqualifiedReason ?? "" : "",
      ]);
      cursor = page.nextCursor;
    } while (cursor);
  }

  return { header, batches };
}

/**
 * Submissions → "Not submitted" as CSV: entrants (confirmed teams and solo
 * registrants) without a SUBMITTED project, through the view's own query
 * (`listUnsubmittedEntrants`) one keyset page at a time. Names and sizes,
 * never emails.
 */
function planUnsubmittedEntrantsExport(ctx: JudgingOrganiserContext, query: string, timeZone: string): CsvExportPlan {
  const header = ["Entrant", "Entry", "Size", "Project status", "Project", `Registered (${timeZone})`];
  async function* batches(): AsyncGenerator<string[][]> {
    let cursor: string | null = null;
    do {
      const page = await listUnsubmittedEntrants(ctx, { query, cursor });
      if (page.entrants.length === 0) break;
      yield page.entrants.map((entrant) => [
        entrant.name,
        entrant.kind === "team" ? "Team" : "Solo",
        String(entrant.size),
        entrant.submissionStatus ?? "None",
        entrant.submissionTitle ?? "",
        zonedIsoWithOffset(entrant.registeredAt, timeZone),
      ]);
      cursor = page.nextCursor;
    } while (cursor);
  }
  return { header, batches };
}

// ---------------------------------------------------------------------------
// Public read models (callers apply the event page's visibility rules first)
// ---------------------------------------------------------------------------

/**
 * Published results for `/{org}/{event}/results`: awards and SUBMITTED
 * winners only, never scores or comments. Null (render a 404) unless results
 * are published. The caller must already have applied the event page's
 * publication, visibility, and invite rules for this viewer.
 *
 * `query` (trimmed and bounded like the gallery's `?q=`) narrows the winners
 * to those whose project title or shown entrant name contains it; awards
 * left without a match are dropped. The list is bounded by the award limits,
 * so the match runs over the loaded DTOs, on exactly the text shown.
 */
export async function loadPublicResults(eventId: string, options: { query?: string } = {}): Promise<PublicResultsDto | null> {
  if (!isId(eventId)) return null;
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: {
      submissionsEnabled: true,
      resultsPublishedAt: true,
      // Defensive bounds for a public page. They never cut a valid event:
      // award creation stops at EVENT_AWARDS_LIMIT, and each award has at
      // most one winner per place in 1..EVENT_AWARD_PLACE_MAX.
      awards: {
        orderBy: [{ position: "asc" }, { createdAt: "asc" }, { id: "asc" }],
        take: EVENT_AWARDS_LIMIT,
        select: {
          name: true,
          description: true,
          winners: {
            where: { submission: { status: SubmissionStatus.SUBMITTED } },
            orderBy: [{ place: "asc" }, { id: "asc" }],
            take: EVENT_AWARD_PLACE_MAX,
            select: { place: true, submission: { select: { title: true, repoUrl: true, demoUrl: true, videoUrl: true, ...nameSourceSelect } } },
          },
        },
      },
    },
  });
  if (!event?.submissionsEnabled || !event.resultsPublishedAt) return null;
  const query = parseSearchParam(options.query);
  const awards = event.awards.map((award, index) => ({ name: award.name, description: award.description, isTop: index === 0, winners: award.winners.map(publicWinnerDto) }));
  const totalWinners = awards.reduce((sum, award) => sum + award.winners.length, 0);
  if (!query) return { publishedAt: event.resultsPublishedAt, awards, query, totalWinners, matchedWinners: totalWinners };
  const matching = awards
    .map((award) => ({ ...award, winners: award.winners.filter((winner) => matchesProjectQuery(winner, query)) }))
    .filter((award) => award.winners.length > 0);
  return {
    publishedAt: event.resultsPublishedAt,
    awards: matching,
    query,
    totalWinners,
    matchedWinners: matching.reduce((sum, award) => sum + award.winners.length, 0),
  };
}

/** Raw gallery URL values; anything invalid or not yet allowed falls back to the default. */
export type ProjectGalleryQuery = { page?: number; query?: string; filter?: string; sort?: string };

/**
 * One page of submitted projects for `/{org}/{event}/projects`, once the
 * window has closed and the organiser made the gallery public. Null (render a
 * 404) otherwise, before any project is read. The page is clamped to the
 * pages that exist. The caller must already have applied the event page's
 * visibility rules.
 *
 * Search, the *Award winners* filter, and the order (`newest`, `az`,
 * `awards`; lib/galleryQuery.ts) all run in SQL. The filter, the awards
 * order, and award badges exist only once results are published; before
 * that they fall back to all projects, newest first, and no badges, so the
 * gallery never reveals a winner early.
 */
export async function loadProjectGallery(eventId: string, now: Date = new Date(), options: ProjectGalleryQuery = {}): Promise<PublicGalleryDto | null> {
  if (!isId(eventId)) return null;
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { submissionsEnabled: true, projectGalleryPublic: true, submissionsCloseAt: true, resultsPublishedAt: true },
  });
  if (!event || !isProjectGalleryVisible(event, now)) return null;
  const resultsPublished = event.resultsPublishedAt != null;
  const query = parseSearchParam(options.query);
  const filter = parseGalleryFilterParam(options.filter, resultsPublished);
  const sort = parseGallerySortParam(options.sort, resultsPublished);
  const narrowed = query !== "" || filter !== "all";
  const where = galleryWhereSql(eventId, { query, filter });
  const countWhere = (sql: Prisma.Sql) => prisma.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) AS "count" FROM "Submission" s WHERE ${sql}`.then((rows) => Number(rows[0]?.count ?? 0));
  const [total, matched, winners] = await Promise.all([
    prisma.submission.count({ where: { eventId, status: SubmissionStatus.SUBMITTED } }),
    narrowed ? countWhere(where) : null,
    resultsPublished ? countWhere(galleryWhereSql(eventId, { query: "", filter: "winners" })) : 0,
  ]);
  const matchedCount = matched ?? total;
  const pageSize = PROJECT_GALLERY_PAGE_SIZE;
  const totalPages = totalPagesFor(matchedCount, pageSize);
  const page = clampPage(options.page ?? 1, totalPages);
  const result = { total, matched: matchedCount, winners, query, filter, sort, resultsPublished, page, totalPages, pageSize };
  if (matchedCount === 0) return { projects: [], ...result };
  const ids = (
    await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT s."id" FROM ${galleryFromSql(sort)}
      WHERE ${where}
      ORDER BY ${galleryOrderSql(sort)}
      LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`
  ).map((row) => row.id);
  if (ids.length === 0) return { projects: [], ...result };
  const [rows, badges] = await Promise.all([
    prisma.submission.findMany({ where: { id: { in: ids }, eventId, status: SubmissionStatus.SUBMITTED }, select: projectSelect }),
    resultsPublished
      ? prisma.eventAwardWinner.findMany({
          where: { submissionId: { in: ids }, award: { eventId } },
          orderBy: [{ award: { position: "asc" } }, { award: { createdAt: "asc" } }, { award: { id: "asc" } }, { place: "asc" }],
          select: { submissionId: true, place: true, award: { select: { name: true } } },
        })
      : [],
  ]);
  const badgesBySubmission = new Map<string, PublicAwardBadgeDto[]>();
  for (const badge of badges) {
    const list = badgesBySubmission.get(badge.submissionId) ?? [];
    list.push({ name: badge.award.name, place: badge.place });
    badgesBySubmission.set(badge.submissionId, list);
  }
  // Keep the SQL order; the row fetch above is unordered.
  const byId = new Map(rows.map((row) => [row.id, row]));
  const projects = ids.flatMap((id) => {
    const row = byId.get(id);
    return row ? [publicGalleryItemDto(row, badgesBySubmission.get(id) ?? [])] : [];
  });
  return { projects, ...result };
}
