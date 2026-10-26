import "server-only";

import { EventPermission, RegistrationMode, RsvpStatus, type Prisma } from "@prisma/client";
import { loadAccountRegistrationRecords, canCancelRegistration, type NormalisedAccountRegistration } from "@/lib/accountRegistrations";
import { prisma } from "@/lib/db";
import { absoluteUrl, mobileUserSelect, toMyTeam, toUserDto } from "@/lib/mobile/dto";
import { meDtoSchema, myTeamResultDtoSchema, myTeamSchema, registrationsDtoSchema, type MyTeamDto } from "@/lib/mobile/schemas";

export async function loadMe(userId: string, baseUrl: string) {
  const [user, memberships, collaborations, judgeGrants] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: userId }, select: mobileUserSelect }),
    prisma.membership.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
      take: 200,
      select: { role: true, organisation: { select: { id: true, slug: true, name: true, logoUrl: true } } },
    }),
    prisma.eventCollaborator.findMany({
      where: { userId, eventId: { not: null } },
      orderBy: { createdAt: "desc" },
      take: 200,
      select: { permissions: true, event: { select: { id: true, title: true, organisation: { select: { slug: true, name: true } } } } },
    }),
    // Events this user judges through a JUDGE grant (resolveJudgeContext's
    // rule), once they take submissions. Organisation admins judge through
    // their role and see `myPermissions.judge` on the org event list instead.
    prisma.eventCollaborator.findMany({
      where: { userId, permissions: { has: EventPermission.JUDGE }, event: { is: { submissionsEnabled: true } } },
      orderBy: { createdAt: "desc" },
      take: 200,
      select: {
        event: {
          select: {
            id: true, title: true, startDateTime: true, endDateTime: true, timezone: true, judgingStatus: true,
            organisation: { select: { slug: true, name: true } },
          },
        },
      },
    }),
  ]);
  return meDtoSchema.parse({
    user: toUserDto(user, baseUrl),
    organisations: memberships.map((membership) => ({
      id: membership.organisation.id,
      slug: membership.organisation.slug,
      name: membership.organisation.name,
      logoUrl: absoluteUrl(membership.organisation.logoUrl, baseUrl),
      role: membership.role,
    })),
    // JUDGE is web-only (docs/HACKATHON.md) and not part of the mobile DTO:
    // drop it, and drop JUDGE-only grants entirely.
    collaborations: collaborations.flatMap((grant) => {
      const permissions = grant.permissions.filter((permission) => permission !== EventPermission.JUDGE);
      return grant.event && permissions.length > 0 ? [{
        organisation: { slug: grant.event.organisation.slug, name: grant.event.organisation.name },
        eventId: grant.event.id,
        eventTitle: grant.event.title,
        permissions,
      }] : [];
    }),
    judging: judgeGrants.flatMap((grant) => grant.event ? [{
      organisation: { slug: grant.event.organisation.slug, name: grant.event.organisation.name },
      eventId: grant.event.id,
      eventTitle: grant.event.title,
      startDateTime: grant.event.startDateTime.toISOString(),
      endDateTime: grant.event.endDateTime.toISOString(),
      timezone: grant.event.timezone,
      judgingStatus: grant.event.judgingStatus,
    }] : []),
  });
}

const myTeamSelect = {
  id: true,
  name: true,
  leaderRsvpId: true,
  event: { select: { teamMaxSize: true } },
  // Bounded by teamMaxSize; names only.
  members: { select: { id: true, guestName: true, user: { select: { name: true } } }, orderBy: [{ createdAt: "asc" as const }, { id: "asc" as const }] },
} satisfies Prisma.TeamSelect;

/** The caller's teams by team id (names only), for their own RSVPs. */
async function loadMyTeams(rsvps: Array<{ rsvpId: string; teamId: string }>): Promise<Map<string, MyTeamDto>> {
  const result = new Map<string, MyTeamDto>();
  if (rsvps.length === 0) return result;
  const teams = await prisma.team.findMany({ where: { id: { in: [...new Set(rsvps.map((row) => row.teamId))] } }, select: myTeamSelect });
  const byId = new Map(teams.map((team) => [team.id, team]));
  for (const { rsvpId, teamId } of rsvps) {
    const team = byId.get(teamId);
    // The invariant (a member RSVP is in its team's member list) is re-checked, so a stale id never shows another team.
    if (team && team.members.some((member) => member.id === rsvpId)) {
      result.set(rsvpId, myTeamSchema.parse(toMyTeam({ ...team, maxSize: team.event.teamMaxSize }, rsvpId)));
    }
  }
  return result;
}

