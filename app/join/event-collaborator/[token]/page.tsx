import { redirect } from "next/navigation";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { hashEventCollaboratorToken } from "@/lib/eventCollaboratorToken";
import { AcceptInviteButton } from "@/components/invites/AcceptInviteButton";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Co-organizer invitation", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function JoinEventCollaboratorPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const session = await auth();
  const url = `/join/event-collaborator/${encodeURIComponent(token)}`;
  if (!session?.user?.id) redirect(`/login?callbackUrl=${encodeURIComponent(url)}`);
  const invite = await prisma.eventCollaboratorInvite.findUnique({
    where: { tokenHash: hashEventCollaboratorToken(token) },
    select: { email: true, usedAt: true, expiresAt: true, event: { select: { title: true } }, series: { select: { title: true } } },
  });
  if (!invite || invite.usedAt || invite.expiresAt <= new Date() || !session.user.email || session.user.email.trim().toLowerCase() !== invite.email.trim().toLowerCase()) {
    return <Stack spacing={2}><Typography variant="h5" component="h1">Invite unavailable</Typography><Typography color="text.secondary">Sign in with the invited email, or ask an organiser for a new invite.</Typography></Stack>;
  }
  return (
    <Stack spacing={2} sx={{ py: 3, maxWidth: 560 }}>
      <Typography variant="h5" component="h1">Co-organizer invitation</Typography>
      <Typography color="text.secondary">Accept the invitation to help manage {invite.event?.title ?? invite.series?.title ?? "this event"}.</Typography>
      <AcceptInviteButton kind="collaborator" token={token} />
    </Stack>
  );
}
