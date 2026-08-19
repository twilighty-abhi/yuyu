import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Paper from "@mui/material/Paper";
import Grid from "@mui/material/Grid";
import Box from "@mui/material/Box";
import { prisma } from "@/lib/db";
import { canDeleteOrg, requireOrgRole } from "@/lib/permissions";
import { EditOrgForm } from "@/components/org/EditOrgForm";
import { DeleteOrganisationButton } from "@/components/dashboard/DeleteOrganisationButton";

import type { Metadata } from "next";

type Props = { params: Promise<{ orgSlug: string }> };

export const metadata: Metadata = {
  title: "Settings",
  description: "Edit organisation details.",
};

export default async function OrgSettingsPage({ params }: Props) {
  const { orgSlug } = await params;
  const { organisation, membership } = await requireOrgRole(orgSlug, "ADMIN");

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
    <Stack spacing={3.5}>
      <Paper
        variant="outlined"
        sx={{
          p: { xs: 2.5, sm: 3.5 },
          borderRadius: "22px",
          borderColor: "rgba(255,255,255,0.09)",
          background: "linear-gradient(120deg, rgba(10,132,255,0.14), rgba(28,28,30,0.96) 60%)",
        }}
      >
        <Typography variant="overline" sx={{ color: "#0A84FF", fontWeight: 700, letterSpacing: "1.5px", lineHeight: 1.3 }}>
          Organisation settings
        </Typography>
        <Typography variant="h4" component="h1" sx={{ mt: 0.5, fontWeight: 700, letterSpacing: "-1px" }}>
          Shape your workspace
        </Typography>
        <Typography variant="body2" sx={{ mt: 1, color: "rgba(255,255,255,0.58)", maxWidth: 560 }}>
          Update the details people see when they visit {org.name}.
        </Typography>
      </Paper>

      <Grid container spacing={3}>
        <Grid size={{ xs: 12, md: 8 }}>
          <EditOrgForm
            organisationSlug={org.slug}
            initial={{
              name: org.name,
              description: org.description ?? "",
              logoUrl: org.logoUrl,
            }}
          />
        </Grid>
        <Grid size={{ xs: 12, md: 4 }}>
          <Stack spacing={2.5}>
            <Paper variant="outlined" sx={{ p: 2.5, borderRadius: "16px", borderColor: "rgba(255,255,255,0.08)", backgroundColor: "rgba(255,255,255,0.025)" }}>
              <Stack spacing={1}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>About this workspace</Typography>
                <Typography variant="body2" color="text.secondary">
                  Changes are visible on the public organisation page as soon as you save them.
                </Typography>
                <Box sx={{ pt: 1 }}>
                  <Typography variant="caption" sx={{ color: "text.secondary" }}>Organisation URL</Typography>
                  <Typography variant="body2" sx={{ mt: 0.25, fontWeight: 600 }}>/{org.slug}</Typography>
                </Box>
              </Stack>
            </Paper>

            {canDeleteOrg(membership) ? (
              <Paper variant="outlined" sx={{ p: 2.5, borderRadius: "16px", borderColor: "rgba(255,69,58,0.35)", backgroundColor: "rgba(255,69,58,0.06)" }}>
                <Stack spacing={1.25}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700, color: "#FF6961" }}>Danger zone</Typography>
                  <Typography variant="body2" sx={{ color: "rgba(255,255,255,0.65)" }}>
                    Permanently delete this organisation and all of its events, registrations, and memberships.
                  </Typography>
                  <Box sx={{ pt: 0.5 }}>
                    <DeleteOrganisationButton organisationSlug={org.slug} />
                  </Box>
                </Stack>
              </Paper>
            ) : null}
          </Stack>
        </Grid>
      </Grid>
    </Stack>
  );
}