/** GET /me/registrations/:rsvpId/team: the caller's own registration only (anyone else's is null → NOT_FOUND). */
export async function loadMyRegistrationTeam(userId: string, rsvpId: string): Promise<{ team: MyTeamDto | null } | null> {
  if (!rsvpId || rsvpId.length > 128) return null;
  const rsvp = await prisma.rSVP.findFirst({ where: { id: rsvpId, userId }, select: { id: true, teamId: true } });
  if (!rsvp) return null;
  if (!rsvp.teamId) return myTeamResultDtoSchema.parse({ team: null });
  const teams = await loadMyTeams([{ rsvpId: rsvp.id, teamId: rsvp.teamId }]);
  return myTeamResultDtoSchema.parse({ team: teams.get(rsvp.id) ?? null });
}

function registrationDto(item: NormalisedAccountRegistration, baseUrl: string, now: Date, team: MyTeamDto | undefined) {
  const { rsvp } = item;
  const event = rsvp.event;
  const instance = rsvp.eventInstance;
  const summary = event
    ? {
        id: event.id,
        slug: event.slug,
        title: event.title,
        coverImageUrl: absoluteUrl(event.coverImageUrl, baseUrl),
        startDateTime: event.startDateTime.toISOString(),
        endDateTime: event.endDateTime.toISOString(),
        timezone: event.timezone,
        location: event.location,
        mapLinkUrl: event.mapLinkUrl,
        isOnline: event.isOnline,
        accentColor: event.page?.accentColor ?? null,
        status: event.status,
        registrationMode: event.registrationMode,
        organisation: { slug: event.organisation.slug, name: event.organisation.name, logoUrl: absoluteUrl(event.organisation.logoUrl, baseUrl) },
      }
    : {
        // A recurring-series occurrence: the series identifies the event.
        id: instance!.series.id,
        slug: instance!.series.slug,
        title: instance!.series.title,
        coverImageUrl: null,
        startDateTime: instance!.startDateTime.toISOString(),
        endDateTime: instance!.endDateTime.toISOString(),
        timezone: instance!.series.timezone,
        location: "",
        mapLinkUrl: null,
        isOnline: false,
        accentColor: null,
        status: instance!.series.status,
        // Recurring series always register individually (docs/TEAMS.md).
        registrationMode: RegistrationMode.INDIVIDUAL,
        organisation: { slug: instance!.series.organisation.slug, name: instance!.series.organisation.name, logoUrl: absoluteUrl(instance!.series.organisation.logoUrl, baseUrl) },
      };
  return {
    rsvpId: rsvp.id,
    status: rsvp.status,
    checkedInAt: rsvp.checkedInAt?.toISOString() ?? null,
    registeredAt: rsvp.createdAt.toISOString(),
    canCancel: canCancelRegistration({ status: rsvp.status, checkedInAt: rsvp.checkedInAt, end: item.end }, now),
    // The ticket is the owner's own bearer capability, and only a confirmed place has one.
    ticketToken: rsvp.status === RsvpStatus.CONFIRMED ? rsvp.checkInToken : null,
    event: summary,
    instanceId: instance?.id ?? null,
    ...(team ? { team } : {}),
  };
}

export async function loadMyRegistrations(userId: string, baseUrl: string, now = new Date()) {
  const records = await loadAccountRegistrationRecords(userId, now);
  const teams = await loadMyTeams([...records.upcoming, ...records.past].flatMap((item) => item.rsvp.team ? [{ rsvpId: item.rsvp.id, teamId: item.rsvp.team.id }] : []));
  return registrationsDtoSchema.parse({
    upcoming: records.upcoming.map((item) => registrationDto(item, baseUrl, now, teams.get(item.rsvp.id))),
    past: records.past.map((item) => registrationDto(item, baseUrl, now, teams.get(item.rsvp.id))),
    certificates: records.certificates.map((certificate) => ({
      eventTitle: certificate.title,
      organisationName: certificate.organisationName,
      issuedAt: certificate.issuedAt.toISOString(),
      certificateUrl: absoluteUrl(certificate.certificateHref, baseUrl)!,
    })),
  });
}

