import { notFound } from "next/navigation";
import { EventProgramScheduleManager } from "@/components/event/EventProgramScheduleManager";
import { EventManageHeader } from "@/components/dashboard/EventManageHeader";
import { SectionHeading } from "@/components/ui/display";
import { prisma } from "@/lib/db";
import { canAccessEvent, canViewEventDashboard } from "@/lib/eventAccess";
import { EventPermission } from "@prisma/client";
import { effectiveEventProgram } from "@/lib/eventProgram";
import { conflictingTrackSessionIds } from "@/lib/eventProgram";
import { requireOrgDashboardAccess } from "@/lib/permissions";
import type { Metadata } from "next";
import { HelpLink } from "@/components/help/HelpLink";

export const metadata: Metadata = { title: "Manage event schedule", robots: { index: false, follow: false } };

export default async function EventScheduleManagePage({ params }: { params: Promise<{ orgSlug: string; eventId: string }> }) {
  const { orgSlug, eventId } = await params;
  const access = await requireOrgDashboardAccess(orgSlug);
  const event = await prisma.event.findFirst({ where: { id: eventId, organisationId: access.organisation.id }, include: { page: { select: { accentColor: true } }, scheduleTracks: { orderBy: { sortOrder: "asc" } }, sessions: { include: { speakers: { include: { speaker: { select: { id: true, name: true } } } } }, orderBy: [{ startDateTime: "asc" }, { sortOrder: "asc" }] }, speakers: { select: { id: true, name: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] } } });
  if (!event) notFound();
  if (!access.membership && !(await canViewEventDashboard({ userId: access.userId, organisationId: access.organisation.id, eventId: event.id }))) notFound();
  if (!(await canAccessEvent({ userId: access.userId, organisationId: access.organisation.id, eventId: event.id, permission: EventPermission.PUBLISH_AND_SCHEDULE }))) notFound();
  const conflictIds = conflictingTrackSessionIds(event.sessions);
  const sessions = effectiveEventProgram(event.sessions).map((session) => ({ id: session.id, trackId: session.trackId, title: session.title, descriptionHtml: session.descriptionHtml, startDateTime: session.startDateTime.toISOString(), endDateTime: session.endDateTime.toISOString(), effectiveStartDateTime: session.effectiveStartDateTime.toISOString(), effectiveEndDateTime: session.effectiveEndDateTime.toISOString(), type: session.type, visibility: session.visibility, sortOrder: session.sortOrder, delayMinutes: session.delayMinutes, cumulativeDelayMinutes: session.cumulativeDelayMinutes, speakerIds: session.speakers.map((speaker) => speaker.speakerId), speakerNames: session.speakers.map((speaker) => speaker.speaker.name), hasConflict: conflictIds.has(session.id) }));
  return (
    <div className="flex flex-col gap-6">
      <EventManageHeader
        back={{ href: `/dashboard/${access.organisation.slug}/event/${event.id}`, label: "Back to event" }}
        event={{ title: event.title, status: event.status, privacyType: event.privacyType, startDateTime: event.startDateTime, timezone: event.timezone, accentColor: event.page?.accentColor }}
      />
      <SectionHeading as="h2" title="Programme schedule" description="Plan parallel tracks and manage live timing changes independently." action={<HelpLink article="event-page/programme" />} />
      <EventProgramScheduleManager organisationSlug={access.organisation.slug} eventId={event.id} eventStart={event.startDateTime.toISOString()} timeZone={event.timezone} tracks={event.scheduleTracks} sessions={sessions} speakers={event.speakers} />
    </div>
  );
}
