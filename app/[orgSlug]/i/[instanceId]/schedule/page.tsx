import { notFound } from "next/navigation";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { prisma } from "@/lib/db";
import { effectiveSchedule } from "@/lib/schedule";
import { LiveSchedule } from "@/components/schedule/LiveSchedule";

export default async function InstanceSchedulePage({ params }: { params: Promise<{ orgSlug: string; instanceId: string }> }) { const { orgSlug, instanceId } = await params; const org = await prisma.organisation.findUnique({ where: { slug: orgSlug } }); if (!org) notFound(); const instance = await prisma.eventInstance.findFirst({ where: { id: instanceId, series: { organisationId: org.id } }, include: { series: { include: { scheduleItems: { orderBy: { sortOrder: "asc" } } } } } }); if (!instance || instance.series.status === "DRAFT" || instance.series.privacyType === "INVITE_ONLY") notFound(); const items = effectiveSchedule(instance.series.scheduleItems).map((i) => ({ ...i, effectiveStart: i.effectiveStart.toISOString(), effectiveEnd: i.effectiveEnd.toISOString() })); return <Stack spacing={3} sx={{ maxWidth: 800, py: 2 }}><Typography variant="overline">{org.name}</Typography><Typography variant="h3">{instance.series.title} schedule</Typography><LiveSchedule items={items} timeZone={instance.series.timezone} /></Stack>; }
