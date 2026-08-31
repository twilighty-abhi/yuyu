import { notFound } from "next/navigation";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { ContentVisibility } from "@prisma/client";
import { prisma } from "@/lib/db";
import { effectiveEventProgram } from "@/lib/eventProgram";
import { resolvePublicEventAccess } from "@/lib/publicEventAccess";
import { sanitizeRichText } from "@/lib/richText";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Event session" };

export default async function SessionPage({ params }: { params: Promise<{ orgSlug: string; eventSlug: string; sessionSlug: string }> }) {
  const { orgSlug, eventSlug, sessionSlug } = await params;
  const org = await prisma.organisation.findUnique({ where: { slug: orgSlug } });
  if (!org) notFound();
  const event = await prisma.event.findUnique({ where: { organisationId_slug: { organisationId: org.id, slug: eventSlug } }, include: { page: { select: { isPublished: true } } } });
  if (!event) notFound();
  const access = await resolvePublicEventAccess({ organisationId: org.id, eventId: event.id, status: event.status, privacyType: event.privacyType, websiteReleased: event.page?.isPublished ?? false });
  if (!access.allowed) notFound();
  const [session, programme] = await Promise.all([
    prisma.eventSession.findFirst({ where: { eventId: event.id, slug: sessionSlug, visibility: ContentVisibility.PUBLISHED }, include: { room: true, speakers: { include: { speaker: true }, orderBy: { sortOrder: "asc" } }, resources: { where: { visibility: ContentVisibility.PUBLISHED } } } }),
    prisma.eventSession.findMany({ where: { eventId: event.id, visibility: ContentVisibility.PUBLISHED }, select: { id: true, startDateTime: true, endDateTime: true, sortOrder: true, delayMinutes: true } }),
  ]);
  if (!session) notFound();
  const effective = effectiveEventProgram(programme).find((item) => item.id === session.id);
  if (!effective) notFound();
  return <Stack spacing={2} sx={{ maxWidth: 800, py: 4 }}><Typography component="a" href={`/${org.slug}/${event.slug}`} color="primary">{event.title}</Typography><Typography variant="h3">{session.title}</Typography><Typography color="text.secondary">{effective.effectiveStartDateTime.toLocaleString(undefined, { timeZone: event.timezone })} · {session.room?.name ?? "Room TBA"}</Typography><Typography component="div" dangerouslySetInnerHTML={{ __html: sanitizeRichText(session.descriptionHtml) }} />{session.speakers.length ? <><Typography variant="h5">Speakers</Typography>{session.speakers.filter((item) => item.speaker.visibility === ContentVisibility.PUBLISHED).map(({ speaker }) => <Typography key={speaker.id} component="a" href={`/${org.slug}/${event.slug}/speakers/${speaker.slug}`}>{speaker.name}</Typography>)}</> : null}</Stack>;
}
