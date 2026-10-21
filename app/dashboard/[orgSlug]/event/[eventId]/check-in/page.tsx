import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { EventPermission } from "@prisma/client";
import { isOrgAdmin, requireOrgDashboardAccess } from "@/lib/permissions";
import { canAccessEvent } from "@/lib/eventAccess";
import { eventCapabilities } from "@/lib/eventDashboard/capabilities";
import { EventCheckInClient } from "@/components/checkin/EventCheckInClient";
import { CheckInStationSettings } from "@/components/checkin/CheckInStationSettings";
import { getRequestOrigin } from "@/lib/publicUrl";
import { EventManageHeader } from "@/components/dashboard/EventManageHeader";

type Props = {
  params: Promise<{ orgSlug: string; eventId: string }>;
};

export const metadata = { title: "Event check-in", robots: { index: false, follow: false } };

function labelAttendee(r: {
  user: { name: string | null; email: string | null } | null;
  guestEmail: string | null;
}) {
  const name = r.user?.name?.trim();
  if (name) return name;
  const email = r.user?.email ?? r.guestEmail;
  return email ?? "Guest";
}

export default async function EventCheckInPage({ params }: Props) {
  const { orgSlug, eventId } = await params;
  const access = await requireOrgDashboardAccess(orgSlug);
  const { organisation } = access;

  const [event, organisationBrand] = await Promise.all([
    prisma.event.findFirst({
      where: { id: eventId, organisationId: organisation.id },
      include: { page: { select: { accentColor: true } } },
    }),
    prisma.organisation.findUnique({
      where: { id: organisation.id },
      select: { logoUrl: true },
    }),
  ]);
  if (!event) notFound();
  const isAdmin = Boolean(access.membership && isOrgAdmin(access.membership.role));
  if (!isAdmin && !(await canAccessEvent({ userId: access.userId, organisationId: organisation.id, eventId: event.id, permission: EventPermission.CHECK_IN }))) notFound();

  const [confirmed, checkedInCount, recentRsvps, registrationForm] = await Promise.all([
    prisma.rSVP.count({
      where: { eventId: event.id, status: "CONFIRMED" },
    }),
    prisma.rSVP.count({
      where: { eventId: event.id, checkedInAt: { not: null } },
    }),
    prisma.rSVP.findMany({
      where: { eventId: event.id, checkedInAt: { not: null } },
      orderBy: { checkedInAt: "desc" },
      take: 200,
      include: { user: { select: { name: true, email: true } } },
    }),
    prisma.eventRegistrationForm.findUnique({
      where: { eventId: event.id },
      select: {
        fields: {
          select: { key: true, label: true },
          orderBy: { sortOrder: "asc" },
        },
      },
    }),
  ]);

  const recent = recentRsvps.map((r) => ({
    rsvpId: r.id,
    displayName: labelAttendee(r),
    email: r.user?.email ?? r.guestEmail,
    checkedInAt: r.checkedInAt!.toISOString(),
  }));

  const origin = await getRequestOrigin();
  const stationUrl = `${origin}/${organisation.slug}/${event.slug}/check-in`;
  return (
    <div className="flex flex-col gap-6">
      <EventManageHeader
        back={{ href: `/dashboard/${organisation.slug}/event/${event.id}`, label: "Back to event" }}
        event={{ title: event.title, status: event.status, privacyType: event.privacyType, startDateTime: event.startDateTime, timezone: event.timezone, accentColor: event.page?.accentColor }}
      />
      <EventCheckInClient
        organisationSlug={organisation.slug}
        organisationName={organisation.name}
        organisationLogoUrl={organisationBrand?.logoUrl ?? null}
        eventId={event.id}
        eventTitle={event.title}
        registrationFields={registrationForm?.fields ?? []}
        stats={{ confirmed, checkedIn: checkedInCount }}
        recent={recent}
      />
      {eventCapabilities(access.membership?.role, []).canManageCheckInStation ? <CheckInStationSettings organisationSlug={organisation.slug} eventId={event.id} stationUrl={stationUrl} enabled={Boolean(event.checkInStationPinHash)} /> : null}
    </div>
  );
}
