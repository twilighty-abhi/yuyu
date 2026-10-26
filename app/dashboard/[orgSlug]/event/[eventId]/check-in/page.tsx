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
import { CheckInListDesk } from "@/components/checkin/CheckInListDesk";
import { CheckInListSwitcher } from "@/components/checkin/CheckInListSwitcher";
import { loadCheckInListRosterPage, loadCheckInLists } from "@/lib/eventDashboard/checkInLists";
import { listRecentCheckIns } from "@/lib/checkInRecent";

type Props = {
  params: Promise<{ orgSlug: string; eventId: string }>;
  searchParams: Promise<{ list?: string | string[] }>;
};

export const metadata = { title: "Event check-in", robots: { index: false, follow: false } };

export default async function EventCheckInPage({ params, searchParams }: Props) {
  const { orgSlug, eventId } = await params;
  const { list: listParam } = await searchParams;
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

  const grant = isAdmin
    ? null
    : await prisma.eventCollaborator.findFirst({ where: { eventId: event.id, userId: access.userId }, select: { permissions: true } });
  const capabilities = eventCapabilities(access.membership?.role ?? null, grant?.permissions ?? []);
  const header = (
    <EventManageHeader
      back={{ href: `/dashboard/${organisation.slug}/event/${event.id}`, label: "Back to event" }}
      event={{ title: event.title, status: event.status, privacyType: event.privacyType, startDateTime: event.startDateTime, timezone: event.timezone, accentColor: event.page?.accentColor }}
    />
  );

  // Custom check-in lists: "Entry" is the unchanged desk below; a selected
  // open list swaps in its own desk. Archived lists are hidden from the desk.
  const lists = await loadCheckInLists(event.id);
  const openLists = lists.filter((list) => !list.archived);
  const selectedId = typeof listParam === "string" ? listParam : null;
  const selectedList = selectedId ? openLists.find((list) => list.id === selectedId) ?? null : null;
  const deskPath = `/dashboard/${organisation.slug}/event/${event.id}/check-in`;
  const switcher = openLists.length > 0 || capabilities.canManageCheckInLists ? (
    <CheckInListSwitcher
      deskPath={deskPath}
      lists={openLists}
      selectedId={selectedList?.id ?? null}
      manage={capabilities.canManageCheckInLists ? { organisationSlug: organisation.slug, eventId: event.id, lists } : null}
    />
  ) : null;

  if (selectedList) {
    const roster = await loadCheckInListRosterPage(event.id, selectedList);
    return (
      <div className="flex flex-col gap-6">
        {header}
        {switcher}
        <CheckInListDesk
          key={selectedList.id}
          organisationSlug={organisation.slug}
          eventId={event.id}
          timeZone={event.timezone}
          list={selectedList}
          initialRoster={roster}
        />
      </div>
    );
  }

  const [confirmed, checkedInCount, recentPage, registrationForm] = await Promise.all([
    prisma.rSVP.count({
      where: { eventId: event.id, status: "CONFIRMED" },
    }),
    prisma.rSVP.count({
      where: { eventId: event.id, checkedInAt: { not: null } },
    }),
    // The first page of Recent check-ins; "Load more" pages through loadRecentCheckIns.
    listRecentCheckIns(event.id),
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

  const origin = await getRequestOrigin();
  const stationUrl = `${origin}/${organisation.slug}/${event.slug}/check-in`;
  return (
    <div className="flex flex-col gap-6">
      {header}
      {switcher}
      <EventCheckInClient
        organisationSlug={organisation.slug}
        organisationName={organisation.name}
        organisationLogoUrl={organisationBrand?.logoUrl ?? null}
        eventId={event.id}
        eventTitle={event.title}
        registrationFields={registrationForm?.fields ?? []}
        teamEvent={event.registrationMode === "TEAM"}
        stats={{ confirmed, checkedIn: checkedInCount }}
        recent={recentPage.rows}
        recentNextCursor={recentPage.nextCursor}
        attendeeExportHref={capabilities.canExportAttendees ? `/api/exports/events/${event.id}/attendees` : null}
      />
      {capabilities.canManageCheckInStation ? <CheckInStationSettings organisationSlug={organisation.slug} eventId={event.id} stationUrl={stationUrl} enabled={Boolean(event.checkInStationPinHash)} /> : null}
    </div>
  );
}
