"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import type { Bucket } from "@/lib/rateLimit";
import { teamTokenSchema, ticketTokenSchema } from "@/lib/validators";
import {
  addTeamMemberByLeader,
  cancelJoinRequest,
  createJoinRequest,
  disbandTeam,
  leaveTeam,
  regenerateJoinToken,
  regenerateManageToken,
  removeTeamMember,
  renameTeam,
  resolveLeaderForUser,
  resolveRsvpByTicketToken,
  resolveTeamByManageToken,
  respondToJoinRequest,
  setLookingForMembers,
  transferLeadership,
  upsertSeekerProfile,
  type TeamLeaderAuth,
  type TicketHolder,
} from "@/lib/core/teams";
import type { ActionResult } from "./org";

/**
 * Attendee-side team actions (docs/TEAMS.md): the leader's team page and the
 * member/seeker section of the ticket page. The rules, locking and capacity
 * live in lib/core/teams.ts; these wrappers authenticate the capability,
 * rate limit, audit and revalidate.
 *
 * Two different capabilities, never interchangeable:
 * - Leader actions take a `TeamRef`: the raw management token from
 *   `/team/{token}`, or a team id that only resolves for its signed-in leader.
 * - Member and seeker actions take the ticket (check-in) token, which only
 *   ever reaches leave and seeker actions; it never grants team management.
 *
 * Audit metadata never holds tokens, names, or emails.
 */

const TOO_MANY = "Too many team changes. Please try again shortly.";
const LINK_EXPIRED = "This team link is no longer valid. Use the newest link from your email.";
const NOT_FOUND = "Registration not found.";

const idSchema = z.string().trim().min(1).max(128);

const teamRefSchema = z.union([
  z.object({ manageToken: teamTokenSchema }).strict(),
  z.object({ teamId: idSchema }).strict(),
]);
export type TeamRef = { manageToken: string } | { teamId: string };

type LeaderContext = { auth: TeamLeaderAuth; actorUserId: string | null };

async function resolveLeader(ref: unknown): Promise<LeaderContext | null> {
  const parsed = teamRefSchema.safeParse(ref);
  if (!parsed.success) return null;
  const session = await auth();
  const actorUserId = session?.user?.id ?? null;
  if ("manageToken" in parsed.data) {
    const leader = await resolveTeamByManageToken(parsed.data.manageToken);
    return leader ? { auth: leader, actorUserId } : null;
  }
  // A bare team id is only an identifier: it resolves solely for the signed-in leader.
  if (!actorUserId) return null;
  const leader = await resolveLeaderForUser(actorUserId, parsed.data.teamId);
  return leader ? { auth: leader, actorUserId } : null;
}

async function resolveHolder(ticketToken: unknown): Promise<{ holder: TicketHolder; token: string; actorUserId: string | null } | null> {
  const parsed = ticketTokenSchema.safeParse(ticketToken);
  if (!parsed.success) return null;
  const session = await auth();
  const actorUserId = session?.user?.id ?? null;
  // Account-owned registrations also need that account signed in (as for cancellation).
  const holder = await resolveRsvpByTicketToken(parsed.data, actorUserId);
  return holder ? { holder, token: parsed.data, actorUserId } : null;
}

async function eventPaths(eventId: string) {
  return prisma.event.findUnique({
    where: { id: eventId },
    select: { organisationId: true, slug: true, organisation: { select: { slug: true } } },
  });
}

/** Audit plus revalidation of the public event page (capacity and counts can change). */
async function afterTeamChange(params: {
  eventId: string;
  action: string;
  actorUserId: string | null;
  teamId?: string;
  metadata?: Record<string, string | number | boolean | null>;
}) {
  const event = await eventPaths(params.eventId);
  if (!event) return;
  await recordAuditEvent({
    action: params.action,
    actorUserId: params.actorUserId,
    organisationId: event.organisationId,
    targetType: params.teamId ? "Team" : "Event",
    targetId: params.teamId ?? params.eventId,
    metadata: { eventId: params.eventId, ...params.metadata },
  }).catch(() => console.error("[teams] audit failed"));
  revalidatePath(`/${event.organisation.slug}/${event.slug}`);
}

async function limited(bucket: Bucket, subject: string) {
  return isActionRateLimited(bucket, subject);
}

/* ---------- Leader actions (team page) ---------- */

