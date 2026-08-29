import Link from "next/link";
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

export default async function EventScheduleManagePage({ params }: { params: Promise<{ orgSlug: string; eventId: string }> }) {
  const { orgSlug, eventId } = await params;
  const access = await requireOrgDashboardAccess(orgSlug);
  const event = await prisma.event.findFirst({ where: { id: eventId, organisationId: access.organisation.id }, include: { sessions: { include: { speakers: true }, orderBy: [{ startDateTime: "asc" }, { sortOrder: "asc" }] } } });
  if (!event) notFound();
  if (!access.membership && !(await canViewEventDashboard({ userId: access.userId, organisationId: access.organisation.id, eventId: event.id }))) notFound();
  const sessions = effectiveEventProgram(event.sessions).map((session) => ({ id: session.id, title: session.title, startDateTime: session.startDateTime.toISOString(), endDateTime: session.endDateTime.toISOString(), effectiveStartDateTime: session.effectiveStartDateTime.toISOString(), effectiveEndDateTime: session.effectiveEndDateTime.toISOString(), type: session.type, track: session.track, roomId: session.roomId, visibility: session.visibility, sortOrder: session.sortOrder, delayMinutes: session.delayMinutes, cumulativeDelayMinutes: session.cumulativeDelayMinutes, speakerIds: session.speakers.map((speaker) => speaker.speakerId) }));
  return <Stack spacing={3}><Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ alignItems: { sm: "center" }, justifyContent: "space-between" }}><div><Typography variant="h4" component="h1">{event.title} schedule</Typography><Typography color="text.secondary">Plan sessions and manage live timing changes.</Typography></div><Button component={Link} href={`/dashboard/${access.organisation.slug}/event/${event.id}`} startIcon={<ArrowBackIcon />}>Back to event</Button></Stack><EventProgramScheduleManager organisationSlug={access.organisation.slug} eventId={event.id} timeZone={event.timezone} sessions={sessions} /></Stack>;
}
