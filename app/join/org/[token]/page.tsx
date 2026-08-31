import { redirect } from "next/navigation";
import Typography from "@mui/material/Typography";
import Stack from "@mui/material/Stack";
import Paper from "@mui/material/Paper";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { AcceptInviteButton } from "@/components/invites/AcceptInviteButton";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Join organisation", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function JoinOrganisationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const session = await auth();
  const joinUrl = `/join/org/${encodeURIComponent(token)}`;
  if (!session?.user?.id) redirect(`/login?callbackUrl=${encodeURIComponent(joinUrl)}`);
  const invite = await prisma.organisationInvite.findUnique({
    where: { token },
    select: { usedAt: true, expiresAt: true, organisation: { select: { name: true } } },
  });
  if (!invite || invite.usedAt || (invite.expiresAt && invite.expiresAt <= new Date())) {
    return <Stack spacing={2}><Typography variant="h5" component="h1">Invite unavailable</Typography><Typography color="text.secondary">This invite is invalid, expired, used, or revoked.</Typography></Stack>;
  }
  return (
    <Stack spacing={2} sx={{ py: 3, maxWidth: 560 }}>
      <Typography variant="h5" component="h1" sx={{ fontWeight: 700 }}>Join organisation</Typography>
      <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2 }}>
        <Typography sx={{ fontWeight: 600 }}>{invite.organisation.name}</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>Accept this single-use invitation to become a member.</Typography>
      </Paper>
      <AcceptInviteButton kind="organisation" token={token} />
    </Stack>
  );
}
