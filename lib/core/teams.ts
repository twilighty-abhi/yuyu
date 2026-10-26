import "server-only";

import {
  EventPrivacyType,
  EventStatus,
  Prisma,
  RegistrationMode,
  RsvpStatus,
  SoloPolicy,
  TeamJoinRequestDirection,
  TeamJoinRequestStatus,
} from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import type { ActionErrorCode, ActionResult } from "@/app/actions/org";
import { flattenZodErrors } from "@/app/actions/utils";
import { canManageRegistrationsFor } from "@/lib/eventAccess";
import { isRegistrationClosed } from "@/lib/registrationCutoff";
import { submitRsvpCore } from "@/lib/rsvpCore";
import { cancelRsvpForUser } from "@/lib/core/rsvpCancel";
import { enqueueRsvpStatusNotification, enqueueTeamCreated, enqueueTeamMemberAdded } from "@/lib/outbox";
import {
  captureSubmissionSnapshotTx,
  restoreSubmissionSnapshotTx,
  retireSoloSubmissionForTeamTx,
  submissionSnapshotSchema,
} from "@/lib/core/submissionLifecycle";
import {
  assignTeamLeaderTx,
  countConfirmedUnits,
  emitTeamWebhooks,
  promoteOldestWaitlistedUnit,
  rsvpWebhookSnapshot,
  rsvpWebhookSnapshotSelect,
  setTeamStatusTx,
  settleTeamAfterMemberLeft,
} from "@/lib/teamUnits";
import type { WebhookEmission } from "@/lib/webhooks/emit";
import { CHECK_IN_LIST_SOURCES, MAX_CHECK_IN_LISTS } from "@/lib/checkInLists";
import { decodeKeyCursor, decodeTimeCursor, encodeKeyCursor, encodeTimeCursor } from "@/lib/keysetCursor";
import { ORGANISER_TEAM_FILTERS, type OrganiserTeamFilter } from "@/lib/organiserTeamFilters";
import {
  generateTeamManageToken,
  generateTeamToken,
  hashTeamManageToken,
  isTeamTokenShape,
  joinTokenFromInput,
  teamJoinPath,
  teamManagePath,
} from "@/lib/teamToken";
import {
  addTeamMemberSchema,
  renameTeamSchema,
  teamNameKey,
  teamNameSchema,
  teamRegistrationIntentSchema,
  teamTokenSchema,
  ticketTokenSchema,
  upsertSeekerProfileSchema,
} from "@/lib/validators";

/**
 * Team registration mutation cores (docs/TEAMS.md), shared by Server Actions
 * and any future API surface. Callers authenticate, rate limit, audit, and
 * revalidate; these functions own the rules.
 *
 * Every mutation takes the Event row lock (`SELECT ... FOR UPDATE`) first,
 * so team changes serialise with RSVP creation, cancellation, approval, and
 * capacity edits. A team id from the browser is always re-read together with
 * its `eventId` inside that transaction, and leader authority is re-checked
 * under the lock (a rotated management token or a transferred leadership
 * takes effect immediately).
 */

export type TeamResult<T = void> = ActionResult<T>;

/** Leader authority, resolved from a management token or a signed-in leader. */
export type TeamLeaderAuth =
  | { kind: "token"; teamId: string; eventId: string; manageTokenHash: string }
  | { kind: "user"; teamId: string; eventId: string; userId: string };

/** The holder of a ticket (check-in) token, for member and seeker actions. */
export type TicketHolder = {
  rsvpId: string;
  eventId: string;
  organisationId: string;
  userId: string | null;
  teamId: string | null;
};

/** An organiser allowed to manage this event's registrations. */
export type OrganiserEventContext = {
  userId: string;
  organisationId: string;
  orgSlug: string;
  eventId: string;
  eventSlug: string;
};

export type JoinRequestActor =
  | { kind: "leader"; auth: TeamLeaderAuth }
  | { kind: "seeker"; holder: TicketHolder };

const TEAM_NOT_FOUND = "Team not found.";
const NOT_A_TEAM_EVENT = "This event does not use team registration.";
/** Leader management that only matters for a team that can still take part (rename, links, leadership, matching). */
const TEAM_DECLINED = "The organisers declined this team, so it can't be changed. You can still remove members or disband it.";
export const INVITE_ONLY_ADD_REFUSED =
  "This event is invite-only. Share your team's join link instead; each person signs in with their invited account to join.";

function fail(error: string, code?: ActionErrorCode): { ok: false; error: string; code?: ActionErrorCode } {
  return code ? { ok: false, error, code } : { ok: false, error };
}

function isUniqueViolation(error: unknown) {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002";
}

function isUniqueViolationOn(error: unknown, column: string) {
  if (!isUniqueViolation(error)) return false;
  const target = (error as { meta?: { target?: unknown } }).meta?.target;
  return Array.isArray(target) ? target.includes(column) : typeof target === "string" && target.includes(column);
}

function personName(person: { guestName: string | null; user: { name: string | null } | null }) {
  return person.user?.name?.trim() || person.guestName?.trim() || "Guest";
}

function personEmail(person: { guestEmail: string | null; user: { email: string | null } | null }) {
  return person.user?.email?.trim() || person.guestEmail || null;
}

const lockedEventSelect = {
  id: true,
  title: true,
  slug: true,
  organisationId: true,
  status: true,
  startDateTime: true,
  endDateTime: true,
  registrationClosesAt: true,
  registrationLeadMinutes: true,
  capacity: true,
  privacyType: true,
  registrationMode: true,
  teamMinSize: true,
  teamMaxSize: true,
  soloPolicy: true,
  page: { select: { isPublished: true } },
} satisfies Prisma.EventSelect;

type LockedEvent = Prisma.EventGetPayload<{ select: typeof lockedEventSelect }>;

/**
 * Run a team mutation and, once it has committed, emit the organisation
 * webhooks it collected (one per member registration that was created,
 * changed status, or was cancelled or removed). Nothing is emitted when the
 * transaction throws and rolls back.
 */
async function teamTransaction<T>(fn: (tx: Prisma.TransactionClient, webhooks: WebhookEmission[]) => Promise<T>): Promise<T> {
  const webhooks: WebhookEmission[] = [];
  const result = await prisma.$transaction((tx) => fn(tx, webhooks));
  emitTeamWebhooks(webhooks);
  return result;
}

/** Take the Event row lock shared with every capacity change, then read it. */
async function lockEvent(tx: Prisma.TransactionClient, eventId: string): Promise<LockedEvent | null> {
  await tx.$queryRaw`SELECT "id" FROM "Event" WHERE "id" = ${eventId} FOR UPDATE`;
  return tx.event.findUnique({ where: { id: eventId }, select: lockedEventSelect });
}

function isOpenForRegistration(event: LockedEvent) {
  return (
    event.status === EventStatus.PUBLISHED &&
    event.page?.isPublished === true &&
    event.endDateTime > new Date() &&
    !isRegistrationClosed(event)
  );
}

function hasFreeSpace(event: { teamMaxSize: number | null }, size: number) {
  return event.teamMaxSize != null && size < event.teamMaxSize;
}

/** Re-read the team by (id, eventId) and confirm the caller still leads it. */
async function lockedLeaderTeam(tx: Prisma.TransactionClient, auth: TeamLeaderAuth) {
  const team = await tx.team.findFirst({
    where: { id: auth.teamId, eventId: auth.eventId },
    select: {
      id: true,
      eventId: true,
      name: true,
      status: true,
      leaderRsvpId: true,
      manageTokenHash: true,
      lookingForMembers: true,
      leaderRsvp: { select: { userId: true, guestName: true, user: { select: { name: true } } } },
    },
  });
  if (!team) return null;
  if (auth.kind === "token" && team.manageTokenHash !== auth.manageTokenHash) return null;
  if (auth.kind === "user" && team.leaderRsvp?.userId !== auth.userId) return null;
  return team;
}

// ---------------------------------------------------------------------------
// Authorisation resolvers
// ---------------------------------------------------------------------------

/** `/team/{manageToken}`: the raw token is hashed and never stored or logged. */
export async function resolveTeamByManageToken(rawToken: string): Promise<TeamLeaderAuth | null> {
  if (!isTeamTokenShape(rawToken)) return null;
  const manageTokenHash = hashTeamManageToken(rawToken);
  const team = await prisma.team.findUnique({ where: { manageTokenHash }, select: { id: true, eventId: true } });
  return team ? { kind: "token", teamId: team.id, eventId: team.eventId, manageTokenHash } : null;
}

/** A signed-in leader reaching the team page from Account → Registrations. */
export async function resolveLeaderForUser(userId: string, teamId: string): Promise<TeamLeaderAuth | null> {
  if (!userId || !teamId || teamId.length > 128) return null;
  const team = await prisma.team.findFirst({
    where: { id: teamId, leaderRsvp: { userId } },
    select: { id: true, eventId: true },
  });
  return team ? { kind: "user", teamId: team.id, eventId: team.eventId, userId } : null;
}

/**
 * The ticket token identifies a registration for member and seeker actions.
 * Like cancellation, a registration owned by an account also needs that
 * account signed in for mutations (`requireOwner`, the default); a guest
 * registration is proven by the token alone. Read-only views may pass
 * `requireOwner: false`, matching the ticket page. Never grants team
 * management.
 */
export async function resolveRsvpByTicketToken(
  rawToken: string,
  actorUserId: string | null,
  opts: { requireOwner?: boolean } = {},
): Promise<TicketHolder | null> {
  const parsed = ticketTokenSchema.safeParse(rawToken);
  if (!parsed.success) return null;
  const rsvp = await prisma.rSVP.findUnique({
    where: { checkInToken: parsed.data },
    select: { id: true, eventId: true, userId: true, teamId: true, event: { select: { organisationId: true } } },
  });
  if (!rsvp?.eventId || !rsvp.event) return null;
  if (opts.requireOwner !== false && rsvp.userId && rsvp.userId !== actorUserId) return null;
  return { rsvpId: rsvp.id, eventId: rsvp.eventId, organisationId: rsvp.event.organisationId, userId: rsvp.userId, teamId: rsvp.teamId };
}

/**
 * Organiser access to one event's teams: the same check that guards the
 * individual RSVP lifecycle (`canManageRegistrationsFor`: organisation
 * OWNER/ADMIN or the event's MANAGE_REGISTRATIONS grant), with the event
 * re-read inside the organisation.
 */
export async function resolveOrganiserEvent(
  userId: string,
  organisationSlug: string,
  eventId: string,
): Promise<OrganiserEventContext | null> {
  const org = await prisma.organisation.findUnique({ where: { slug: organisationSlug }, select: { id: true, slug: true } });
  if (!org) return null;
  const event = await prisma.event.findFirst({ where: { id: eventId, organisationId: org.id }, select: { id: true, slug: true } });
  if (!event) return null;
  if (!(await canManageRegistrationsFor({ userId, organisationId: org.id, eventId: event.id }))) return null;
  return { userId, organisationId: org.id, orgSlug: org.slug, eventId: event.id, eventSlug: event.slug };
}

// ---------------------------------------------------------------------------
// Registration (public form)
// ---------------------------------------------------------------------------

/** Register and create a team in one step; the registrant becomes its leader. */
export function createTeamRegistration(
  input: unknown,
  opts: { userId: string | null; teamName: unknown },
): ReturnType<typeof submitRsvpCore> {
  const intent = teamRegistrationIntentSchema.safeParse({ mode: "create", name: opts.teamName });
  if (!intent.success) return Promise.resolve({ ok: false, error: "Enter a valid team name.", fieldErrors: { teamName: intent.error.issues.map((i) => i.message) } });
  return submitRsvpCore(input, { userId: opts.userId, team: intent.data });
}

/** Register into an existing team from its join link. Takes the team's status. */
export function joinTeamByToken(
  input: unknown,
  opts: { userId: string | null; joinToken: unknown },
): ReturnType<typeof submitRsvpCore> {
  const intent = teamRegistrationIntentSchema.safeParse({ mode: "join", joinToken: opts.joinToken });
  if (!intent.success) return Promise.resolve({ ok: false, error: "This team link is no longer valid. Ask your team leader for a new one." });
  return submitRsvpCore(input, { userId: opts.userId, team: intent.data });
}

// ---------------------------------------------------------------------------
// Leader actions
// ---------------------------------------------------------------------------

