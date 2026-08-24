import Stack from "@mui/material/Stack";
import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/permissions";
import { AccountSecurityClient } from "@/components/security/AccountSecurityClient";
import { AccountPasswordForm } from "@/components/account/AccountPasswordForm";

export const metadata: Metadata = { title: "Account security" };

export default async function AccountSecurityPage() {
  const session = await requireAuth();
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: session.user.id },
    select: { mfaEnabledAt: true, passwordHash: true },
  });
  return (
    <Stack spacing={3}>
      <AccountPasswordForm hasPassword={Boolean(user.passwordHash)} />
      <AccountSecurityClient mfaEnabled={Boolean(user.mfaEnabledAt)} />
    </Stack>
  );
}
