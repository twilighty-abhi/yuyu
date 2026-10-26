import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { requireOrgRole } from "@/lib/permissions";
import { ApiClientManagement } from "@/components/api-clients/ApiClientManagement";
import { ApiDeveloperReference } from "@/components/api-clients/ApiDeveloperReference";
import { isApiScope } from "@/lib/api/v1/scopes";
import { getRequestOrigin } from "@/lib/publicUrl";
import { PageHeader } from "@/components/ui/display";
import { HelpLink } from "@/components/help/HelpLink";

export const metadata: Metadata = { title: "API access", description: "Manage machine-to-machine access." };

export default async function ApiAccessPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const { organisation } = await requireOrgRole(orgSlug, "OWNER");
  const apiBaseUrl = `${await getRequestOrigin()}/api/v1`;
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
    <div className="flex flex-col gap-8 pb-6">
      <PageHeader title="API access" description="Create tenant-bound machine identities and rotate their credentials." actions={<HelpLink article="developers/api" />} />
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
      <ApiDeveloperReference apiBaseUrl={apiBaseUrl} />
    </div>
  );
}