/**
 * The leader adds a member by name and email. Registration-open checks apply,
 * custom questions are skipped (as with organiser manual add), and the
 * member's own ticket is emailed through the outbox; the ticket token is
 * never returned to the leader.
 */
export async function addTeamMemberByLeader(
  auth: TeamLeaderAuth,
  input: unknown,
): Promise<TeamResult<{ rsvpId: string; status: RsvpStatus }>> {
  const parsed = addTeamMemberSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input.", fieldErrors: flattenZodErrors(parsed.error) };
  const email = parsed.data.email.trim().toLowerCase();
  try {
    return await teamTransaction(async (tx, webhooks): Promise<TeamResult<{ rsvpId: string; status: RsvpStatus }>> => {
      const event = await lockEvent(tx, auth.eventId);
      if (!event) return fail(TEAM_NOT_FOUND);
      if (event.registrationMode !== RegistrationMode.TEAM) return fail(NOT_A_TEAM_EVENT);
      if (!isOpenForRegistration(event)) return fail("Registration is closed for this event.");
      const team = await lockedLeaderTeam(tx, auth);
      if (!team) return fail(TEAM_NOT_FOUND);
      if (team.status === RsvpStatus.REJECTED) return fail("This team can no longer take new members.");
      // Same rule as public guest registration (rsvpCore): an entered address
      // on the invite list proves nothing, so invite-only events never issue a
      // guest ticket here. Invitees sign in with the invited account and use
      // the join link instead.
      if (event.privacyType === EventPrivacyType.INVITE_ONLY) return fail(INVITE_ONLY_ADD_REFUSED);
      const size = await tx.rSVP.count({ where: { teamId: team.id } });
      if (!hasFreeSpace(event, size)) return fail("Your team is already full.");
      const rsvp = await tx.rSVP.create({
        data: {
          eventId: event.id,
          userId: null,
          guestEmail: email,
          guestName: parsed.data.name.trim(),
          attendeeKey: `guest:${email}`,
          status: team.status,
          teamId: team.id,
        },
        select: { id: true, checkInToken: true },
      });
      const leaderName = team.leaderRsvp ? personName(team.leaderRsvp) : undefined;
      await enqueueTeamMemberAdded(tx, {
        to: email,
        checkInToken: rsvp.checkInToken,
        ...(leaderName && leaderName !== "Guest" ? { addedByName: leaderName } : {}),
      });
      webhooks.push({ type: "registration.created", rsvpId: rsvp.id });
      return { ok: true, data: { rsvpId: rsvp.id, status: team.status } };
    });
  } catch (error) {
    if (isUniqueViolation(error)) return fail("This email is already registered for this event.");
    console.error("[teams] add member failed");
    return fail("Could not add this member.");
  }
}

/** Remove a member (not the leader). Cancels their registration. */
export async function removeTeamMember(auth: TeamLeaderAuth, rsvpId: string): Promise<TeamResult> {
  if (!rsvpId || rsvpId.length > 128) return fail("Member not found.");
  return teamTransaction(async (tx, webhooks): Promise<TeamResult> => {
    const event = await lockEvent(tx, auth.eventId);
    if (!event) return fail(TEAM_NOT_FOUND);
    const team = await lockedLeaderTeam(tx, auth);
    if (!team) return fail(TEAM_NOT_FOUND);
    if (team.leaderRsvpId === rsvpId) return fail("You can't remove yourself. Transfer leadership or disband the team instead.");
    const member = await tx.rSVP.findFirst({
      where: { id: rsvpId, eventId: event.id, teamId: team.id },
      select: { ...rsvpWebhookSnapshotSelect, status: true },
    });
    if (!member) return fail("Member not found.");
    if (member.checkedInAt) return fail("This member has already checked in.");
    await tx.rSVP.delete({ where: { id: member.id } });
    // The team side of the registration cancels it, as when the member leaves.
    webhooks.push({ type: "registration.status_changed", rsvpId: member.id, status: "CANCELLED", previousStatus: member.status, snapshot: rsvpWebhookSnapshot(member) });
    const settled = await settleTeamAfterMemberLeft(tx, { teamId: team.id, eventId: event.id, leftRsvpId: member.id });
    if (settled.freedConfirmedUnit) webhooks.push(...((await promoteOldestWaitlistedUnit(tx, event))?.webhooks ?? []));
    return { ok: true };
  });
}

/**
 * A member leaves from their ticket page. Leaving cancels the registration,
 * through the same cancellation core (leadership passes on, an empty team is
 * deleted and its unit freed).
 */
export async function leaveTeam(actorUserId: string | null, ticketToken: string): Promise<TeamResult<{ cancelled: true }>> {
  const holder = await resolveRsvpByTicketToken(ticketToken, actorUserId);
  if (!holder) return fail("Registration not found.");
  if (!holder.teamId) return fail("You're not in a team.");
  return cancelRsvpForUser(actorUserId, { checkInToken: ticketToken });
}

/** Hand leadership to another member. Rotates the management link and emails it to the new leader. */
export async function transferLeadership(auth: TeamLeaderAuth, newLeaderRsvpId: string): Promise<TeamResult> {
  if (!newLeaderRsvpId || newLeaderRsvpId.length > 128) return fail("Member not found.");
  return prisma.$transaction(async (tx): Promise<TeamResult> => {
    const event = await lockEvent(tx, auth.eventId);
    if (!event) return fail(TEAM_NOT_FOUND);
    const team = await lockedLeaderTeam(tx, auth);
    if (!team) return fail(TEAM_NOT_FOUND);
    if (team.status === RsvpStatus.REJECTED) return fail(TEAM_DECLINED);
    if (team.leaderRsvpId === newLeaderRsvpId) return fail("This member already leads the team.");
    const member = await tx.rSVP.findFirst({ where: { id: newLeaderRsvpId, eventId: event.id, teamId: team.id }, select: { id: true } });
    if (!member) return fail("Member not found.");
    await assignTeamLeaderTx(tx, { teamId: team.id, leaderRsvpId: member.id, reason: "leader" });
    return { ok: true };
  });
}

async function renameTeamTx(tx: Prisma.TransactionClient, team: { id: string; eventId: string }, name: string): Promise<TeamResult<{ name: string }>> {
  const nameKey = teamNameKey(name);
  const taken = await tx.team.findFirst({ where: { eventId: team.eventId, nameKey, id: { not: team.id } }, select: { id: true } });
  if (taken) return fail("That team name is already taken for this event.");
  await tx.team.update({ where: { id: team.id }, data: { name, nameKey } });
  return { ok: true, data: { name } };
}

export async function renameTeam(auth: TeamLeaderAuth, input: unknown): Promise<TeamResult<{ name: string }>> {
  const parsed = renameTeamSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input.", fieldErrors: flattenZodErrors(parsed.error) };
  try {
    return await prisma.$transaction(async (tx): Promise<TeamResult<{ name: string }>> => {
      const event = await lockEvent(tx, auth.eventId);
      if (!event) return fail(TEAM_NOT_FOUND);
      const team = await lockedLeaderTeam(tx, auth);
      if (!team) return fail(TEAM_NOT_FOUND);
    if (team.status === RsvpStatus.REJECTED) return fail(TEAM_DECLINED);
      return renameTeamTx(tx, team, parsed.data.name);
    });
  } catch (error) {
    if (isUniqueViolationOn(error, "nameKey")) return fail("That team name is already taken for this event.");
    throw error;
  }
}

/** New join link; the old one stops working immediately. */
export async function regenerateJoinToken(auth: TeamLeaderAuth): Promise<TeamResult<{ joinToken: string; joinPath: string }>> {
  return prisma.$transaction(async (tx): Promise<TeamResult<{ joinToken: string; joinPath: string }>> => {
    const event = await lockEvent(tx, auth.eventId);
    if (!event) return fail(TEAM_NOT_FOUND);
    const team = await lockedLeaderTeam(tx, auth);
    if (!team) return fail(TEAM_NOT_FOUND);
    if (team.status === RsvpStatus.REJECTED) return fail(TEAM_DECLINED);
    const joinToken = generateTeamToken();
    await tx.team.update({ where: { id: team.id }, data: { joinToken } });
    const org = await tx.organisation.findUnique({ where: { id: event.organisationId }, select: { slug: true } });
    return { ok: true, data: { joinToken, joinPath: teamJoinPath(org?.slug ?? "", event.slug, joinToken) } };
  });
}

/**
 * New management link; the old one stops working immediately. The raw token
 * is returned once so the page can move to the new address, and is emailed to
 * the leader (outbox `team-created`, reason `reset`) so the team stays
 * manageable if that tab is lost; only its hash is stored.
 */
export async function regenerateManageToken(auth: TeamLeaderAuth): Promise<TeamResult<{ manageToken: string; managePath: string }>> {
  return prisma.$transaction(async (tx): Promise<TeamResult<{ manageToken: string; managePath: string }>> => {
    const event = await lockEvent(tx, auth.eventId);
    if (!event) return fail(TEAM_NOT_FOUND);
    const team = await lockedLeaderTeam(tx, auth);
    if (!team) return fail(TEAM_NOT_FOUND);
    if (team.status === RsvpStatus.REJECTED) return fail(TEAM_DECLINED);
    const manage = generateTeamManageToken();
    await tx.team.update({ where: { id: team.id }, data: { manageTokenHash: manage.hash } });
    const leader = team.leaderRsvpId
      ? await tx.rSVP.findUnique({ where: { id: team.leaderRsvpId }, select: { guestEmail: true, user: { select: { email: true } } } })
      : null;
    const to = leader?.user?.email?.trim() || leader?.guestEmail;
    if (to) await enqueueTeamCreated(tx, { to, teamId: team.id, manageToken: manage.raw, reason: "reset" });
    return { ok: true, data: { manageToken: manage.raw, managePath: teamManagePath(manage.raw) } };
  });
}

export async function setLookingForMembers(auth: TeamLeaderAuth, looking: boolean): Promise<TeamResult> {
  if (typeof looking !== "boolean") return fail("Invalid input.");
  return prisma.$transaction(async (tx): Promise<TeamResult> => {
    const event = await lockEvent(tx, auth.eventId);
    if (!event) return fail(TEAM_NOT_FOUND);
    const team = await lockedLeaderTeam(tx, auth);
    if (!team) return fail(TEAM_NOT_FOUND);
    if (team.status === RsvpStatus.REJECTED) return fail(TEAM_DECLINED);
    await tx.team.update({ where: { id: team.id }, data: { lookingForMembers: looking } });
    return { ok: true };
  });
}

