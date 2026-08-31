import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { notFound } from "next/navigation";
import { EventProgramScheduleManager } from "@/components/event/EventProgramScheduleManager";
import { prisma } from "@/lib/db";
import { canViewEventDashboard } from "@/lib/eventAccess";
import { effectiveEventProgram } from "@/lib/eventProgram";
import { requireOrgDashboardAccess } from "@/lib/permissions";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Manage event schedule", robots: { index: false, follow: false } };

export default async function EventScheduleManagePage({ params }: { params: Promise<{ orgSlug: string; eventId: string }> }) {
  const { orgSlug, eventId } = await params;
  const access = await requireOrgDashboardAccess(orgSlug);
  const event = await prisma.event.findFirst({ where: { id: eventId, organisationId: access.organisation.id }, include: { sessions: { include: { speakers: { include: { speaker: { select: { id: true, name: true } } } } }, orderBy: [{ startDateTime: "asc" }, { sortOrder: "asc" }] }, speakers: { select: { id: true, name: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] } } });
  if (!event) notFound();
  if (!access.membership && !(await canViewEventDashboard({ userId: access.userId, organisationId: access.organisation.id, eventId: event.id }))) notFound();
  const sessions = effectiveEventProgram(event.sessions).map((session) => ({ id: session.id, title: session.title, startDateTime: session.startDateTime.toISOString(), endDateTime: session.endDateTime.toISOString(), effectiveStartDateTime: session.effectiveStartDateTime.toISOString(), effectiveEndDateTime: session.effectiveEndDateTime.toISOString(), type: session.type, track: session.track, roomId: session.roomId, visibility: session.visibility, sortOrder: session.sortOrder, delayMinutes: session.delayMinutes, cumulativeDelayMinutes: session.cumulativeDelayMinutes, speakerIds: session.speakers.map((speaker) => speaker.speakerId), speakerNames: session.speakers.map((speaker) => speaker.speaker.name) }));
  return <Stack spacing={3}><Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ alignItems: { sm: "center" }, justifyContent: "space-between" }}><div><Typography variant="h4" component="h1">{event.title} schedule</Typography><Typography color="text.secondary">Plan sessions and manage live timing changes.</Typography></div><Button href={`/dashboard/${access.organisation.slug}/event/${event.id}`} startIcon={<ArrowBackIcon />}>Back to event</Button></Stack><EventProgramScheduleManager organisationSlug={access.organisation.slug} eventId={event.id} eventStart={event.startDateTime.toISOString()} timeZone={event.timezone} sessions={sessions} speakers={event.speakers} /></Stack>;
}
