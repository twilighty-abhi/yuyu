import type { Metadata } from "next";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/permissions";
import { AccountSecurityClient } from "@/components/security/AccountSecurityClient";

export const metadata: Metadata = { title: "Account security" };

export default async function AccountSecurityPage() {
  const session = await requireAuth();
  const user = await prisma.user.findUniqueOrThrow({ where: { id: session.user.id }, select: { mfaEnabledAt: true } });
  return <Stack spacing={3} sx={{ maxWidth: 720, mx: "auto", py: { xs: 3, sm: 5 } }}><Stack spacing={0.5}><Typography variant="h3" component="h1">Account security</Typography><Typography color="text.secondary">Manage multi-factor authentication and revoke sessions.</Typography></Stack><AccountSecurityClient mfaEnabled={Boolean(user.mfaEnabledAt)} /></Stack>;
}