/** Disband: cancels every member registration, deletes the team, frees its unit. */
export async function disbandTeam(auth: TeamLeaderAuth): Promise<TeamResult<{ cancelled: number }>> {
  return teamTransaction(async (tx, webhooks): Promise<TeamResult<{ cancelled: number }>> => {
    const event = await lockEvent(tx, auth.eventId);
    if (!event) return fail(TEAM_NOT_FOUND);
    const team = await lockedLeaderTeam(tx, auth);
    if (!team) return fail(TEAM_NOT_FOUND);
    const checkedIn = await tx.rSVP.count({ where: { teamId: team.id, checkedInAt: { not: null } } });
    if (checkedIn > 0) return fail("Someone in this team has already checked in, so it can't be disbanded.");
    const members = await tx.rSVP.findMany({
      where: { teamId: team.id, eventId: event.id },
      select: { ...rsvpWebhookSnapshotSelect, status: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    // Same set as `members`: every member change takes the Event lock held here.
    const removed = await tx.rSVP.deleteMany({ where: { teamId: team.id, eventId: event.id } });
    await tx.team.delete({ where: { id: team.id } });
    for (const member of members) {
      webhooks.push({ type: "registration.status_changed", rsvpId: member.id, status: "CANCELLED", previousStatus: member.status, snapshot: rsvpWebhookSnapshot(member) });
    }
    if (team.status === RsvpStatus.CONFIRMED) webhooks.push(...((await promoteOldestWaitlistedUnit(tx, event))?.webhooks ?? []));
    return { ok: true, data: { cancelled: removed.count } };
  });
}

// ---------------------------------------------------------------------------
// Looking for a team (SOLO_WITH_MATCHING)
// ---------------------------------------------------------------------------

function isMatchingEvent(event: Pick<LockedEvent, "registrationMode" | "soloPolicy">) {
  return event.registrationMode === RegistrationMode.TEAM && event.soloPolicy === SoloPolicy.SOLO_WITH_MATCHING;
}

/** Create or edit (or hide, with `visible: false`) the holder's seeker profile. */
export async function upsertSeekerProfile(holder: TicketHolder, input: unknown): Promise<TeamResult> {
  const parsed = upsertSeekerProfileSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input.", fieldErrors: flattenZodErrors(parsed.error) };
  return prisma.$transaction(async (tx): Promise<TeamResult> => {
    const event = await lockEvent(tx, holder.eventId);
    if (!event || !isMatchingEvent(event)) return fail("This event doesn't have a Looking for a team list.");
    const rsvp = await tx.rSVP.findFirst({ where: { id: holder.rsvpId, eventId: event.id, isCrew: false }, select: { id: true, teamId: true, status: true } });
    if (!rsvp) return fail("Registration not found.");
    if (rsvp.teamId) return fail("You're already in a team.");
    if (rsvp.status === RsvpStatus.REJECTED) return fail("This registration was declined.");
    const data = { headline: parsed.data.headline, skills: parsed.data.skills, visible: parsed.data.visible };
    await tx.teamSeekerProfile.upsert({ where: { rsvpId: rsvp.id }, create: { rsvpId: rsvp.id, ...data }, update: data });
    return { ok: true };
  });
}

/**
 * INVITE: a leader invites a visible seeker (by seeker profile id).
 * REQUEST: a seeker asks to join a team that is looking for members.
 * At most one pending row per team and registration (partial unique index).
 */
export async function createJoinRequest(
  params:
    | { direction: "INVITE"; leader: TeamLeaderAuth; seekerProfileId: string }
    | { direction: "REQUEST"; seeker: TicketHolder; teamId: string },
): Promise<TeamResult<{ requestId: string }>> {
  const eventId = params.direction === "INVITE" ? params.leader.eventId : params.seeker.eventId;
  try {
    return await prisma.$transaction(async (tx): Promise<TeamResult<{ requestId: string }>> => {
      const event = await lockEvent(tx, eventId);
      if (!event || !isMatchingEvent(event)) return fail("This event doesn't have a Looking for a team list.");
      let teamId: string;
      let rsvpId: string;
      if (params.direction === "INVITE") {
        const team = await lockedLeaderTeam(tx, params.leader);
        if (!team) return fail(TEAM_NOT_FOUND);
        if (team.status === RsvpStatus.REJECTED) return fail("This team can no longer take new members.");
        const profile = await tx.teamSeekerProfile.findFirst({
          where: { id: params.seekerProfileId, visible: true, rsvp: { eventId: event.id, teamId: null, status: { not: RsvpStatus.REJECTED } } },
          select: { rsvpId: true },
        });
        if (!profile) return fail("This person is no longer looking for a team.");
        teamId = team.id;
        rsvpId = profile.rsvpId;
      } else {
        const rsvp = await tx.rSVP.findFirst({
          where: { id: params.seeker.rsvpId, eventId: event.id, isCrew: false },
          select: { id: true, teamId: true, status: true, seekerProfile: { select: { visible: true } } },
        });
        if (!rsvp) return fail("Registration not found.");
        if (rsvp.teamId) return fail("You're already in a team.");
        if (rsvp.status === RsvpStatus.REJECTED) return fail("This registration was declined.");
        if (!rsvp.seekerProfile?.visible) return fail("List yourself as looking for a team first.");
        const team = await tx.team.findFirst({
          where: { id: params.teamId, eventId: event.id },
          select: { id: true, status: true, lookingForMembers: true },
        });
        if (!team || !team.lookingForMembers || team.status === RsvpStatus.REJECTED) return fail("This team isn't looking for members.");
        teamId = team.id;
        rsvpId = rsvp.id;
      }
      const size = await tx.rSVP.count({ where: { teamId } });
      if (!hasFreeSpace(event, size)) return fail("This team is already full.");
      const request = await tx.teamJoinRequest.create({
        data: { teamId, rsvpId, direction: params.direction === "INVITE" ? TeamJoinRequestDirection.INVITE : TeamJoinRequestDirection.REQUEST },
        select: { id: true },
      });
      return { ok: true, data: { requestId: request.id } };
    });
  } catch (error) {
    if (isUniqueViolation(error)) return fail("There is already a pending invitation or request between you.");
    console.error("[teams] join request failed");
    return fail("Could not send this request.");
  }
}

/** Load a pending request in the actor's event and check the actor's side. */
async function lockedRequestForActor(
  tx: Prisma.TransactionClient,
  requestId: string,
  eventId: string,
  actor: JoinRequestActor,
  side: "responder" | "creator",
) {
  const request = await tx.teamJoinRequest.findFirst({
    where: { id: requestId, status: TeamJoinRequestStatus.PENDING, team: { eventId }, rsvp: { eventId } },
    select: { id: true, teamId: true, rsvpId: true, direction: true },
  });
  if (!request) return null;
  // INVITE is created by the leader and answered by the seeker; REQUEST the reverse.
  const leaderSide = (request.direction === TeamJoinRequestDirection.INVITE) === (side === "creator");
  if (leaderSide) {
    if (actor.kind !== "leader" || actor.auth.teamId !== request.teamId) return null;
    if (!(await lockedLeaderTeam(tx, actor.auth))) return null;
  } else if (actor.kind !== "seeker" || actor.holder.rsvpId !== request.rsvpId) {
    return null;
  }
  return request;
}

/**
 * Accept or decline a pending invitation/request from the other side.
 * Accepting moves the seeker's RSVP into the team under the event lock: size
 * is rechecked, the RSVP takes the team status, the profile is hidden, other
 * pending requests for that RSVP are cancelled, and a freed solo unit
 * promotes the oldest waitlisted unit.
 */
export async function respondToJoinRequest(params: {
  actor: JoinRequestActor;
  requestId: string;
  accept: boolean;
}): Promise<TeamResult<{ accepted: boolean }>> {
  const eventId = params.actor.kind === "leader" ? params.actor.auth.eventId : params.actor.holder.eventId;
  if (!params.requestId || params.requestId.length > 128) return fail("This request is no longer pending.");
  return teamTransaction(async (tx, webhooks): Promise<TeamResult<{ accepted: boolean }>> => {
    const event = await lockEvent(tx, eventId);
    if (!event) return fail("This request is no longer pending.");
    const request = await lockedRequestForActor(tx, params.requestId, event.id, params.actor, "responder");
    if (!request) return fail("This request is no longer pending.");
    if (!params.accept) {
      await tx.teamJoinRequest.updateMany({ where: { id: request.id, status: TeamJoinRequestStatus.PENDING }, data: { status: TeamJoinRequestStatus.DECLINED } });
      return { ok: true, data: { accepted: false } };
    }
    if (event.registrationMode !== RegistrationMode.TEAM) return fail(NOT_A_TEAM_EVENT);
    const team = await tx.team.findFirst({ where: { id: request.teamId, eventId: event.id }, select: { id: true, name: true, status: true } });
    if (!team || team.status === RsvpStatus.REJECTED) return fail("This team can no longer take new members.");
    const rsvp = await tx.rSVP.findFirst({ where: { id: request.rsvpId, eventId: event.id, isCrew: false }, select: soloRsvpSelect });
    if (!rsvp || rsvp.teamId) return fail("This person is already in a team.");
    if (rsvp.status === RsvpStatus.REJECTED) return fail("This registration was declined.");
    const moved = await moveSoloRsvpIntoTeamTx(tx, event, rsvp, team, webhooks, { acceptedRequestId: request.id });
    if (!moved.ok) return moved;
    await tx.teamJoinRequest.update({ where: { id: request.id }, data: { status: TeamJoinRequestStatus.ACCEPTED } });
    return { ok: true, data: { accepted: true } };
  });
}

const soloRsvpSelect = {
  id: true,
  teamId: true,
  status: true,
  checkedInAt: true,
  checkInToken: true,
  guestEmail: true,
  user: { select: { email: true } },
} satisfies Prisma.RSVPSelect;

type SoloRsvpRow = Prisma.RSVPGetPayload<{ select: typeof soloRsvpSelect }>;

/**
 * Inside a transaction that holds the Event lock: move a solo registration
 * into a team of the same event (docs/TEAMS.md). The team size is rechecked,
 * the registration takes the team's status, its seeker profile is hidden, its
 * other pending invitations and requests are cancelled, and when its solo
 * unit was confirmed the freed unit promotes the oldest waitlisted unit. A
 * checked-in person can only join a confirmed team: otherwise their unit
 * would go to the waitlist while they are already inside. The solo project,
 * if any, is handled by `retireSoloSubmissionForTeamTx` (docs/HACKATHON.md)
 * after every other check, so a refused move never touches it. Status
 * webhooks (the moved registration's, and any promotion's) go into `webhooks`
 * and are emitted by `teamTransaction` after commit.
 */
async function moveSoloRsvpIntoTeamTx(
  tx: Prisma.TransactionClient,
  event: LockedEvent,
  rsvp: SoloRsvpRow,
  team: { id: string; name: string; status: RsvpStatus },
  webhooks: WebhookEmission[],
  opts: { acceptedRequestId?: string; by?: "entrant" | "organiser" } = {},
): Promise<TeamResult<{ status: RsvpStatus }>> {
  if (rsvp.teamId) return fail("This registration is already in a team.");
  if (team.status === RsvpStatus.REJECTED) return fail("This team can no longer take new members.");
  if (rsvp.checkedInAt && team.status !== RsvpStatus.CONFIRMED) {
    return fail("This registration has already checked in, so it can only join a team that has a place.");
  }
  const size = await tx.rSVP.count({ where: { teamId: team.id } });
  if (!hasFreeSpace(event, size)) return fail("This team is already full.");
  // An entrant is a team or a single RSVP: the solo project can't come along.
  const retired = await retireSoloSubmissionForTeamTx(tx, { rsvpId: rsvp.id, eventId: event.id, by: opts.by ?? "entrant" });
  if (!retired.ok) return fail(retired.error);
  const moved = await tx.rSVP.updateMany({
    where: { id: rsvp.id, eventId: event.id, teamId: null, status: rsvp.status },
    data: { teamId: team.id, status: team.status },
  });
  if (moved.count !== 1) return fail("This registration was changed. Try again.");
  if (rsvp.status !== team.status) {
    webhooks.push({ type: "registration.status_changed", rsvpId: rsvp.id, status: team.status, previousStatus: rsvp.status });
  }
  await tx.teamJoinRequest.updateMany({
    where: {
      rsvpId: rsvp.id,
      status: TeamJoinRequestStatus.PENDING,
      ...(opts.acceptedRequestId ? { id: { not: opts.acceptedRequestId } } : {}),
    },
    data: { status: TeamJoinRequestStatus.CANCELLED },
  });
  await tx.teamSeekerProfile.updateMany({ where: { rsvpId: rsvp.id }, data: { visible: false } });
  if (rsvp.status !== RsvpStatus.CONFIRMED && team.status === RsvpStatus.CONFIRMED) {
    const to = personEmail(rsvp);
    if (to) await enqueueRsvpStatusNotification(tx, { to, eventTitle: event.title, approved: true, checkInToken: rsvp.checkInToken, teamName: team.name });
  }
  // The solo unit is gone; if it was confirmed, a unit is free.
  if (rsvp.status === RsvpStatus.CONFIRMED) webhooks.push(...((await promoteOldestWaitlistedUnit(tx, event))?.webhooks ?? []));
  return { ok: true, data: { status: team.status } };
}

export const JOIN_LINK_INVALID = "This team link is no longer valid. Ask your team leader for a new one.";

/**
 * A solo registrant joins a team with its join link, keeping their existing
 * registration (no second ticket). The holder comes from the ticket token, or
 * from the signed-in owner's own registration on the join page. The team is
 * looked up by its join token inside the holder's event only, so a link for
 * another event never matches. Everything else is `moveSoloRsvpIntoTeamTx`
 * under the Event lock.
 */
export async function joinTeamWithExistingRsvp(
  holder: TicketHolder,
  joinLink: unknown,
): Promise<TeamResult<{ status: RsvpStatus; teamName: string }>> {
  const joinToken = joinTokenFromInput(joinLink);
  if (!joinToken) return fail("Paste the full team link your team leader shared.");
  return teamTransaction(async (tx, webhooks): Promise<TeamResult<{ status: RsvpStatus; teamName: string }>> => {
    const event = await lockEvent(tx, holder.eventId);
    if (!event || event.organisationId !== holder.organisationId) return fail("Registration not found.");
    if (event.registrationMode !== RegistrationMode.TEAM) return fail(NOT_A_TEAM_EVENT);
    // Same gate as the join page: a withdrawn page or a draft event never
    // resolves a join link, so it can't be used to probe team names.
    if (event.status !== EventStatus.PUBLISHED || event.page?.isPublished !== true || event.endDateTime <= new Date()) {
      return fail("This event is no longer taking team changes.");
    }
    const team = await tx.team.findFirst({ where: { joinToken, eventId: event.id }, select: { id: true, name: true, status: true } });
    if (!team || team.status === RsvpStatus.REJECTED) return fail(JOIN_LINK_INVALID);
    const rsvp = await tx.rSVP.findFirst({ where: { id: holder.rsvpId, eventId: event.id, isCrew: false }, select: soloRsvpSelect });
    if (!rsvp) return fail("Registration not found.");
    if (rsvp.teamId === team.id) return fail("You're already in this team.");
    if (rsvp.teamId) return fail("You're already in a team. Leave it from your ticket page before joining another.");
    if (rsvp.status === RsvpStatus.REJECTED) return fail("This registration was declined.");
    const moved = await moveSoloRsvpIntoTeamTx(tx, event, rsvp, team, webhooks);
    return moved.ok ? { ok: true, data: { status: team.status, teamName: team.name } } : moved;
  });
}

/** The side that sent a pending invitation/request withdraws it. */
export async function cancelJoinRequest(params: { actor: JoinRequestActor; requestId: string }): Promise<TeamResult> {
  const eventId = params.actor.kind === "leader" ? params.actor.auth.eventId : params.actor.holder.eventId;
  if (!params.requestId || params.requestId.length > 128) return fail("This request is no longer pending.");
  return prisma.$transaction(async (tx): Promise<TeamResult> => {
    const event = await lockEvent(tx, eventId);
    if (!event) return fail("This request is no longer pending.");
    const request = await lockedRequestForActor(tx, params.requestId, event.id, params.actor, "creator");
    if (!request) return fail("This request is no longer pending.");
    await tx.teamJoinRequest.updateMany({ where: { id: request.id, status: TeamJoinRequestStatus.PENDING }, data: { status: TeamJoinRequestStatus.CANCELLED } });
    return { ok: true };
  });
}

// ---------------------------------------------------------------------------
// Organiser actions (whole teams)
// ---------------------------------------------------------------------------

export type TeamTransition = "approve" | "reject" | "promote";

/**
 * Approve, reject, or promote a whole team as one unit. Approval needs the
 * event to be open and the team to reach `teamMinSize`; approval and
 * promotion need a free unit. All member RSVPs change in the same
 * transaction and each member gets the usual status email naming the team.
 */
export async function transitionTeamStatus(
  ctx: OrganiserEventContext,
  teamId: string,
  action: TeamTransition,
): Promise<TeamResult<{ status: RsvpStatus }>> {
  if (!teamId || teamId.length > 128) return fail(TEAM_NOT_FOUND);
  return teamTransaction(async (tx, webhooks): Promise<TeamResult<{ status: RsvpStatus }>> => {
    const event = await lockEvent(tx, ctx.eventId);
    if (!event || event.organisationId !== ctx.organisationId) return fail("Event not found.");
    const team = await tx.team.findFirst({ where: { id: teamId, eventId: event.id }, select: { id: true, status: true } });
    if (!team) return fail(TEAM_NOT_FOUND);
    const changed = fail("This team was changed by another organiser.");
    if (action === "reject") {
      if (team.status !== RsvpStatus.PENDING_APPROVAL && team.status !== RsvpStatus.WAITLISTED) return fail("This team cannot be rejected.");
      const rejected = await setTeamStatusTx(tx, { teamId: team.id, eventId: event.id, eventTitle: event.title, from: [team.status], to: RsvpStatus.REJECTED });
      if (!rejected) return changed;
      webhooks.push(...rejected);
      return { ok: true, data: { status: RsvpStatus.REJECTED } };
    }
    if (action === "approve") {
      if (team.status !== RsvpStatus.PENDING_APPROVAL) return fail("Only pending teams can be approved.");
      if (event.status !== EventStatus.PUBLISHED || event.endDateTime <= new Date()) return fail("This event is no longer open for approvals.");
      const size = await tx.rSVP.count({ where: { teamId: team.id } });
      if (event.teamMinSize != null && size < event.teamMinSize) {
        return fail(`This team is incomplete (${size} of at least ${event.teamMinSize} members), so it can't be approved yet.`, "TEAM_INCOMPLETE");
      }
    } else if (team.status !== RsvpStatus.WAITLISTED) {
      return fail("Only waitlisted teams can be promoted.");
    }
    if (event.capacity != null && (await countConfirmedUnits(tx, event.id)) >= event.capacity) {
      return fail(action === "approve" ? "Event is at capacity. Free a spot or promote from waitlist first." : "Event is still at capacity.", "CAPACITY_FULL");
    }
    const confirmed = await setTeamStatusTx(tx, { teamId: team.id, eventId: event.id, eventTitle: event.title, from: [team.status], to: RsvpStatus.CONFIRMED });
    if (!confirmed) return changed;
    webhooks.push(...confirmed);
    return { ok: true, data: { status: RsvpStatus.CONFIRMED } };
  });
}

const moveMemberSchema = z.object({ rsvpId: z.string().trim().min(1).max(128), targetTeamId: z.string().trim().min(1).max(128) }).strict();

/** Move a registration (solo or from another team) into a team of the same event. */
export async function organiserMoveMember(
  ctx: OrganiserEventContext,
  input: unknown,
): Promise<TeamResult<{ status: RsvpStatus }>> {
  const parsed = moveMemberSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid input.");
  return teamTransaction(async (tx, webhooks): Promise<TeamResult<{ status: RsvpStatus }>> => {
    const event = await lockEvent(tx, ctx.eventId);
    if (!event || event.organisationId !== ctx.organisationId) return fail("Event not found.");
    if (event.registrationMode !== RegistrationMode.TEAM) return fail(NOT_A_TEAM_EVENT);
    const rsvp = await tx.rSVP.findFirst({
      // Crew tickets (docs/CREW.md) never join a team.
      where: { id: parsed.data.rsvpId, eventId: event.id, isCrew: false },
      select: { id: true, teamId: true, status: true, checkedInAt: true, checkInToken: true, guestEmail: true, user: { select: { email: true } } },
    });
    if (!rsvp) return fail("RSVP not found.");
    const target = await tx.team.findFirst({ where: { id: parsed.data.targetTeamId, eventId: event.id }, select: { id: true, name: true, status: true } });
    if (!target) return fail(TEAM_NOT_FOUND);
    if (rsvp.teamId === target.id) return fail("This person is already in that team.");
    if (target.status === RsvpStatus.REJECTED) return fail("A rejected team can't take new members.");
    // A checked-in person is at the event: moving them into a team without a
    // place would release their unit to the waitlist while they stay inside.
    if (rsvp.checkedInAt && target.status !== RsvpStatus.CONFIRMED) {
      return fail("This person has already checked in, so they can only move to a confirmed team.");
    }
    const size = await tx.rSVP.count({ where: { teamId: target.id } });
    if (!hasFreeSpace(event, size)) return fail("That team is already full.");
    // A solo registration's own project can't come into the team (a team
    // member's project stays with the team they leave).
    if (!rsvp.teamId) {
      const retired = await retireSoloSubmissionForTeamTx(tx, { rsvpId: rsvp.id, eventId: event.id, by: "organiser" });
      if (!retired.ok) return fail(retired.error);
    }
    const moved = await tx.rSVP.updateMany({
      where: { id: rsvp.id, eventId: event.id, teamId: rsvp.teamId, status: rsvp.status },
      data: { teamId: target.id, status: target.status },
    });
    if (moved.count !== 1) return fail("This registration was changed by another organiser.");
    if (rsvp.status !== target.status) {
      webhooks.push({ type: "registration.status_changed", rsvpId: rsvp.id, status: target.status, previousStatus: rsvp.status });
    }
    await tx.teamJoinRequest.updateMany({ where: { rsvpId: rsvp.id, status: TeamJoinRequestStatus.PENDING }, data: { status: TeamJoinRequestStatus.CANCELLED } });
    await tx.teamSeekerProfile.updateMany({ where: { rsvpId: rsvp.id }, data: { visible: false } });
    let freedUnit = !rsvp.teamId && rsvp.status === RsvpStatus.CONFIRMED;
    if (rsvp.teamId) {
      const settled = await settleTeamAfterMemberLeft(tx, { teamId: rsvp.teamId, eventId: event.id, leftRsvpId: rsvp.id });
      freedUnit = settled.freedConfirmedUnit;
    }
    if (rsvp.status !== RsvpStatus.CONFIRMED && target.status === RsvpStatus.CONFIRMED) {
      const to = personEmail(rsvp);
      if (to) await enqueueRsvpStatusNotification(tx, { to, eventTitle: event.title, approved: true, checkInToken: rsvp.checkInToken, teamName: target.name });
    }
    if (freedUnit) webhooks.push(...((await promoteOldestWaitlistedUnit(tx, event))?.webhooks ?? []));
    return { ok: true, data: { status: target.status } };
  });
}

export async function organiserRenameTeam(ctx: OrganiserEventContext, teamId: string, name: unknown): Promise<TeamResult<{ name: string }>> {
  const parsed = teamNameSchema.safeParse(name);
  if (!parsed.success) return { ok: false, error: "Enter a valid team name.", fieldErrors: { name: parsed.error.issues.map((i) => i.message) } };
  if (!teamId || teamId.length > 128) return fail(TEAM_NOT_FOUND);
  try {
    return await prisma.$transaction(async (tx): Promise<TeamResult<{ name: string }>> => {
      const event = await lockEvent(tx, ctx.eventId);
      if (!event || event.organisationId !== ctx.organisationId) return fail("Event not found.");
      const team = await tx.team.findFirst({ where: { id: teamId, eventId: event.id }, select: { id: true, eventId: true } });
      if (!team) return fail(TEAM_NOT_FOUND);
      return renameTeamTx(tx, team, parsed.data);
    });
  } catch (error) {
    if (isUniqueViolationOn(error, "nameKey")) return fail("That team name is already taken for this event.");
    throw error;
  }
}

const UNDO_TTL_MS = 5 * 60_000;

const teamSnapshotRsvpSchema = z.object({
  id: z.string().min(1).max(128),
  userId: z.string().min(1).nullable(),
  guestEmail: z.string().email().nullable(),
  guestName: z.string().max(200).nullable(),
  attendeeKey: z.string().min(1).max(512),
  checkInToken: z.string().min(8).max(256),
  checkedInAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  answers: z.array(z.object({
    fieldId: z.string().min(1),
    valueText: z.string().nullable(),
    valueBool: z.boolean().nullable(),
    valueNumber: z.number().finite().nullable(),
    valueDate: z.string().datetime().nullable(),
  })).max(200),
  /** Custom check-in list records (same shape as the single-RSVP undo); optional for older snapshots. */
  listCheckIns: z.array(z.object({
    listId: z.string().min(1).max(128),
    checkedInAt: z.string().datetime(),
    source: z.enum(CHECK_IN_LIST_SOURCES),
  })).max(MAX_CHECK_IN_LISTS).optional(),
});

const teamDeletionSnapshotSchema = z.object({
  kind: z.literal("team"),
  eventId: z.string().min(1).max(128),
  team: z.object({
    id: z.string().min(1).max(128),
    name: z.string().min(1).max(200),
    nameKey: z.string().min(1).max(200),
    status: z.nativeEnum(RsvpStatus),
    joinToken: teamTokenSchema,
    manageTokenHash: z.string().regex(/^[a-f0-9]{64}$/),
    leaderRsvpId: z.string().min(1).max(128).nullable(),
    lookingForMembers: z.boolean(),
    createdAt: z.string().datetime(),
  }),
  rsvps: z.array(teamSnapshotRsvpSchema).min(1).max(200),
  /** The team's project and its judging record, recreated on undo. Absent in older snapshots. */
  submission: submissionSnapshotSchema.nullable().optional(),
});

/** True when an undo row holds a whole-team deletion (see `organiserDeleteTeam`). */
export function isTeamDeletionSnapshot(payload: unknown): boolean {
  return typeof payload === "object" && payload !== null && (payload as { kind?: unknown }).kind === "team";
}

const teamSnapshotInclude = {
  members: {
    include: { answers: true, checkInListRecords: { select: { listId: true, checkedInAt: true, source: true } } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  },
} satisfies Prisma.TeamInclude;

type TeamWithSnapshotMembers = Prisma.TeamGetPayload<{ include: typeof teamSnapshotInclude }>;

/**
 * The whole-team undo payload restored by `restoreTeamDeletionSnapshot`,
 * including the team's project with its scores, reviews, assignments, and
 * award places, which the deletion cascades away.
 */
async function teamDeletionSnapshot(tx: Prisma.TransactionClient, team: TeamWithSnapshotMembers, eventId: string) {
  const submission = await captureSubmissionSnapshotTx(tx, { eventId, teamId: team.id });
  return {
    kind: "team" as const,
    eventId,
    team: {
      id: team.id,
      name: team.name,
      nameKey: team.nameKey,
      status: team.status,
      joinToken: team.joinToken,
      manageTokenHash: team.manageTokenHash,
      leaderRsvpId: team.leaderRsvpId,
      lookingForMembers: team.lookingForMembers,
      createdAt: team.createdAt.toISOString(),
    },
    rsvps: team.members.map((rsvp) => ({
      id: rsvp.id,
      userId: rsvp.userId,
      guestEmail: rsvp.guestEmail,
      guestName: rsvp.guestName,
      attendeeKey: rsvp.attendeeKey,
      checkInToken: rsvp.checkInToken,
      checkedInAt: rsvp.checkedInAt?.toISOString() ?? null,
      createdAt: rsvp.createdAt.toISOString(),
      answers: rsvp.answers.map((answer) => ({
        fieldId: answer.fieldId,
        valueText: answer.valueText,
        valueBool: answer.valueBool,
        valueNumber: answer.valueNumber,
        valueDate: answer.valueDate?.toISOString() ?? null,
      })),
      listCheckIns: rsvp.checkInListRecords.map((record) => ({
        listId: record.listId,
        checkedInAt: record.checkedInAt.toISOString(),
        source: record.source,
      })),
    })),
    submission,
  };
}

/**
 * Inside a transaction that already holds the Event lock: when `rsvpId` is the
 * only member of its team, the whole-team undo payload, so deleting that one
 * registration (which also deletes the emptied team) can be undone by
 * recreating the team. Null when the team has other members.
 */
export async function soleMemberTeamSnapshotTx(
  tx: Prisma.TransactionClient,
  params: { teamId: string; eventId: string; rsvpId: string },
) {
  const team = await tx.team.findFirst({ where: { id: params.teamId, eventId: params.eventId }, include: teamSnapshotInclude });
  if (!team || team.members.length !== 1 || team.members[0]!.id !== params.rsvpId) return null;
  return teamDeletionSnapshot(tx, team, params.eventId);
}

/**
 * Delete a whole team and its member registrations, keeping a short-lived,
 * server-created undo snapshot (the existing RsvpDeletionUndo pattern). A
 * confirmed team frees its unit and promotes the oldest waitlisted unit.
 */
export async function organiserDeleteTeam(ctx: OrganiserEventContext, teamId: string): Promise<TeamResult<{ undoId: string; removed: number }>> {
  if (!teamId || teamId.length > 128) return fail(TEAM_NOT_FOUND);
  return teamTransaction(async (tx, webhooks): Promise<TeamResult<{ undoId: string; removed: number }>> => {
    const event = await lockEvent(tx, ctx.eventId);
    if (!event || event.organisationId !== ctx.organisationId) return fail("Event not found.");
    const team = await tx.team.findFirst({
      where: { id: teamId, eventId: event.id },
      include: teamSnapshotInclude,
    });
    if (!team) return fail(TEAM_NOT_FOUND);
    const snapshot = await teamDeletionSnapshot(tx, team, event.id);
    await tx.rsvpDeletionUndo.deleteMany({ where: { expiresAt: { lte: new Date() } } });
    // An empty team (should not exist) is deleted without an undo snapshot.
    const undo = snapshot.rsvps.length > 0
      ? await tx.rsvpDeletionUndo.create({
        data: {
          organisationId: ctx.organisationId,
          deletedByUserId: ctx.userId,
          payload: snapshot as Prisma.InputJsonValue,
          expiresAt: new Date(Date.now() + UNDO_TTL_MS),
        },
        select: { id: true },
      })
      : null;
    const removed = await tx.rSVP.deleteMany({ where: { teamId: team.id, eventId: event.id } });
    await tx.team.delete({ where: { id: team.id } });
    for (const member of team.members) {
      webhooks.push({ type: "registration.status_changed", rsvpId: member.id, status: "REMOVED", previousStatus: member.status, snapshot: rsvpWebhookSnapshot(member) });
    }
    if (team.status === RsvpStatus.CONFIRMED) webhooks.push(...((await promoteOldestWaitlistedUnit(tx, event))?.webhooks ?? []));
    return { ok: true, data: { undoId: undo?.id ?? "", removed: removed.count } };
  });
}

/**
 * Restore a team deleted by `organiserDeleteTeam`. Called by
 * `restoreRsvpForUser` after it has matched the undo row to the organiser and
 * organisation. The name must still be free and, for a confirmed team, a unit
 * must still be free.
 */
export async function restoreTeamDeletionSnapshot(
  undo: { id: string; payload: unknown },
  organisationId: string,
): Promise<TeamResult<{ eventId: string; eventSlug: string; teamId: string }>> {
  const snapshot = teamDeletionSnapshotSchema.safeParse(undo.payload);
  if (!snapshot.success) return fail("Could not restore this team safely.");
  const data = snapshot.data;
  try {
    return await teamTransaction(async (tx, webhooks): Promise<TeamResult<{ eventId: string; eventSlug: string; teamId: string }>> => {
      const event = await lockEvent(tx, data.eventId);
      if (!event || event.organisationId !== organisationId) return fail("The original event no longer exists.");
      if (event.registrationMode !== RegistrationMode.TEAM) return fail("This event no longer uses team registration.");
      const taken = await tx.team.findUnique({ where: { eventId_nameKey: { eventId: event.id, nameKey: data.team.nameKey } }, select: { id: true } });
      if (taken) return fail("Another team now uses this name, so it can't be restored.");
      if (event.teamMaxSize == null || data.rsvps.length > event.teamMaxSize) return fail("This team is now larger than the maximum team size.");
      if (data.team.status === RsvpStatus.CONFIRMED && event.capacity != null && (await countConfirmedUnits(tx, event.id)) >= event.capacity) {
        return fail("This team cannot be restored because the event is now at capacity.");
      }
      await tx.team.create({
        data: {
          id: data.team.id,
          eventId: event.id,
          name: data.team.name,
          nameKey: data.team.nameKey,
          status: data.team.status,
          joinToken: data.team.joinToken,
          manageTokenHash: data.team.manageTokenHash,
          lookingForMembers: data.team.lookingForMembers,
          createdAt: new Date(data.team.createdAt),
        },
      });
      for (const rsvp of data.rsvps) {
        await tx.rSVP.create({
          data: {
            id: rsvp.id,
            eventId: event.id,
            userId: rsvp.userId,
            guestEmail: rsvp.guestEmail,
            guestName: rsvp.guestName,
            status: data.team.status,
            attendeeKey: rsvp.attendeeKey,
            checkInToken: rsvp.checkInToken,
            checkedInAt: rsvp.checkedInAt ? new Date(rsvp.checkedInAt) : null,
            createdAt: new Date(rsvp.createdAt),
            teamId: data.team.id,
            answers: { create: rsvp.answers.map((answer) => ({
              fieldId: answer.fieldId,
              valueText: answer.valueText,
              valueBool: answer.valueBool,
              valueNumber: answer.valueNumber,
              valueDate: answer.valueDate ? new Date(answer.valueDate) : null,
            })) },
          },
        });
        webhooks.push({ type: "registration.status_changed", rsvpId: rsvp.id, status: data.team.status, previousStatus: "REMOVED" });
      }
      // Custom check-in list records, exactly as the single-RSVP undo restores
      // them: only lists that still belong to this event; history is not rewritten.
      const listCheckIns = data.rsvps.flatMap((rsvp) => (rsvp.listCheckIns ?? []).map((entry) => ({ ...entry, rsvpId: rsvp.id })));
      if (listCheckIns.length > 0) {
        const lists = await tx.checkInList.findMany({ where: { eventId: event.id, id: { in: [...new Set(listCheckIns.map((entry) => entry.listId))] } }, select: { id: true } });
        const live = new Set(lists.map((list) => list.id));
        await tx.checkInListRecord.createMany({
          data: listCheckIns.filter((entry) => live.has(entry.listId)).map((entry) => ({
            listId: entry.listId,
            rsvpId: entry.rsvpId,
            source: entry.source,
            checkedInAt: new Date(entry.checkedInAt),
          })),
          skipDuplicates: true,
        });
      }
      const leaderRsvpId = data.team.leaderRsvpId && data.rsvps.some((rsvp) => rsvp.id === data.team.leaderRsvpId)
        ? data.team.leaderRsvpId
        : data.rsvps[0]!.id;
      await tx.team.update({ where: { id: data.team.id }, data: { leaderRsvpId } });
      if (data.submission) await restoreSubmissionSnapshotTx(tx, data.submission, { eventId: event.id, teamId: data.team.id });
      await tx.rsvpDeletionUndo.delete({ where: { id: undo.id } });
      return { ok: true, data: { eventId: event.id, eventSlug: event.slug, teamId: data.team.id } };
    });
  } catch (error) {
    if (isUniqueViolation(error)) return fail("This team can no longer be restored because a conflicting registration exists.");
    console.error("[teams] restore failed");
    return fail("Could not restore the team.");
  }
}

// ---------------------------------------------------------------------------
// Read models (deliberately minimal DTOs)
// ---------------------------------------------------------------------------

/** Join page: never member names, emails, or tokens. */
export type JoinPageTeamDto = { name: string; size: number; maxSize: number | null };

export function joinPageTeamDto(team: { name: string; size: number }, maxSize: number | null): JoinPageTeamDto {
  return { name: team.name, size: team.size, maxSize };
}

/**
 * The team behind a join link, for an event the caller has already shown
 * under the event page's visibility and invite rules. Rejected teams and
 * other events' tokens return null.
 */
export async function loadJoinPageTeam(eventId: string, joinToken: string): Promise<JoinPageTeamDto | null> {
  if (!isTeamTokenShape(joinToken)) return null;
  const team = await prisma.team.findFirst({
    where: { joinToken, eventId, status: { not: RsvpStatus.REJECTED }, event: { registrationMode: RegistrationMode.TEAM } },
    select: { name: true, _count: { select: { members: true } }, event: { select: { teamMaxSize: true } } },
  });
  return team ? joinPageTeamDto({ name: team.name, size: team._count.members }, team.event.teamMaxSize) : null;
}

/** First name plus last initial ("Ada L."), never an email. */
export function seekerDisplayName(fullName: string | null | undefined): string {
  const parts = (fullName ?? "").replace(/[\u0000-\u001F\u007F<>]+/g, " ").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "Someone";
  const first = parts[0]!.slice(0, 40);
  if (parts.length === 1) return first;
  const initial = Array.from(parts[parts.length - 1]!)[0]!.toUpperCase();
  return `${first} ${initial}.`;
}

export type SeekerListItemDto = { id: string; displayName: string; headline: string; skills: string[] };

export function seekerListDto(rows: Array<{
  id: string;
  headline: string;
  skills: string[];
  rsvp: { guestName: string | null; user: { name: string | null } | null };
}>): SeekerListItemDto[] {
  return rows.map((row) => ({
    id: row.id,
    displayName: seekerDisplayName(row.rsvp.user?.name?.trim() || row.rsvp.guestName),
    headline: row.headline,
    skills: [...row.skills],
  }));
}

const seekerRowSelect = {
  id: true,
  headline: true,
  skills: true,
  rsvp: { select: { guestName: true, user: { select: { name: true } } } },
} satisfies Prisma.TeamSeekerProfileSelect;

/** Rows per page in the attendee-side matching lists (seekers, teams looking for members, pending requests). */
export const TEAM_MATCHING_PAGE_SIZE = 20;

/** One bounded page of a list, the keyset cursor for the next one, and the size of the whole list. */
export type CursorPage<T> = { items: T[]; nextCursor: string | null; total: number };

function emptyPage<T>(total = 0): CursorPage<T> {
  return { items: [], nextCursor: null, total };
}

/** Search text and cursor for the seeker and team lists ("Show more"). */
export const matchingListQuerySchema = z
  .object({
    query: z.string().trim().max(100).optional().default(""),
    cursor: z.string().trim().max(160).nullable().optional(),
  })
  .strict();

/** Cursor for the pending invitation and request lists. */
export const joinRequestPageQuerySchema = z.object({ cursor: z.string().trim().max(160).nullable().optional() }).strict();

/** Leader authority still holds for this team row (rotated token or transferred leadership fail). */
function leaderAuthMatches(auth: TeamLeaderAuth, team: { manageTokenHash: string; leaderRsvp: { userId: string | null } | null }) {
  return auth.kind === "token" ? team.manageTokenHash === auth.manageTokenHash : team.leaderRsvp?.userId === auth.userId;
}

type SeekerScope = { eventId: string; excludeRsvpId?: string; pendingWithTeamId?: string };

const SEEKER_FROM = Prisma.sql`"TeamSeekerProfile" s JOIN "RSVP" r ON r."id" = s."rsvpId" LEFT JOIN "User" u ON u."id" = r."userId"`;

/**
 * The visible seekers of one event: solo, not declined. A search matches the
 * headline, any skill, or the first name only: the list shows "Ada L.", so a
 * search must not reveal a surname. Emails are never matched.
 */
export function seekerListConditions(scope: SeekerScope, query: string): Prisma.Sql[] {
  const conditions = [
    Prisma.sql`s."visible" = true`,
    Prisma.sql`r."eventId" = ${scope.eventId}`,
    Prisma.sql`r."teamId" IS NULL`,
    Prisma.sql`r."status" <> ${RsvpStatus.REJECTED}::"RsvpStatus"`,
  ];
  if (scope.excludeRsvpId) conditions.push(Prisma.sql`r."id" <> ${scope.excludeRsvpId}`);
  if (scope.pendingWithTeamId) {
    // Seekers with a pending invitation or request for this team are
    // already listed with it on the team page.
    conditions.push(Prisma.sql`NOT EXISTS (
      SELECT 1 FROM "TeamJoinRequest" j
      WHERE j."rsvpId" = r."id" AND j."teamId" = ${scope.pendingWithTeamId}
        AND j."status" = ${TeamJoinRequestStatus.PENDING}::"TeamJoinRequestStatus"
    )`);
  }
  if (query) {
    const pattern = `%${escapeLikePattern(query)}%`;
    conditions.push(Prisma.sql`(
      s."headline" ILIKE ${pattern}
      OR EXISTS (SELECT 1 FROM unnest(s."skills") AS skill WHERE skill ILIKE ${pattern})
      OR (regexp_split_to_array(btrim(COALESCE(NULLIF(btrim(u."name"), ''), r."guestName", '')), '[[:space:]]+'))[1] ILIKE ${pattern}
    )`);
  }
  return conditions;
}

/** One page of visible seekers, most recently updated first (keyset on `updatedAt DESC, id ASC`). */
async function pageVisibleSeekers(scope: SeekerScope, input: unknown): Promise<CursorPage<SeekerListItemDto>> {
  const parsed = matchingListQuerySchema.safeParse(input ?? {});
  if (!parsed.success) return emptyPage();
  const { query, cursor } = parsed.data;
  const base = seekerListConditions(scope, query);
  const conditions = [...base];
  if (cursor) {
    const after = decodeKeysetCursor(cursor);
    if (!after) return emptyPage();
    const at = sqlTimestamp(after.at);
    conditions.push(Prisma.sql`(s."updatedAt" < ${at}::timestamp(3) OR (s."updatedAt" = ${at}::timestamp(3) AND s."id" > ${after.id}))`);
  }
  const [ids, counted] = await Promise.all([
    prisma.$queryRaw<Array<{ id: string; updatedAt: Date }>>`
      SELECT s."id", s."updatedAt" FROM ${SEEKER_FROM}
      WHERE ${Prisma.join(conditions, " AND ")}
      ORDER BY s."updatedAt" DESC, s."id" ASC
      LIMIT ${TEAM_MATCHING_PAGE_SIZE + 1}`,
    prisma.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) AS "count" FROM ${SEEKER_FROM} WHERE ${Prisma.join(base, " AND ")}`,
  ]);
  const total = Number(counted[0]?.count ?? 0);
  const page = ids.slice(0, TEAM_MATCHING_PAGE_SIZE);
  const last = page[page.length - 1];
  if (!last) return emptyPage(total);
  const rows = await prisma.teamSeekerProfile.findMany({
    where: { id: { in: page.map((row) => row.id) }, visible: true, rsvp: { eventId: scope.eventId, teamId: null } },
    select: seekerRowSelect,
  });
  const byId = new Map(rows.map((row) => [row.id, row]));
  return {
    items: seekerListDto(page.flatMap((row) => byId.get(row.id) ?? [])),
    nextCursor: ids.length > TEAM_MATCHING_PAGE_SIZE ? encodeKeysetCursor(last.updatedAt, last.id) : null,
    total,
  };
}

/**
 * Seeker list for a leader of a non-rejected team with free space; otherwise
 * null. Re-checked on every page, so "Show more" stops working as soon as the
 * team fills up, is declined, or the leader loses the link.
 */
export async function listSeekersForLeader(auth: TeamLeaderAuth, input: unknown = {}): Promise<CursorPage<SeekerListItemDto> | null> {
  const team = await prisma.team.findFirst({
    where: { id: auth.teamId, eventId: auth.eventId },
    select: {
      status: true,
      manageTokenHash: true,
      leaderRsvp: { select: { userId: true } },
      _count: { select: { members: true } },
      event: { select: { registrationMode: true, soloPolicy: true, teamMaxSize: true } },
    },
  });
  if (!team || !isMatchingEvent(team.event) || team.status === RsvpStatus.REJECTED) return null;
  if (!leaderAuthMatches(auth, team)) return null;
  if (!hasFreeSpace(team.event, team._count.members)) return null;
  return pageVisibleSeekers({ eventId: auth.eventId, pendingWithTeamId: auth.teamId }, input);
}

/** Seeker-side gate: the holder is a solo registrant with a visible profile on a matching event. */
async function visibleSeekerHolder(holder: TicketHolder) {
  const rsvp = await prisma.rSVP.findFirst({
    where: { id: holder.rsvpId, eventId: holder.eventId, teamId: null, status: { not: RsvpStatus.REJECTED }, seekerProfile: { visible: true } },
    select: { id: true, event: { select: { registrationMode: true, soloPolicy: true, teamMaxSize: true } } },
  });
  return rsvp?.event && isMatchingEvent(rsvp.event) ? rsvp : null;
}

/** Other visible seekers of the same event, for a visible seeker; otherwise null. */
export async function listSeekersForSeeker(holder: TicketHolder, input: unknown = {}): Promise<CursorPage<SeekerListItemDto> | null> {
  if (!(await visibleSeekerHolder(holder))) return null;
  return pageVisibleSeekers({ eventId: holder.eventId, excludeRsvpId: holder.rsvpId }, input);
}

/** `requested`: the holder already has a pending request with this team. */
export type LookingTeamDto = { id: string; name: string; size: number; maxSize: number | null; requested: boolean };

/**
 * Teams that are looking for members and have space, for a visible seeker;
 * otherwise null. Oldest first (keyset on `createdAt, id`); the free-space
 * test is in the query, so full teams never take a place on a page. A search
 * matches the team name.
 */
export async function listTeamsLookingForMembers(holder: TicketHolder, input: unknown = {}): Promise<CursorPage<LookingTeamDto> | null> {
  const seeker = await visibleSeekerHolder(holder);
  if (!seeker?.event) return null;
  const parsed = matchingListQuerySchema.safeParse(input ?? {});
  if (!parsed.success) return emptyPage();
  const { query, cursor } = parsed.data;
  const maxSize = seeker.event.teamMaxSize;
  // Without a maximum no team has free space (`hasFreeSpace`).
  if (maxSize == null) return emptyPage();
  const base = [
    Prisma.sql`t."eventId" = ${holder.eventId}`,
    Prisma.sql`t."lookingForMembers" = true`,
    Prisma.sql`t."status" <> ${RsvpStatus.REJECTED}::"RsvpStatus"`,
    Prisma.sql`(SELECT count(*) FROM "RSVP" r WHERE r."teamId" = t."id") < ${maxSize}`,
  ];
  if (query) base.push(Prisma.sql`t."name" ILIKE ${`%${escapeLikePattern(query)}%`}`);
  const conditions = [...base];
  if (cursor) {
    const after = decodeKeysetCursor(cursor);
    if (!after) return emptyPage();
    conditions.push(Prisma.sql`(t."createdAt", t."id") > (${sqlTimestamp(after.at)}::timestamp(3), ${after.id})`);
  }
  const [ids, counted] = await Promise.all([
    prisma.$queryRaw<Array<{ id: string; createdAt: Date }>>`
      SELECT t."id", t."createdAt" FROM "Team" t
      WHERE ${Prisma.join(conditions, " AND ")}
      ORDER BY t."createdAt" ASC, t."id" ASC
      LIMIT ${TEAM_MATCHING_PAGE_SIZE + 1}`,
    prisma.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) AS "count" FROM "Team" t WHERE ${Prisma.join(base, " AND ")}`,
  ]);
  const total = Number(counted[0]?.count ?? 0);
  const page = ids.slice(0, TEAM_MATCHING_PAGE_SIZE);
  const last = page[page.length - 1];
  if (!last) return emptyPage(total);
  const pageIds = page.map((row) => row.id);
  const [teams, requests] = await Promise.all([
    prisma.team.findMany({
      where: { id: { in: pageIds }, eventId: holder.eventId },
      select: { id: true, name: true, _count: { select: { members: true } } },
    }),
    prisma.teamJoinRequest.findMany({
      where: { rsvpId: holder.rsvpId, teamId: { in: pageIds }, status: TeamJoinRequestStatus.PENDING, direction: TeamJoinRequestDirection.REQUEST },
      select: { teamId: true },
    }),
  ]);
  const byId = new Map(teams.map((team) => [team.id, team]));
  const requested = new Set(requests.map((request) => request.teamId));
  return {
    items: page.flatMap((row) => {
      const team = byId.get(row.id);
      return team ? [{ id: team.id, name: team.name, size: team._count.members, maxSize, requested: requested.has(team.id) }] : [];
    }),
    nextCursor: ids.length > TEAM_MATCHING_PAGE_SIZE ? encodeKeysetCursor(last.createdAt, last.id) : null,
    total,
  };
}

/**
 * One page of pending join requests, oldest first (keyset on `createdAt, id`),
 * with the count of all rows matching `where`.
 */
async function pageJoinRequests<R extends { id: string; createdAt: Date }, T>(
  where: Prisma.TeamJoinRequestWhereInput,
  cursor: string | null | undefined,
  find: (args: { where: Prisma.TeamJoinRequestWhereInput; take: number }) => Promise<R[]>,
  map: (row: R) => T,
): Promise<CursorPage<T>> {
  let pageWhere = where;
  if (cursor) {
    const after = decodeKeysetCursor(cursor);
    if (!after) return emptyPage();
    pageWhere = { AND: [where, { OR: [{ createdAt: { gt: after.at } }, { createdAt: after.at, id: { gt: after.id } }] }] };
  }
  const [rows, total] = await Promise.all([
    find({ where: pageWhere, take: TEAM_MATCHING_PAGE_SIZE + 1 }),
    prisma.teamJoinRequest.count({ where }),
  ]);
  const page = rows.slice(0, TEAM_MATCHING_PAGE_SIZE);
  const last = page[page.length - 1];
  return {
    items: page.map(map),
    nextCursor: rows.length > TEAM_MATCHING_PAGE_SIZE && last ? encodeKeysetCursor(last.createdAt, last.id) : null,
    total,
  };
}

/** A pending invitation or request on the team page: the seeker's display fields only. */
export type TeamJoinRequestItemDto = { id: string; direction: TeamJoinRequestDirection; displayName: string; headline: string | null; skills: string[] };

const teamJoinRequestSelect = {
  id: true,
  direction: true,
  createdAt: true,
  rsvp: { select: { guestName: true, user: { select: { name: true } }, seekerProfile: { select: { headline: true, skills: true } } } },
} satisfies Prisma.TeamJoinRequestSelect;

export function teamJoinRequestDto(request: {
  id: string;
  direction: TeamJoinRequestDirection;
  rsvp: { guestName: string | null; user: { name: string | null } | null; seekerProfile: { headline: string; skills: string[] } | null };
}): TeamJoinRequestItemDto {
  return {
    id: request.id,
    direction: request.direction,
    displayName: seekerDisplayName(request.rsvp.user?.name?.trim() || request.rsvp.guestName),
    headline: request.rsvp.seekerProfile?.headline ?? null,
    skills: request.rsvp.seekerProfile ? [...request.rsvp.seekerProfile.skills] : [],
  };
}

function teamJoinRequestPage(teamId: string, direction: TeamJoinRequestDirection, cursor: string | null | undefined) {
  return pageJoinRequests(
    { teamId, status: TeamJoinRequestStatus.PENDING, direction },
    cursor,
    (args) => prisma.teamJoinRequest.findMany({ ...args, select: teamJoinRequestSelect, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
    (row) => teamJoinRequestDto(row),
  );
}

/**
 * Team page "Show more" for incoming requests (`REQUEST`) or sent invitations
 * (`INVITE`). Leader authority is re-checked against the team row on every
 * page; null on any mismatch.
 */
export async function listTeamJoinRequestsForLeader(
  auth: TeamLeaderAuth,
  direction: TeamJoinRequestDirection,
  input: unknown = {},
): Promise<CursorPage<TeamJoinRequestItemDto> | null> {
  const parsed = joinRequestPageQuerySchema.safeParse(input ?? {});
  if (!parsed.success) return null;
  const team = await prisma.team.findFirst({
    where: { id: auth.teamId, eventId: auth.eventId },
    select: { manageTokenHash: true, leaderRsvp: { select: { userId: true } } },
  });
  if (!team || !leaderAuthMatches(auth, team)) return null;
  return teamJoinRequestPage(auth.teamId, direction, parsed.data.cursor);
}

export type TeamPageDto = {
  team: {
    id: string;
    name: string;
    status: RsvpStatus;
    size: number;
    minSize: number | null;
    maxSize: number | null;
    incomplete: boolean;
    lookingForMembers: boolean;
    joinPath: string;
  };
  event: {
    title: string;
    orgSlug: string;
    eventSlug: string;
    startDateTime: Date;
    endDateTime: Date;
    timezone: string;
    registrationOpen: boolean;
    soloPolicy: SoloPolicy;
    /** Invite-only events: the leader can't add members by email, only share the join link. */
    inviteOnly: boolean;
  };
  members: Array<{ rsvpId: string; name: string; isLeader: boolean; checkedIn: boolean }>;
  /** First page of pending requests the team received, seeker side as display fields only. */
  incomingRequests: CursorPage<TeamJoinRequestItemDto>;
  /** First page of pending invitations the team sent. */
  sentInvites: CursorPage<TeamJoinRequestItemDto>;
};

type TeamPageRow = {
  id: string;
  name: string;
  status: RsvpStatus;
  joinToken: string;
  leaderRsvpId: string | null;
  lookingForMembers: boolean;
  event: {
    title: string;
    slug: string;
    startDateTime: Date;
    endDateTime: Date;
    timezone: string;
    teamMinSize: number | null;
    teamMaxSize: number | null;
    soloPolicy: SoloPolicy;
    privacyType: EventPrivacyType;
    registrationOpen: boolean;
    organisation: { slug: string };
  };
  members: Array<{ id: string; guestName: string | null; checkedInAt: Date | null; user: { name: string | null } | null }>;
};

/** Team page DTO: names only for members; no emails, answers, or ticket tokens. */
export function teamPageDto(
  row: TeamPageRow,
  requests: { incoming: CursorPage<TeamJoinRequestItemDto>; sent: CursorPage<TeamJoinRequestItemDto> },
): TeamPageDto {
  const size = row.members.length;
  return {
    team: {
      id: row.id,
      name: row.name,
      status: row.status,
      size,
      minSize: row.event.teamMinSize,
      maxSize: row.event.teamMaxSize,
      incomplete: row.event.teamMinSize != null && size < row.event.teamMinSize,
      lookingForMembers: row.lookingForMembers,
      joinPath: teamJoinPath(row.event.organisation.slug, row.event.slug, row.joinToken),
    },
    event: {
      title: row.event.title,
      orgSlug: row.event.organisation.slug,
      eventSlug: row.event.slug,
      startDateTime: row.event.startDateTime,
      endDateTime: row.event.endDateTime,
      timezone: row.event.timezone,
      registrationOpen: row.event.registrationOpen,
      soloPolicy: row.event.soloPolicy,
      inviteOnly: row.event.privacyType === EventPrivacyType.INVITE_ONLY,
    },
    members: row.members.map((member) => ({
      rsvpId: member.id,
      name: personName(member),
      isLeader: member.id === row.leaderRsvpId,
      checkedIn: member.checkedInAt != null,
    })),
    incomingRequests: requests.incoming,
    sentInvites: requests.sent,
  };
}

/** Load the team page for a leader (manage token or signed-in leader). */
export async function loadTeamPage(auth: TeamLeaderAuth): Promise<TeamPageDto | null> {
  const team = await prisma.team.findFirst({
    where: { id: auth.teamId, eventId: auth.eventId },
    select: {
      id: true,
      name: true,
      status: true,
      joinToken: true,
      manageTokenHash: true,
      leaderRsvpId: true,
      lookingForMembers: true,
      leaderRsvp: { select: { userId: true } },
      event: {
        select: {
          title: true,
          slug: true,
          status: true,
          startDateTime: true,
          endDateTime: true,
          timezone: true,
          registrationClosesAt: true,
          registrationLeadMinutes: true,
          teamMinSize: true,
          teamMaxSize: true,
          soloPolicy: true,
          privacyType: true,
          page: { select: { isPublished: true } },
          organisation: { select: { slug: true } },
        },
      },
      // Bounded by `teamMaxSize`; members are never paged.
      members: {
        select: { id: true, guestName: true, checkedInAt: true, user: { select: { name: true } } },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      },
    },
  });
  if (!team || !leaderAuthMatches(auth, team)) return null;
  const registrationOpen =
    team.event.status === EventStatus.PUBLISHED &&
    team.event.page?.isPublished === true &&
    team.event.endDateTime > new Date() &&
    !isRegistrationClosed(team.event);
  const [incoming, sent] = await Promise.all([
    teamJoinRequestPage(team.id, TeamJoinRequestDirection.REQUEST, null),
    teamJoinRequestPage(team.id, TeamJoinRequestDirection.INVITE, null),
  ]);
  return teamPageDto({ ...team, event: { ...team.event, registrationOpen } }, { incoming, sent });
}

export type MemberTeamViewDto = { name: string; leaderName: string | null; members: string[]; isLeader: boolean };

/** Ticket page: the holder's team name, leader name and member names only. */
export async function loadMemberTeamView(holder: TicketHolder): Promise<MemberTeamViewDto | null> {
  if (!holder.teamId) return null;
  const team = await prisma.team.findFirst({
    where: { id: holder.teamId, eventId: holder.eventId },
    select: {
      name: true,
      leaderRsvpId: true,
      members: { select: { id: true, guestName: true, user: { select: { name: true } } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
    },
  });
  if (!team) return null;
  const leader = team.members.find((member) => member.id === team.leaderRsvpId);
  return {
    name: team.name,
    leaderName: leader ? personName(leader) : null,
    members: team.members.map(personName),
    isLeader: team.leaderRsvpId === holder.rsvpId,
  };
}

/** A pending invitation from a team, to accept or decline: team name and size only. */
export type SeekerInviteDto = { id: string; teamName: string; size: number; maxSize: number | null };
/** A pending request the holder sent, to withdraw. */
export type SeekerRequestDto = { id: string; teamId: string; teamName: string };

export type SeekerViewDto = {
  /** The holder's own profile, including hidden ones, so it can be edited. */
  profile: { headline: string; skills: string[]; visible: boolean } | null;
  /** First page of pending invitations from teams. */
  invites: CursorPage<SeekerInviteDto>;
  /** First page of pending requests the holder sent. */
  requests: CursorPage<SeekerRequestDto>;
};

/** Seeker-view gate: a solo, non-declined registrant of a matching event (listed or not). */
async function seekerViewHolder(holder: TicketHolder) {
  const rsvp = await prisma.rSVP.findFirst({
    where: { id: holder.rsvpId, eventId: holder.eventId, teamId: null, status: { not: RsvpStatus.REJECTED } },
    select: {
      seekerProfile: { select: { headline: true, skills: true, visible: true } },
      event: { select: { registrationMode: true, soloPolicy: true, teamMaxSize: true } },
    },
  });
  return rsvp?.event && isMatchingEvent(rsvp.event) ? { profile: rsvp.seekerProfile, maxSize: rsvp.event.teamMaxSize } : null;
}

function seekerJoinRequestWhere(holder: TicketHolder, direction: TeamJoinRequestDirection): Prisma.TeamJoinRequestWhereInput {
  return { rsvpId: holder.rsvpId, status: TeamJoinRequestStatus.PENDING, direction, team: { eventId: holder.eventId } };
}

function seekerInvitePage(holder: TicketHolder, maxSize: number | null, cursor: string | null | undefined) {
  return pageJoinRequests(
    seekerJoinRequestWhere(holder, TeamJoinRequestDirection.INVITE),
    cursor,
    (args) =>
      prisma.teamJoinRequest.findMany({
        ...args,
        select: { id: true, createdAt: true, team: { select: { name: true, _count: { select: { members: true } } } } },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      }),
    (row): SeekerInviteDto => ({ id: row.id, teamName: row.team.name, size: row.team._count.members, maxSize }),
  );
}

function seekerRequestPage(holder: TicketHolder, cursor: string | null | undefined) {
  return pageJoinRequests(
    seekerJoinRequestWhere(holder, TeamJoinRequestDirection.REQUEST),
    cursor,
    (args) =>
      prisma.teamJoinRequest.findMany({
        ...args,
        select: { id: true, createdAt: true, team: { select: { id: true, name: true } } },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      }),
    (row): SeekerRequestDto => ({ id: row.id, teamId: row.team.id, teamName: row.team.name }),
  );
}

/**
 * Ticket page, solo registrant of a SOLO_WITH_MATCHING event: their own
 * profile and the first page of their pending invitations and requests. Team
 * names and sizes only; never member names, emails, or tokens. Null when the
 * holder is in a team, was declined, or the event has no matching list.
 */
export async function loadSeekerView(holder: TicketHolder): Promise<SeekerViewDto | null> {
  const seeker = await seekerViewHolder(holder);
  if (!seeker) return null;
  const [invites, requests] = await Promise.all([seekerInvitePage(holder, seeker.maxSize, null), seekerRequestPage(holder, null)]);
  return {
    profile: seeker.profile ? { headline: seeker.profile.headline, skills: [...seeker.profile.skills], visible: seeker.profile.visible } : null,
    invites,
    requests,
  };
}

/** Ticket page "Show more" for the holder's pending invitations; same gate as `loadSeekerView`. */
export async function listSeekerInvites(holder: TicketHolder, input: unknown = {}): Promise<CursorPage<SeekerInviteDto> | null> {
  const parsed = joinRequestPageQuerySchema.safeParse(input ?? {});
  if (!parsed.success) return null;
  const seeker = await seekerViewHolder(holder);
  return seeker ? seekerInvitePage(holder, seeker.maxSize, parsed.data.cursor) : null;
}

/** Ticket page "Show more" for the holder's pending requests; same gate as `loadSeekerView`. */
export async function listSeekerRequests(holder: TicketHolder, input: unknown = {}): Promise<CursorPage<SeekerRequestDto> | null> {
  const parsed = joinRequestPageQuerySchema.safeParse(input ?? {});
  if (!parsed.success) return null;
  const seeker = await seekerViewHolder(holder);
  return seeker ? seekerRequestPage(holder, parsed.data.cursor) : null;
}

export type OrganiserTeamDto = {
  id: string;
  name: string;
  status: RsvpStatus;
  size: number;
  minSize: number | null;
  maxSize: number | null;
  incomplete: boolean;
  lookingForMembers: boolean;
  createdAt: Date;
  leaderRsvpId: string | null;
  members: Array<{ rsvpId: string; name: string; email: string | null; isLeader: boolean; checkedIn: boolean }>;
};

/** Teams per page in the organiser's Teams view; "Load more" fetches the next page. */
export const ORGANISER_TEAMS_PAGE_SIZE = 50;
/** Teams per batch when the Teams CSV streams a filtered view (the largest page the query serves). */
export const ORGANISER_TEAMS_EXPORT_BATCH_SIZE = 200;
/** Teams per page in the Move to team picker; "Show more" fetches the next page. */
export const TEAM_MOVE_TARGETS_PAGE_SIZE = 20;

export { ORGANISER_TEAM_FILTERS, type OrganiserTeamFilter } from "@/lib/organiserTeamFilters";

const FILTER_STATUS: Partial<Record<OrganiserTeamFilter, RsvpStatus>> = {
  going: RsvpStatus.CONFIRMED,
  waitlist: RsvpStatus.WAITLISTED,
  approve: RsvpStatus.PENDING_APPROVAL,
  declined: RsvpStatus.REJECTED,
};

/** Opaque keyset cursor: the last row's sort time (ms) and id. */
/** The shared `<epoch ms>.<id>` keyset cursor (lib/keysetCursor.ts). */
export function encodeKeysetCursor(at: Date, id: string): string {
  return encodeTimeCursor({ at, id });
}

export function decodeKeysetCursor(cursor: string): { at: Date; id: string } | null {
  return decodeTimeCursor(cursor);
}

/** `timestamp(3)` columns hold UTC wall-clock time; compare a cursor time against them as such. */
function sqlTimestamp(at: Date): string {
  return at.toISOString().replace("Z", "");
}

/** The organiser Teams view's cursor: the last team's creation time and id. */
export function encodeTeamCursor(team: { createdAt: Date; id: string }): string {
  return encodeKeysetCursor(team.createdAt, team.id);
}

export function decodeTeamCursor(cursor: string): { createdAt: Date; id: string } | null {
  const after = decodeKeysetCursor(cursor);
  return after ? { createdAt: after.at, id: after.id } : null;
}

/** `%`, `_` and `\` match literally in the search text. */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

export const organiserTeamsQuerySchema = z
  .object({
    query: z.string().trim().max(100).optional().default(""),
    filter: z.enum(ORGANISER_TEAM_FILTERS).optional().default("all"),
    cursor: z.string().trim().max(160).nullable().optional(),
  })
  .strict();

export type OrganiserTeamsPage = { teams: OrganiserTeamDto[]; nextCursor: string | null };

/**
 * Guests tab → Teams view, one bounded page at a time (oldest first, keyset
 * paging on `createdAt, id`). Searches team names, and members' names and
 * emails, within this event only. Callers must have passed
 * `resolveOrganiserEvent`.
 */
export async function listEventTeamsForOrganiser(
  ctx: OrganiserEventContext,
  input: unknown = {},
  options: { pageSize?: number } = {},
): Promise<OrganiserTeamsPage> {
  // The dashboard pages 50 at a time; the filtered Teams CSV reads larger,
  // still bounded, batches through the same query.
  const pageSize = Math.min(Math.max(1, Math.floor(options.pageSize ?? ORGANISER_TEAMS_PAGE_SIZE)), ORGANISER_TEAMS_EXPORT_BATCH_SIZE);
  const empty: OrganiserTeamsPage = { teams: [], nextCursor: null };
  const parsed = organiserTeamsQuerySchema.safeParse(input);
  if (!parsed.success) return empty;
  const { query, filter, cursor } = parsed.data;
  const event = await prisma.event.findFirst({
    where: { id: ctx.eventId, organisationId: ctx.organisationId },
    select: { id: true, teamMinSize: true, teamMaxSize: true },
  });
  if (!event) return empty;

  const conditions: Prisma.Sql[] = [Prisma.sql`t."eventId" = ${event.id}`];
  const status = FILTER_STATUS[filter];
  if (status) conditions.push(Prisma.sql`t."status" = ${status}::"RsvpStatus"`);
  if (filter === "incomplete") {
    if (event.teamMinSize == null) return empty;
    conditions.push(Prisma.sql`(SELECT count(*) FROM "RSVP" r WHERE r."teamId" = t."id") < ${event.teamMinSize}`);
  }
  if (filter === "looking") conditions.push(Prisma.sql`t."lookingForMembers" = true`);
  if (query) {
    const pattern = `%${escapeLikePattern(query)}%`;
    conditions.push(Prisma.sql`(
      t."name" ILIKE ${pattern}
      OR EXISTS (
        SELECT 1 FROM "RSVP" r LEFT JOIN "User" u ON u."id" = r."userId"
        WHERE r."teamId" = t."id" AND r."eventId" = ${event.id}
          AND (r."guestName" ILIKE ${pattern} OR r."guestEmail" ILIKE ${pattern} OR u."name" ILIKE ${pattern} OR u."email" ILIKE ${pattern})
      )
    )`);
  }
  if (cursor) {
    const after = decodeTeamCursor(cursor);
    if (!after) return empty;
    const at = sqlTimestamp(after.createdAt);
    conditions.push(Prisma.sql`(t."createdAt", t."id") > (${at}::timestamp(3), ${after.id})`);
  }
  const ids = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT t."id" FROM "Team" t
    WHERE ${Prisma.join(conditions, " AND ")}
    ORDER BY t."createdAt" ASC, t."id" ASC
    LIMIT ${pageSize + 1}`;
  const pageIds = ids.slice(0, pageSize).map((row) => row.id);
  if (pageIds.length === 0) return empty;

  const rows = await prisma.team.findMany({
    where: { id: { in: pageIds }, eventId: event.id },
    select: {
      id: true,
      name: true,
      status: true,
      lookingForMembers: true,
      createdAt: true,
      leaderRsvpId: true,
      members: {
        select: { id: true, guestName: true, guestEmail: true, checkedInAt: true, user: { select: { name: true, email: true } } },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const teams = rows.map((team) => ({
    id: team.id,
    name: team.name,
    status: team.status,
    size: team.members.length,
    minSize: event.teamMinSize,
    maxSize: event.teamMaxSize,
    incomplete: event.teamMinSize != null && team.members.length < event.teamMinSize,
    lookingForMembers: team.lookingForMembers,
    createdAt: team.createdAt,
    leaderRsvpId: team.leaderRsvpId,
    members: team.members.map((member) => ({
      rsvpId: member.id,
      name: personName(member),
      email: personEmail(member),
      isLeader: member.id === team.leaderRsvpId,
      checkedIn: member.checkedInAt != null,
    })),
  }));
  const last = rows[rows.length - 1];
  return { teams, nextCursor: ids.length > pageSize && last ? encodeTeamCursor(last) : null };
}

/** How many of the event's teams each Teams-view filter holds (aggregates only). */
export async function countEventTeamsForOrganiser(ctx: OrganiserEventContext): Promise<Record<OrganiserTeamFilter, number>> {
  const counts = Object.fromEntries(ORGANISER_TEAM_FILTERS.map((filter) => [filter, 0])) as Record<OrganiserTeamFilter, number>;
  const event = await prisma.event.findFirst({
    where: { id: ctx.eventId, organisationId: ctx.organisationId },
    select: { id: true, teamMinSize: true },
  });
  if (!event) return counts;
  const [groups, incomplete, looking] = await Promise.all([
    prisma.team.groupBy({ by: ["status"], where: { eventId: event.id }, _count: { _all: true } }),
    event.teamMinSize == null
      ? Promise.resolve([{ count: BigInt(0) }])
      : prisma.$queryRaw<Array<{ count: bigint }>>`
          SELECT count(*) AS "count" FROM "Team" t
          WHERE t."eventId" = ${event.id}
            AND (SELECT count(*) FROM "RSVP" r WHERE r."teamId" = t."id") < ${event.teamMinSize}`,
    prisma.team.count({ where: { eventId: event.id, lookingForMembers: true } }),
  ]);
  for (const group of groups) {
    counts.all += group._count._all;
    for (const [filter, status] of Object.entries(FILTER_STATUS) as Array<[OrganiserTeamFilter, RsvpStatus]>) {
      if (status === group.status) counts[filter] += group._count._all;
    }
  }
  counts.incomplete = Number(incomplete[0]?.count ?? 0);
  counts.looking = looking;
  return counts;
}

export const teamMoveTargetsQuerySchema = z
  .object({
    query: z.string().trim().max(100).optional().default(""),
    cursor: z.string().trim().max(600).nullable().optional(),
    /** The person's current team, never offered as a target. */
    excludeTeamId: z.string().trim().min(1).max(128).nullable().optional(),
  })
  .strict();

export type TeamMoveTargetDto = { id: string; name: string; status: RsvpStatus; size: number; maxSize: number | null };
export type TeamMoveTargetsPage = { teams: TeamMoveTargetDto[]; nextCursor: string | null };

/**
 * Teams a registration could be moved into (People row "Move to team", and a
 * member move in the Teams view): this event's teams that are not declined
 * and, when the event caps team size, still have room. Alphabetical
 * (`nameKey, id` keyset), searched by name, one bounded page at a time, so
 * full teams never take up a page and every team can be reached. Names,
 * status and size only. The move itself re-checks everything under the
 * event lock. Callers must have passed `resolveOrganiserEvent`.
 */
export async function listTeamMoveTargetsForOrganiser(ctx: OrganiserEventContext, input: unknown = {}): Promise<TeamMoveTargetsPage> {
  const empty: TeamMoveTargetsPage = { teams: [], nextCursor: null };
  const parsed = teamMoveTargetsQuerySchema.safeParse(input ?? {});
  if (!parsed.success) return empty;
  const { query, cursor, excludeTeamId } = parsed.data;
  const event = await prisma.event.findFirst({
    where: { id: ctx.eventId, organisationId: ctx.organisationId },
    select: { id: true, teamMaxSize: true },
  });
  if (!event) return empty;

  const conditions: Prisma.Sql[] = [Prisma.sql`t."eventId" = ${event.id}`, Prisma.sql`t."status" <> ${RsvpStatus.REJECTED}::"RsvpStatus"`];
  if (event.teamMaxSize != null) {
    conditions.push(Prisma.sql`(SELECT count(*) FROM "RSVP" r WHERE r."teamId" = t."id") < ${event.teamMaxSize}`);
  }
  if (excludeTeamId) conditions.push(Prisma.sql`t."id" <> ${excludeTeamId}`);
  if (query) conditions.push(Prisma.sql`t."name" ILIKE ${`%${escapeLikePattern(query)}%`}`);
  if (cursor) {
    const after = decodeKeyCursor(cursor);
    if (!after) return empty;
    conditions.push(Prisma.sql`(t."nameKey", t."id") > (${after.key}, ${after.id})`);
  }
  const rows = await prisma.$queryRaw<Array<{ id: string; name: string; nameKey: string; status: RsvpStatus; size: bigint }>>`
    SELECT t."id", t."name", t."nameKey", t."status",
      (SELECT count(*) FROM "RSVP" r WHERE r."teamId" = t."id") AS "size"
    FROM "Team" t
    WHERE ${Prisma.join(conditions, " AND ")}
    ORDER BY t."nameKey" ASC, t."id" ASC
    LIMIT ${TEAM_MOVE_TARGETS_PAGE_SIZE + 1}`;
  const page = rows.slice(0, TEAM_MOVE_TARGETS_PAGE_SIZE);
  const last = page[page.length - 1];
  return {
    teams: page.map((team) => ({ id: team.id, name: team.name, status: team.status, size: Number(team.size), maxSize: event.teamMaxSize })),
    nextCursor: rows.length > TEAM_MOVE_TARGETS_PAGE_SIZE && last ? encodeKeyCursor({ key: last.nameKey, id: last.id }) : null,
  };
}
