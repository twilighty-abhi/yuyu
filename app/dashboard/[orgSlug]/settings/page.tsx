import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { prisma } from "@/lib/db";
import { requireOrgRole } from "@/lib/permissions";
import { EditOrgForm } from "@/components/org/EditOrgForm";

import type { Metadata } from "next";

type Props = { params: Promise<{ orgSlug: string }> };

export const metadata: Metadata = {
  title: "Settings",
  description: "Edit organisation details.",
};

export default async function OrgSettingsPage({ params }: Props) {
  const { orgSlug } = await params;
  const { organisation } = await requireOrgRole(orgSlug, "ADMIN");

  const org = await prisma.organisation.findUnique({
    where: { id: organisation.id },
    select: { name: true, description: true, logoUrl: true, slug: true },
  });

  if (!org) {
    // requireOrgRole guarantees the org exists; this is defensive.
    return (
      <Typography color="text.secondary">
        Organisation not found.
      </Typography>
    );
  }

  return (
    <Stack spacing={2.5}>
      <Stack spacing={0.5}>
        <Typography variant="h6" component="h1" sx={{ fontWeight: 700 }}>
          Settings
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Only organisation admins can edit these fields.
        </Typography>
      </Stack>

      <EditOrgForm
        organisationSlug={org.slug}
        initial={{
          name: org.name,
          description: org.description ?? "",
          logoUrl: org.logoUrl,
        }}
      />
    </Stack>
  );
}

