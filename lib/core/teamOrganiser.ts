import "server-only";

import type { RsvpStatus } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { recordAuditEvent } from "@/lib/audit";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import { resolveOrganiserEvent, transitionTeamStatus, type OrganiserEventContext, type TeamTransition } from "@/lib/core/teams";
import type { ActionResult } from "@/app/actions/org";

/*
 * The organiser gate and whole-team status changes shared by the Guests →
 * Teams Server Actions (app/actions/team-admin.ts) and the mobile API
 * (/api/mobile/v1/orgs/:org/events/:id/teams/:teamId/{approve,reject,promote}).
 * The permission is the one that guards the individual RSVP lifecycle
 * (`canManageRegistrationsFor`, via resolveOrganiserEvent), on the same "rsvp"
 * rate-limit bucket. The rules, the Event lock and the re-read of the team
 * inside its event live in lib/core/teams.ts.
 */

export const TEAM_ORGANISER_NO_PERMISSION = "You do not have permission to manage attendees.";

export type TeamOrganiserGate = { ok: true; ctx: OrganiserEventContext } | { ok: false; error: string };

export async function teamOrganiserGate(userId: string | null | undefined, organisationSlug: string, eventId: string): Promise<TeamOrganiserGate> {
  if (!userId) return { ok: false, error: "You must be signed in." };
  if (await isActionRateLimited("rsvp", userId)) return { ok: false, error: "Too many attendee updates. Try again shortly." };
  const ctx = await resolveOrganiserEvent(userId, organisationSlug, eventId);
  if (!ctx) return { ok: false, error: TEAM_ORGANISER_NO_PERMISSION };
  return { ok: true, ctx };
}

export function revalidateTeamPaths(ctx: OrganiserEventContext) {
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

/**
 * Approve, reject or promote a whole team for a signed-in organiser: gate,
 * transition (one transaction for the team and every member), audit and
 * revalidation. Refusals keep the core's message and machine-readable `code`.
 */
export async function transitionTeamStatusForUser(
  userId: string | null | undefined,
  input: { organisationSlug: string; eventId: string; teamId: string },
  action: TeamTransition,
): Promise<ActionResult<{ status: RsvpStatus }>> {
  const gate = await teamOrganiserGate(userId, input.organisationSlug, input.eventId);
  if (!gate.ok) return gate;
  const result = await transitionTeamStatus(gate.ctx, input.teamId, action);
  if (!result.ok) return result;
  await recordAuditEvent({
    action: TRANSITION_AUDIT[action],
    actorUserId: gate.ctx.userId,
    organisationId: gate.ctx.organisationId,
    targetType: "Team",
    targetId: input.teamId,
    metadata: { eventId: gate.ctx.eventId },
  });
  revalidateTeamPaths(gate.ctx);
  return result;
}
