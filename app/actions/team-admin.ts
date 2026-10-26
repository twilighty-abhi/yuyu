"use server";

import type { RsvpStatus } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { recordAuditEvent } from "@/lib/audit";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import {
  ORGANISER_TEAM_FILTERS,
  listEventTeamsForOrganiser,
  listTeamMoveTargetsForOrganiser,
  organiserDeleteTeam,
  organiserMoveMember,
  organiserRenameTeam,
  resolveOrganiserEvent,
  transitionTeamStatus,
  type OrganiserEventContext,
  type TeamMoveTargetsPage,
  type TeamTransition,
} from "@/lib/core/teams";
import { z } from "zod";
import {
  organiserMoveTeamMemberSchema,
  organiserRenameTeamSchema,
  organiserTeamActionSchema,
} from "@/lib/validators";
import { toDashboardTeam, type DashboardTeam } from "@/lib/eventDashboard/teams";
import type { ActionResult } from "./org";
import { flattenZodErrors } from "./utils";

/*
 * Organiser actions on whole teams (Guests → Teams, docs/TEAMS.md). The
 * permission check is the one that guards the individual RSVP lifecycle
 * actions (`canManageRegistrationsFor`, via resolveOrganiserEvent), and the same "rsvp"
 * rate-limit bucket applies. The rules, the Event lock and the re-read of the
 * team inside its event live in lib/core/teams.ts. Removing one member goes
 * through the existing deleteRsvp action, which keeps its undo snapshot.
 */

const NO_PERMISSION = "You do not have permission to manage attendees.";

type Gate = { ok: true; ctx: OrganiserEventContext } | { ok: false; error: string };

async function organiserGate(organisationSlug: string, eventId: string): Promise<Gate> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in." };
  if (await isActionRateLimited("rsvp", userId)) return { ok: false, error: "Too many attendee updates. Try again shortly." };
  const ctx = await resolveOrganiserEvent(userId, organisationSlug, eventId);
  if (!ctx) return { ok: false, error: NO_PERMISSION };
  return { ok: true, ctx };
}

function revalidateTeamPaths(ctx: OrganiserEventContext) {
  revalidatePath(`/${ctx.orgSlug}`);
  revalidatePath(`/dashboard/${ctx.orgSlug}`);
  revalidatePath(`/${ctx.orgSlug}/${ctx.eventSlug}`);
  revalidatePath(`/dashboard/${ctx.orgSlug}/event/${ctx.eventId}`);
  revalidatePath(`/dashboard/${ctx.orgSlug}/event/${ctx.eventId}/check-in`);
}

const TRANSITION_AUDIT: Record<TeamTransition, string> = {
  approve: "TEAM_APPROVED",
  reject: "TEAM_REJECTED",
  promote: "TEAM_WAITLIST_PROMOTED",
};

async function transition(input: unknown, action: TeamTransition): Promise<ActionResult<{ status: RsvpStatus }>> {
  const parsed = organiserTeamActionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input.", fieldErrors: flattenZodErrors(parsed.error) };
  const gate = await organiserGate(parsed.data.organisationSlug, parsed.data.eventId);
  if (!gate.ok) return gate;
  const result = await transitionTeamStatus(gate.ctx, parsed.data.teamId, action);
  if (!result.ok) return result;
  await recordAuditEvent({
    action: TRANSITION_AUDIT[action],
    actorUserId: gate.ctx.userId,
    organisationId: gate.ctx.organisationId,
    targetType: "Team",
    targetId: parsed.data.teamId,
    metadata: { eventId: gate.ctx.eventId },
  });
  revalidateTeamPaths(gate.ctx);
  return result;
}

/** Approve a pending team; every member is confirmed together. */
export async function approveTeam(input: unknown): Promise<ActionResult<{ status: RsvpStatus }>> {
  return transition(input, "approve");
}

/** Decline a pending or waitlisted team; every member is declined together. */
export async function rejectTeam(input: unknown): Promise<ActionResult<{ status: RsvpStatus }>> {
  return transition(input, "reject");
}

/** Give a waitlisted team a place (one unit of capacity). */
export async function promoteTeam(input: unknown): Promise<ActionResult<{ status: RsvpStatus }>> {
  return transition(input, "promote");
}

export async function renameTeamAsOrganiser(input: unknown): Promise<ActionResult<{ name: string }>> {
  const parsed = organiserRenameTeamSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Enter a valid team name.", fieldErrors: flattenZodErrors(parsed.error) };
  const gate = await organiserGate(parsed.data.organisationSlug, parsed.data.eventId);
  if (!gate.ok) return gate;
  const result = await organiserRenameTeam(gate.ctx, parsed.data.teamId, parsed.data.name);
  if (!result.ok) return result;
  // Names stay out of audit metadata, as for attendees.
  await recordAuditEvent({
    action: "TEAM_RENAMED",
    actorUserId: gate.ctx.userId,
    organisationId: gate.ctx.organisationId,
    targetType: "Team",
    targetId: parsed.data.teamId,
    metadata: { eventId: gate.ctx.eventId },
  });
  revalidateTeamPaths(gate.ctx);
  return result;
}

