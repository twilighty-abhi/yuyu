import "server-only";

import { cache } from "react";
import { RsvpStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { listEventTeamsForOrganiser } from "@/lib/core/teams";
import type { EventDashboardContext } from "@/lib/eventDashboard/context";

/*
 * Team registration data for the event dashboard (docs/TEAMS.md). Callers
 * must have checked `ctx.permissions.canManageRegistrations` (the same
 * organisation-admin check as the RSVP lifecycle actions) before calling the
 * guest-level loaders. Names and emails only; never tokens.
 */

/** One team as the Guests → Teams view receives it. */
export type DashboardTeam = {
  id: string;
  name: string;
  status: RsvpStatus;
  size: number;
  minSize: number | null;
  maxSize: number | null;
  incomplete: boolean;
  lookingForMembers: boolean;
  createdAt: string;
  members: Array<{ rsvpId: string; name: string; email: string | null; isLeader: boolean; checkedIn: boolean }>;
};

/** Every team of the event, oldest first (organisation admins only). */
export const loadEventTeams = cache(async (ctx: EventDashboardContext): Promise<DashboardTeam[]> => {
  const teams = await listEventTeamsForOrganiser({
    userId: ctx.userId,
    organisationId: ctx.organisation.id,
    orgSlug: ctx.organisation.slug,
    eventId: ctx.event.id,
    eventSlug: ctx.event.slug,
  });
  return teams.map((team) => ({
    id: team.id,
    name: team.name,
    status: team.status,
    size: team.size,
    minSize: team.minSize,
    maxSize: team.maxSize,
    incomplete: team.incomplete,
    lookingForMembers: team.lookingForMembers,
    createdAt: team.createdAt.toISOString(),
    members: team.members,
  }));
});

/**
 * What the Publishing settings need to know: whether anyone has registered
 * (the registration mode is then locked) and the largest team's size (the
 * maximum can't go below it). Counts only.
 */
export const loadRegistrationLock = cache(async (eventId: string): Promise<{ total: number; largestTeam: number }> => {
  const [total, largest] = await Promise.all([
    prisma.rSVP.count({ where: { eventId } }),
    prisma.rSVP.groupBy({
      by: ["teamId"],
      where: { eventId, teamId: { not: null } },
      _count: { _all: true },
      orderBy: { _count: { teamId: "desc" } },
      take: 1,
    }),
  ]);
  return { total, largestTeam: largest[0]?._count._all ?? 0 };
});

/** A pending approval request on the Overview: one solo registrant or one whole team (one unit). */
export type PendingUnit =
  | { kind: "rsvp"; id: string; name: string; createdAt: string }
  | { kind: "team"; id: string; name: string; size: number; createdAt: string };

/**
 * Pending approval requests counted as units for a TEAM event: each pending
 * team once, plus each pending solo registrant. Oldest first.
 */
export const loadPendingUnits = cache(async (eventId: string, take = 5): Promise<{ units: PendingUnit[]; total: number; teams: number; solos: number }> => {
  const [teams, solos, teamCount, soloCount] = await Promise.all([
    prisma.team.findMany({
      where: { eventId, status: RsvpStatus.PENDING_APPROVAL },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take,
      select: { id: true, name: true, createdAt: true, _count: { select: { members: true } } },
    }),
    prisma.rSVP.findMany({
      where: { eventId, teamId: null, status: RsvpStatus.PENDING_APPROVAL },
      orderBy: { createdAt: "asc" },
      take,
      select: { id: true, guestName: true, guestEmail: true, createdAt: true, user: { select: { name: true, email: true } } },
    }),
    prisma.team.count({ where: { eventId, status: RsvpStatus.PENDING_APPROVAL } }),
    prisma.rSVP.count({ where: { eventId, teamId: null, status: RsvpStatus.PENDING_APPROVAL } }),
  ]);
  const units: PendingUnit[] = [
    ...teams.map((team) => ({ kind: "team" as const, id: team.id, name: team.name, size: team._count.members, createdAt: team.createdAt.toISOString() })),
    ...solos.map((row) => ({
      kind: "rsvp" as const,
      id: row.id,
      name: row.user?.name?.trim() || row.guestName?.trim() || row.user?.email || row.guestEmail || "Guest",
      createdAt: row.createdAt.toISOString(),
    })),
  ];
  units.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return { units: units.slice(0, take), total: teamCount + soloCount, teams: teamCount, solos: soloCount };
});
