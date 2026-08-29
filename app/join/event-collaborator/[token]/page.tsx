import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { hashEventCollaboratorToken } from "@/lib/eventCollaboratorToken";

export default async function JoinEventCollaboratorPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const session = await auth();
  const url = `/join/event-collaborator/${encodeURIComponent(token)}`;
  if (!session?.user?.id) redirect(`/login?callbackUrl=${encodeURIComponent(url)}`);
  const invite = await prisma.eventCollaboratorInvite.findUnique({ where: { tokenHash: hashEventCollaboratorToken(token) }, include: { event: true, series: true } });
  if (!invite || invite.usedAt || invite.expiresAt <= new Date() || !session.user.email || session.user.email.trim().toLowerCase() !== invite.email) return <Stack spacing={2}><Typography variant="h5">Invite unavailable</Typography><Typography color="text.secondary">Sign in with the invited email, or ask an organiser for a new invite.</Typography></Stack>;
  await prisma.$transaction(async (tx) => {
    const fresh = await tx.eventCollaboratorInvite.findUnique({ where: { id: invite.id } });
    if (!fresh || fresh.usedAt) return;
    await tx.eventCollaborator.upsert({ where: invite.eventId ? { eventId_userId: { eventId: invite.eventId, userId: session.user.id } } : { eventSeriesId_userId: { eventSeriesId: invite.eventSeriesId!, userId: session.user.id } }, create: { eventId: invite.eventId, eventSeriesId: invite.eventSeriesId, userId: session.user.id, permissions: invite.permissions }, update: { permissions: invite.permissions } });
    await tx.eventCollaboratorInvite.update({ where: { id: invite.id }, data: { usedAt: new Date(), usedByUserId: session.user.id } });
  });
  const orgSlug = invite.event?.organisationId ? (await prisma.organisation.findUnique({ where: { id: invite.event.organisationId }, select: { slug: true } }))?.slug : invite.series ? (await prisma.organisation.findUnique({ where: { id: invite.series.organisationId }, select: { slug: true } }))?.slug : null;
  if (!orgSlug) return <Typography>Invite accepted.</Typography>;
  revalidatePath("/dashboard");
  const assignedHref = invite.eventId ? `/dashboard/${orgSlug}/event/${invite.eventId}` : `/dashboard/${orgSlug}/series/${invite.eventSeriesId}`;
  return <Stack spacing={2}><Typography variant="h5">You’re a co-organizer</Typography><Link href={assignedHref}><Button variant="contained">Open assigned {invite.eventId ? "event" : "series"}</Button></Link></Stack>;
}