/** Move a registration (solo or from another team) into a team; it takes the target team's status. */
export async function moveTeamMember(input: unknown): Promise<ActionResult<{ status: RsvpStatus }>> {
  const parsed = organiserMoveTeamMemberSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input.", fieldErrors: flattenZodErrors(parsed.error) };
  const gate = await organiserGate(parsed.data.organisationSlug, parsed.data.eventId);
  if (!gate.ok) return gate;
  const result = await organiserMoveMember(gate.ctx, { rsvpId: parsed.data.rsvpId, targetTeamId: parsed.data.targetTeamId });
  if (!result.ok) return result;
  await recordAuditEvent({
    action: "TEAM_MEMBER_MOVED",
    actorUserId: gate.ctx.userId,
    organisationId: gate.ctx.organisationId,
    targetType: "RSVP",
    targetId: parsed.data.rsvpId,
    metadata: { eventId: gate.ctx.eventId, teamId: parsed.data.targetTeamId },
  });
  revalidateTeamPaths(gate.ctx);
  return result;
}

/**
 * Delete a team and its members' registrations. Returns the undo id for the
 * existing restoreRsvp action (a short-lived, server-held snapshot).
 */
export async function deleteTeam(input: unknown): Promise<ActionResult<{ undoId: string; removed: number }>> {
  const parsed = organiserTeamActionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input.", fieldErrors: flattenZodErrors(parsed.error) };
  const gate = await organiserGate(parsed.data.organisationSlug, parsed.data.eventId);
  if (!gate.ok) return gate;
  const result = await organiserDeleteTeam(gate.ctx, parsed.data.teamId);
  if (!result.ok) return result;
  await recordAuditEvent({
    action: "TEAM_DELETED",
    actorUserId: gate.ctx.userId,
    organisationId: gate.ctx.organisationId,
    targetType: "Team",
    targetId: parsed.data.teamId,
    metadata: { eventId: gate.ctx.eventId, removed: result.data?.removed ?? 0 },
  });
  revalidateTeamPaths(gate.ctx);
  return result;
}

const teamsPageInputSchema = z
  .object({
    organisationSlug: z.string().trim().min(1).max(200),
    eventId: z.string().trim().min(1).max(128),
    query: z.string().max(100).optional(),
    filter: z.enum(ORGANISER_TEAM_FILTERS).optional(),
    cursor: z.string().max(160).nullable().optional(),
  })
  .strict();

/**
 * One page of Guests → Teams for a search, a status filter, or "Load more"
 * (bounded by ORGANISER_TEAMS_PAGE_SIZE). Read-only: the same organisation
 * admin check as the team actions, on the search rate-limit bucket.
 */
export async function loadTeamsPage(input: unknown): Promise<ActionResult<{ teams: DashboardTeam[]; nextCursor: string | null }>> {
  const parsed = teamsPageInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input." };
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in." };
  if (await isActionRateLimited("search", userId)) return { ok: false, error: "Too many searches. Try again shortly." };
  const ctx = await resolveOrganiserEvent(userId, parsed.data.organisationSlug, parsed.data.eventId);
  if (!ctx) return { ok: false, error: NO_PERMISSION };
  const { query, filter, cursor } = parsed.data;
  const page = await listEventTeamsForOrganiser(ctx, { query, filter, cursor: cursor ?? null });
  return { ok: true, data: { teams: page.teams.map(toDashboardTeam), nextCursor: page.nextCursor } };
}

const moveTargetsInputSchema = z
  .object({
    organisationSlug: z.string().trim().min(1).max(200),
    eventId: z.string().trim().min(1).max(128),
    query: z.string().max(100).optional(),
    cursor: z.string().max(600).nullable().optional(),
    excludeTeamId: z.string().trim().min(1).max(128).nullable().optional(),
  })
  .strict();

/**
 * One page of teams with room for the Move to team picker (search by name,
 * "Show more"). Read-only: the same organiser check as `moveTeamMember`, on
 * the search rate-limit bucket. The move re-checks size and status itself.
 */
export async function searchMoveTargets(input: unknown): Promise<ActionResult<TeamMoveTargetsPage>> {
  const parsed = moveTargetsInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input." };
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in." };
  if (await isActionRateLimited("search", userId)) return { ok: false, error: "Too many searches. Try again shortly." };
  const ctx = await resolveOrganiserEvent(userId, parsed.data.organisationSlug, parsed.data.eventId);
  if (!ctx) return { ok: false, error: NO_PERMISSION };
  const { query, cursor, excludeTeamId } = parsed.data;
  return { ok: true, data: await listTeamMoveTargetsForOrganiser(ctx, { query, cursor: cursor ?? null, excludeTeamId: excludeTeamId ?? null }) };
}
