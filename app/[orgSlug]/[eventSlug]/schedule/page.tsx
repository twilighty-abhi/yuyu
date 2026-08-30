import Link from "next/link";
import { Stack, Typography } from "@mui/material";
import { notFound } from "next/navigation";
import { ContentVisibility } from "@prisma/client";
import { prisma } from "@/lib/db";
import { effectiveEventProgram } from "@/lib/eventProgram";
import { resolvePublicEventAccess } from "@/lib/publicEventAccess";

export default async function EventSchedulePage({ params }: { params: Promise<{ orgSlug: string; eventSlug: string }> }) {
  const { orgSlug, eventSlug } = await params;
  const org = await prisma.organisation.findUnique({ where: { slug: orgSlug } });
  if (!org) notFound();
  const event = await prisma.event.findUnique({ where: { organisationId_slug: { organisationId: org.id, slug: eventSlug } }, include: { page: { select: { isPublished: true } }, sessions: { where: { visibility: ContentVisibility.PUBLISHED }, include: { room: true }, orderBy: [{ startDateTime: "asc" }, { sortOrder: "asc" }] } } });
  if (!event) notFound();
  const access = await resolvePublicEventAccess({ organisationId: org.id, eventId: event.id, status: event.status, privacyType: event.privacyType, websiteReleased: event.page?.isPublished ?? false });
  if (!access.allowed) notFound();
  const sessions = effectiveEventProgram(event.sessions);
  return <Stack spacing={2} sx={{ maxWidth: 800, py: 2 }}><Typography variant="overline">{org.name}</Typography><Typography variant="h3">{event.title} program</Typography>{sessions.map((session) => <Stack key={session.id} component={Link} href={`/${org.slug}/${event.slug}/sessions/${session.slug}`} sx={{ p: 2, color: "text.primary", textDecoration: "none", border: 1, borderColor: "divider", borderRadius: 2 }}><Typography sx={{ fontWeight: 700 }}>{session.title}</Typography><Typography variant="body2">{session.effectiveStartDateTime.toLocaleString(undefined, { timeZone: event.timezone })} · {session.room?.name ?? "Room TBA"}</Typography></Stack>)}</Stack>;
}
