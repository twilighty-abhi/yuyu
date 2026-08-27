import type { Metadata } from "next";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { prisma } from "@/lib/db";
import { requireOrgRole } from "@/lib/permissions";
import { ApiClientManagement } from "@/components/api-clients/ApiClientManagement";
import { isApiScope } from "@/lib/api/v1/scopes";

export const metadata: Metadata = { title: "API access", description: "Manage machine-to-machine access." };

export default async function ApiAccessPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const { organisation } = await requireOrgRole(orgSlug, "OWNER");
  const clients = await prisma.apiClient.findMany({
    where: { organisationId: organisation.id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      status: true,
      scopes: { select: { scope: true }, orderBy: { scope: "asc" } },
      credentials: {
        select: { id: true, name: true, createdAt: true, expiresAt: true, revokedAt: true, lastUsedAt: true },
        orderBy: { createdAt: "desc" },
      },
    },
  });
  return (
    <Stack spacing={3.5} sx={{ pb: 3 }}>
      <Stack spacing={0.5}>
        <Typography variant="h5" component="h1" sx={{ fontWeight: 700 }}>API access</Typography>
        <Typography variant="body2" color="text.secondary">Create tenant-bound machine identities and rotate their credentials.</Typography>
      </Stack>
      <ApiClientManagement
        organisationSlug={organisation.slug}
        referenceTime={new Date().toISOString()}
        clients={clients.map((client) => ({
          ...client,
          scopes: client.scopes.map(({ scope }) => scope).filter(isApiScope),
          credentials: client.credentials.map((credential) => ({
            ...credential,
            createdAt: credential.createdAt.toISOString(),
            expiresAt: credential.expiresAt?.toISOString() ?? null,
            revokedAt: credential.revokedAt?.toISOString() ?? null,
            lastUsedAt: credential.lastUsedAt?.toISOString() ?? null,
          })),
        }))}
      />
    </Stack>
  );
}
