import { notFound } from "next/navigation";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { prisma } from "@/lib/db";
import { effectiveSchedule } from "@/lib/schedule";
import { LiveSchedule } from "@/components/schedule/LiveSchedule";

export default async function EventSchedulePage({ params }: { params: Promise<{ orgSlug: string; eventSlug: string }> }) { const { orgSlug, eventSlug } = await params; const org = await prisma.organisation.findUnique({ where: { slug: orgSlug } }); if (!org) notFound(); const event = await prisma.event.findUnique({ where: { organisationId_slug: { organisationId: org.id, slug: eventSlug } }, include: { scheduleItems: { orderBy: { sortOrder: "asc" } } } }); if (!event || event.status === "DRAFT" || event.privacyType === "INVITE_ONLY") notFound(); const items = effectiveSchedule(event.scheduleItems).map((i) => ({ ...i, effectiveStart: i.effectiveStart.toISOString(), effectiveEnd: i.effectiveEnd.toISOString() })); return <Stack spacing={3} sx={{ maxWidth: 800, py: 2 }}><Typography variant="overline">{org.name}</Typography><Typography variant="h3">{event.title} schedule</Typography><LiveSchedule items={items} timeZone={event.timezone} /></Stack>; }
