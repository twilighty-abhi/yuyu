import "server-only";

import { EventPermission, RsvpStatus } from "@prisma/client";
import { loadAccountRegistrationRecords, canCancelRegistration, type NormalisedAccountRegistration } from "@/lib/accountRegistrations";
import { prisma } from "@/lib/db";
import { absoluteUrl, mobileUserSelect, toUserDto } from "@/lib/mobile/dto";
import { meDtoSchema, registrationsDtoSchema } from "@/lib/mobile/schemas";

export async function loadMe(userId: string, baseUrl: string) {
  const [user, memberships, collaborations] = await Promise.all([
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
  });
}

function registrationDto(item: NormalisedAccountRegistration, baseUrl: string, now: Date) {
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
  };
}

export async function loadMyRegistrations(userId: string, baseUrl: string, now = new Date()) {
  const records = await loadAccountRegistrationRecords(userId, now);
  return registrationsDtoSchema.parse({
    upcoming: records.upcoming.map((item) => registrationDto(item, baseUrl, now)),
    past: records.past.map((item) => registrationDto(item, baseUrl, now)),
    certificates: records.certificates.map((certificate) => ({
      eventTitle: certificate.title,
      organisationName: certificate.organisationName,
      issuedAt: certificate.issuedAt.toISOString(),
      certificateUrl: absoluteUrl(certificate.certificateHref, baseUrl)!,
    })),
  });
}