export async function renameTeamAction(ref: unknown, input: unknown): Promise<ActionResult<{ name: string }>> {
  const leader = await resolveLeader(ref);
  if (!leader) return { ok: false, error: LINK_EXPIRED };
  if (await limited("action", `team:${leader.auth.teamId}`)) return { ok: false, error: TOO_MANY };
  const result = await renameTeam(leader.auth, input);
  if (result.ok) await afterTeamChange({ eventId: leader.auth.eventId, teamId: leader.auth.teamId, actorUserId: leader.actorUserId, action: "TEAM_RENAMED" });
  return result;
}

export async function regenerateTeamJoinLinkAction(ref: unknown): Promise<ActionResult<{ joinPath: string }>> {
  const leader = await resolveLeader(ref);
  if (!leader) return { ok: false, error: LINK_EXPIRED };
  if (await limited("action", `team:${leader.auth.teamId}`)) return { ok: false, error: TOO_MANY };
  const result = await regenerateJoinToken(leader.auth);
  if (!result.ok) return result;
  if (!result.data) return { ok: false, error: "Could not create a new link." };
  await afterTeamChange({ eventId: leader.auth.eventId, teamId: leader.auth.teamId, actorUserId: leader.actorUserId, action: "TEAM_JOIN_LINK_REGENERATED" });
  return { ok: true, data: { joinPath: result.data.joinPath } };
}

/**
 * Rotate the management link. The new raw token is returned once so the page
 * can move to its new address; the old link stops working immediately.
 */
export async function regenerateTeamManageLinkAction(ref: unknown): Promise<ActionResult<{ managePath: string }>> {
  const leader = await resolveLeader(ref);
  if (!leader) return { ok: false, error: LINK_EXPIRED };
  if (await limited("action", `team:${leader.auth.teamId}`)) return { ok: false, error: TOO_MANY };
  const result = await regenerateManageToken(leader.auth);
  if (!result.ok) return result;
  if (!result.data) return { ok: false, error: "Could not reset the link." };
  await afterTeamChange({ eventId: leader.auth.eventId, teamId: leader.auth.teamId, actorUserId: leader.actorUserId, action: "TEAM_MANAGE_LINK_REGENERATED" });
  return { ok: true, data: { managePath: result.data.managePath } };
}

export async function addTeamMemberAction(ref: unknown, input: unknown): Promise<ActionResult<{ rsvpId: string }>> {
  const leader = await resolveLeader(ref);
  if (!leader) return { ok: false, error: LINK_EXPIRED };
  // Each add sends an email, so it shares the stricter invitation budget.
  if (await limited("invite", `team:${leader.auth.teamId}`)) return { ok: false, error: "Too many members added. Please try again later." };
  const result = await addTeamMemberByLeader(leader.auth, input);
  if (!result.ok) return result;
  if (!result.data) return { ok: false, error: "Could not add this member." };
  await afterTeamChange({
    eventId: leader.auth.eventId,
    teamId: leader.auth.teamId,
    actorUserId: leader.actorUserId,
    action: "TEAM_MEMBER_ADDED",
    metadata: { rsvpId: result.data.rsvpId },
  });
  return { ok: true, data: { rsvpId: result.data.rsvpId } };
}

export async function removeTeamMemberAction(ref: unknown, rsvpId: unknown): Promise<ActionResult> {
  const leader = await resolveLeader(ref);
  if (!leader) return { ok: false, error: LINK_EXPIRED };
  const parsed = idSchema.safeParse(rsvpId);
  if (!parsed.success) return { ok: false, error: "Member not found." };
  if (await limited("action", `team:${leader.auth.teamId}`)) return { ok: false, error: TOO_MANY };
  const result = await removeTeamMember(leader.auth, parsed.data);
  if (result.ok) {
    await afterTeamChange({ eventId: leader.auth.eventId, teamId: leader.auth.teamId, actorUserId: leader.actorUserId, action: "TEAM_MEMBER_REMOVED", metadata: { rsvpId: parsed.data } });
  }
  return result;
}

