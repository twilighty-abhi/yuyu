import Link from "next/link";
import { redirect } from "next/navigation";
import Typography from "@mui/material/Typography";
import Stack from "@mui/material/Stack";
import Paper from "@mui/material/Paper";
import Button from "@mui/material/Button";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";

type Props = { params: Promise<{ token: string }> };

export default async function JoinOrganisationPage({ params }: Props) {
  const { token } = await params;
  const session = await auth();

  const joinUrl = `/join/org/${encodeURIComponent(token)}`;
  if (!session?.user?.id) {
    redirect(`/login?callbackUrl=${encodeURIComponent(joinUrl)}`);
  }

  const invite = await prisma.organisationInvite.findUnique({
    where: { token },
    include: { organisation: { select: { id: true, slug: true, name: true } } },
  });

  if (!invite) {
    return (
      <Stack spacing={2} sx={{ py: 3, maxWidth: 560 }}>
        <Typography variant="h5" component="h1" sx={{ fontWeight: 700 }}>
          Invite link not found
        </Typography>
        <Typography color="text.secondary">
          This invite link is invalid or has been revoked.
        </Typography>
        <Link href="/dashboard" style={{ textDecoration: "none" }}>
          <Button variant="contained">Go to dashboard</Button>
        </Link>
      </Stack>
    );
  }

  const now = new Date();
  if (invite.usedAt) {
    return (
      <Stack spacing={2} sx={{ py: 3, maxWidth: 560 }}>
        <Typography variant="h5" component="h1" sx={{ fontWeight: 700 }}>
          Invite already used
        </Typography>
        <Typography color="text.secondary">
          This invite link has already been used.
        </Typography>
        <Link
          href={`/dashboard/${invite.organisation.slug}`}
          style={{ textDecoration: "none" }}
        >
          <Button variant="contained">Open organisation</Button>
        </Link>
      </Stack>
    );
  }

  if (invite.expiresAt && invite.expiresAt < now) {
    return (
      <Stack spacing={2} sx={{ py: 3, maxWidth: 560 }}>
        <Typography variant="h5" component="h1" sx={{ fontWeight: 700 }}>
          Invite expired
        </Typography>
        <Typography color="text.secondary">
          Ask an admin to generate a new invite link.
        </Typography>
        <Link href="/dashboard" style={{ textDecoration: "none" }}>
          <Button variant="contained">Go to dashboard</Button>
        </Link>
      </Stack>
    );
  }

  const userId = session.user.id;
  const orgId = invite.organisation.id;

  // Consume invite once, create membership if needed.
  try {
    await prisma.$transaction(async (tx) => {
      const fresh = await tx.organisationInvite.findUnique({
        where: { token },
        select: { id: true, usedAt: true, organisationId: true },
      });
      if (!fresh || fresh.usedAt) return;

      const existing = await tx.membership.findUnique({
        where: { userId_organisationId: { userId, organisationId: orgId } },
        select: { id: true },
      });
      if (!existing) {
        await tx.membership.create({
          data: {
            userId,
            organisationId: orgId,
            role: invite.role,
          },
        });
      }
      await tx.organisationInvite.update({
        where: { id: fresh.id },
        data: { usedAt: new Date(), usedByUserId: userId },
      });
    });
  } catch (e: unknown) {
    console.error(e);
    return (
      <Stack spacing={2} sx={{ py: 3, maxWidth: 560 }}>
        <Typography variant="h5" component="h1" sx={{ fontWeight: 700 }}>
          Could not join
        </Typography>
        <Typography color="text.secondary">
          Something went wrong while accepting the invite. Please try again.
        </Typography>
        <Link href="/dashboard" style={{ textDecoration: "none" }}>
          <Button variant="contained">Go to dashboard</Button>
        </Link>
      </Stack>
    );
  }

  return (
    <Stack spacing={2} sx={{ py: 3, maxWidth: 560 }}>
      <Typography variant="h5" component="h1" sx={{ fontWeight: 700 }}>
        You’re in
      </Typography>
      <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2 }}>
        <Typography sx={{ fontWeight: 600 }}>{invite.organisation.name}</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          Your membership has been added.
        </Typography>
      </Paper>
      <Link
        href={`/dashboard/${invite.organisation.slug}`}
        style={{ textDecoration: "none" }}
      >
        <Button variant="contained">Open organisation</Button>
      </Link>
    </Stack>
  );
}

