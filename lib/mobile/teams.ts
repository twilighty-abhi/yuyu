import "server-only";

import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  countEventTeamsForOrganiser,
  listEventTeamsForOrganiser,
  resolveOrganiserEvent,
  type OrganiserEventContext,
  type OrganiserTeamFilter,
} from "@/lib/core/teams";
import { toOrganiserTeam } from "@/lib/mobile/dto";
import { organiserTeamSchema, teamListDtoSchema } from "@/lib/mobile/schemas";
import type { MobileEventContext } from "@/lib/mobile/organiser";

/*
 * Organiser Teams view for the mobile apps (docs/MOBILE_API.md, docs/TEAMS.md).
 * The permission is the web Teams view's: `canManageRegistrationsFor`
 * (OWNER/ADMIN or the event's MANAGE_REGISTRATIONS grant), resolved through
 * the same `resolveOrganiserEvent`. Paging, search and filters run in the
 * shared query (`listEventTeamsForOrganiser`); this file only maps the
 * mobile filter names and the DTO.
 */

export const TEAM_STATUS_FILTERS = ["ALL", "CONFIRMED", "WAITLISTED", "PENDING_APPROVAL", "REJECTED", "INCOMPLETE", "LOOKING"] as const;
export type TeamStatusFilter = (typeof TEAM_STATUS_FILTERS)[number];

const FILTER_TO_CORE: Record<TeamStatusFilter, OrganiserTeamFilter> = {
  ALL: "all",
  CONFIRMED: "going",
  WAITLISTED: "waitlist",
  PENDING_APPROVAL: "approve",
  REJECTED: "declined",
  INCOMPLETE: "incomplete",
  LOOKING: "looking",
};

export const teamListQuerySchema = z.object({
  status: z.enum(TEAM_STATUS_FILTERS).default("ALL"),
  q: z.string().trim().max(100).optional(),
  cursor: z.string().trim().min(1).max(160).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
}).strict();

export type TeamListQuery = z.infer<typeof teamListQuerySchema>;

/** The Teams-view organiser for this event, or null (the caller lacks canManageRegistrationsFor). */
export function resolveTeamOrganiser(userId: string, event: MobileEventContext): Promise<OrganiserEventContext | null> {
  return resolveOrganiserEvent(userId, event.organisation.slug, event.event.id);
}

export async function listTeamsForMobile(ctx: OrganiserEventContext, query: TeamListQuery) {
  const [page, counts] = await Promise.all([
    listEventTeamsForOrganiser(ctx, { query: query.q ?? "", filter: FILTER_TO_CORE[query.status], cursor: query.cursor ?? null }, { pageSize: query.limit }),
    countEventTeamsForOrganiser(ctx),
  ]);
  return teamListDtoSchema.parse({
    teams: page.teams.map(toOrganiserTeam),
    nextCursor: page.nextCursor,
    counts: {
      ALL: counts.all,
      CONFIRMED: counts.going,
      WAITLISTED: counts.waitlist,
      PENDING_APPROVAL: counts.approve,
      REJECTED: counts.declined,
      INCOMPLETE: counts.incomplete,
      LOOKING: counts.looking,
    },
  });
}

/** One team of this event after a status change (same fields as the list), or null. */
export async function loadTeamForMobile(ctx: OrganiserEventContext, teamId: string) {
  if (!teamId || teamId.length > 128) return null;
  const team = await prisma.team.findFirst({
    where: { id: teamId, eventId: ctx.eventId, event: { organisationId: ctx.organisationId } },
    select: {
      id: true,
      name: true,
      status: true,
      lookingForMembers: true,
      createdAt: true,
      leaderRsvpId: true,
      event: { select: { teamMinSize: true, teamMaxSize: true } },
      members: {
        select: { id: true, guestName: true, checkedInAt: true, user: { select: { name: true } } },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      },
    },
  });
  if (!team) return null;
  const size = team.members.length;
  return organiserTeamSchema.parse(toOrganiserTeam({
    id: team.id,
    name: team.name,
    status: team.status,
    size,
    minSize: team.event.teamMinSize,
    maxSize: team.event.teamMaxSize,
    incomplete: team.event.teamMinSize != null && size < team.event.teamMinSize,
    lookingForMembers: team.lookingForMembers,
    createdAt: team.createdAt,
    leaderRsvpId: team.leaderRsvpId,
    members: team.members.map((member) => ({
      rsvpId: member.id,
      name: member.user?.name?.trim() || member.guestName?.trim() || "Guest",
      email: null,
      isLeader: member.id === team.leaderRsvpId,
      checkedIn: member.checkedInAt != null,
    })),
  }));
}