export async function transferTeamLeadershipAction(ref: unknown, rsvpId: unknown): Promise<ActionResult> {
  const leader = await resolveLeader(ref);
  if (!leader) return { ok: false, error: LINK_EXPIRED };
  const parsed = idSchema.safeParse(rsvpId);
  if (!parsed.success) return { ok: false, error: "Member not found." };
  if (await limited("action", `team:${leader.auth.teamId}`)) return { ok: false, error: TOO_MANY };
  const result = await transferLeadership(leader.auth, parsed.data);
  if (result.ok) {
    await afterTeamChange({ eventId: leader.auth.eventId, teamId: leader.auth.teamId, actorUserId: leader.actorUserId, action: "TEAM_LEADERSHIP_TRANSFERRED", metadata: { rsvpId: parsed.data } });
  }
  return result;
}

export async function setTeamLookingForMembersAction(ref: unknown, looking: unknown): Promise<ActionResult> {
  const leader = await resolveLeader(ref);
  if (!leader) return { ok: false, error: LINK_EXPIRED };
  if (typeof looking !== "boolean") return { ok: false, error: "Invalid input." };
  if (await limited("action", `team:${leader.auth.teamId}`)) return { ok: false, error: TOO_MANY };
  const result = await setLookingForMembers(leader.auth, looking);
  if (result.ok) {
    await afterTeamChange({ eventId: leader.auth.eventId, teamId: leader.auth.teamId, actorUserId: leader.actorUserId, action: "TEAM_LOOKING_FOR_MEMBERS_CHANGED", metadata: { looking } });
  }
  return result;
}

export async function disbandTeamAction(ref: unknown): Promise<ActionResult<{ cancelled: number; eventPath: string | null }>> {
  const leader = await resolveLeader(ref);
  if (!leader) return { ok: false, error: LINK_EXPIRED };
  if (await limited("action", `team:${leader.auth.teamId}`)) return { ok: false, error: TOO_MANY };
  const result = await disbandTeam(leader.auth);
  if (!result.ok) return result;
  if (!result.data) return { ok: false, error: "Could not disband the team." };
  await afterTeamChange({ eventId: leader.auth.eventId, teamId: leader.auth.teamId, actorUserId: leader.actorUserId, action: "TEAM_DISBANDED", metadata: { cancelled: result.data.cancelled } });
  const event = await eventPaths(leader.auth.eventId);
  return { ok: true, data: { cancelled: result.data.cancelled, eventPath: event ? `/${event.organisation.slug}/${event.slug}` : null } };
}

/** Invite a visible seeker (by seeker profile id) from the team page. */
export async function inviteSeekerAction(ref: unknown, seekerProfileId: unknown): Promise<ActionResult> {
  const leader = await resolveLeader(ref);
  if (!leader) return { ok: false, error: LINK_EXPIRED };
  const parsed = idSchema.safeParse(seekerProfileId);
  if (!parsed.success) return { ok: false, error: "This person is no longer looking for a team." };
  if (await limited("invite", `team:${leader.auth.teamId}`)) return { ok: false, error: "Too many invitations. Please try again later." };
  const result = await createJoinRequest({ direction: "INVITE", leader: leader.auth, seekerProfileId: parsed.data });
  if (!result.ok) return result;
  await afterTeamChange({ eventId: leader.auth.eventId, teamId: leader.auth.teamId, actorUserId: leader.actorUserId, action: "TEAM_INVITE_SENT", metadata: { requestId: result.data?.requestId ?? null } });
  return { ok: true };
}

/** The leader answers a seeker's request to join. */
export async function respondToTeamRequestAction(ref: unknown, requestId: unknown, accept: unknown): Promise<ActionResult<{ accepted: boolean }>> {
  const leader = await resolveLeader(ref);
  if (!leader) return { ok: false, error: LINK_EXPIRED };
  const parsed = idSchema.safeParse(requestId);
  if (!parsed.success || typeof accept !== "boolean") return { ok: false, error: "This request is no longer pending." };
  if (await limited("action", `team:${leader.auth.teamId}`)) return { ok: false, error: TOO_MANY };
  const result = await respondToJoinRequest({ actor: { kind: "leader", auth: leader.auth }, requestId: parsed.data, accept });
  if (result.ok) {
    await afterTeamChange({
      eventId: leader.auth.eventId,
      teamId: leader.auth.teamId,
      actorUserId: leader.actorUserId,
      action: accept ? "TEAM_REQUEST_ACCEPTED" : "TEAM_REQUEST_DECLINED",
      metadata: { requestId: parsed.data },
    });
  }
  return result;
}

/** The leader withdraws an invitation the team sent. */
export async function cancelTeamInviteAction(ref: unknown, requestId: unknown): Promise<ActionResult> {
  const leader = await resolveLeader(ref);
  if (!leader) return { ok: false, error: LINK_EXPIRED };
  const parsed = idSchema.safeParse(requestId);
  if (!parsed.success) return { ok: false, error: "This request is no longer pending." };
  if (await limited("action", `team:${leader.auth.teamId}`)) return { ok: false, error: TOO_MANY };
  return cancelJoinRequest({ actor: { kind: "leader", auth: leader.auth }, requestId: parsed.data });
}

/* ---------- Member and seeker actions (ticket page) ---------- */

/** Leaving a team cancels the registration (lib/core/rsvpCancel.ts rate limits and revalidates). */
export async function leaveTeamAction(ticketToken: unknown): Promise<ActionResult<{ cancelled: true }>> {
  const parsed = ticketTokenSchema.safeParse(ticketToken);
  if (!parsed.success) return { ok: false, error: NOT_FOUND };
  const session = await auth();
  return leaveTeam(session?.user?.id ?? null, parsed.data);
}

/** Create, edit, or hide (`visible: false`) the holder's Looking for a team profile. */
export async function saveSeekerProfileAction(ticketToken: unknown, input: unknown): Promise<ActionResult> {
  const resolved = await resolveHolder(ticketToken);
  if (!resolved) return { ok: false, error: NOT_FOUND };
  if (await limited("action", `rsvp:${resolved.holder.rsvpId}`)) return { ok: false, error: TOO_MANY };
  return upsertSeekerProfile(resolved.holder, input);
}

/** A seeker asks to join a team that is looking for members. */
export async function requestToJoinTeamAction(ticketToken: unknown, teamId: unknown): Promise<ActionResult> {
  const resolved = await resolveHolder(ticketToken);
  if (!resolved) return { ok: false, error: NOT_FOUND };
  const parsed = idSchema.safeParse(teamId);
  if (!parsed.success) return { ok: false, error: "This team isn't looking for members." };
  if (await limited("invite", `rsvp:${resolved.holder.rsvpId}`)) return { ok: false, error: "Too many requests. Please try again later." };
  const result = await createJoinRequest({ direction: "REQUEST", seeker: resolved.holder, teamId: parsed.data });
  if (!result.ok) return result;
  await afterTeamChange({ eventId: resolved.holder.eventId, teamId: parsed.data, actorUserId: resolved.actorUserId, action: "TEAM_REQUEST_SENT", metadata: { requestId: result.data?.requestId ?? null } });
  return { ok: true };
}

/** A seeker answers a team's invitation. Accepting moves their registration into the team. */
export async function respondToTeamInviteAction(ticketToken: unknown, requestId: unknown, accept: unknown): Promise<ActionResult<{ accepted: boolean }>> {
  const resolved = await resolveHolder(ticketToken);
  if (!resolved) return { ok: false, error: NOT_FOUND };
  const parsed = idSchema.safeParse(requestId);
  if (!parsed.success || typeof accept !== "boolean") return { ok: false, error: "This invitation is no longer pending." };
  if (await limited("action", `rsvp:${resolved.holder.rsvpId}`)) return { ok: false, error: TOO_MANY };
  const result = await respondToJoinRequest({ actor: { kind: "seeker", holder: resolved.holder }, requestId: parsed.data, accept });
  if (result.ok) {
    await afterTeamChange({
      eventId: resolved.holder.eventId,
      actorUserId: resolved.actorUserId,
      action: accept ? "TEAM_INVITE_ACCEPTED" : "TEAM_INVITE_DECLINED",
      metadata: { requestId: parsed.data },
    });
  }
  return result;
}

/** A seeker withdraws a request they sent. */
export async function cancelTeamRequestAction(ticketToken: unknown, requestId: unknown): Promise<ActionResult> {
  const resolved = await resolveHolder(ticketToken);
  if (!resolved) return { ok: false, error: NOT_FOUND };
  const parsed = idSchema.safeParse(requestId);
  if (!parsed.success) return { ok: false, error: "This request is no longer pending." };
  if (await limited("action", `rsvp:${resolved.holder.rsvpId}`)) return { ok: false, error: TOO_MANY };
  return cancelJoinRequest({ actor: { kind: "seeker", holder: resolved.holder }, requestId: parsed.data });
}
