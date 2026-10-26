import Link from "next/link";
import { ExternalLink, KeyRound, Webhook } from "lucide-react";
import { prisma } from "@/lib/db";
import { canDeleteOrg, requireOrgRole } from "@/lib/permissions";
import { EditOrgForm } from "@/components/org/EditOrgForm";
import { CopyOrganisationUrl } from "@/components/org/CopyOrganisationUrl";
import { DeleteOrganisationButton } from "@/components/dashboard/DeleteOrganisationButton";
import { OrgPageHeader } from "@/components/dashboard/org/OrgPageHeader";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/display";
import { cn } from "@/lib/cn";
import { countWebhookEndpoints } from "@/lib/webhooks/management";

import type { Metadata } from "next";

type Props = { params: Promise<{ orgSlug: string }> };

export const metadata: Metadata = {
  title: "Settings",
  description: "Edit organisation details.",
};

const sectionCard = "rounded-2xl border border-line bg-canvas p-5 sm:p-6";

export default async function OrgSettingsPage({ params }: Props) {
  const { orgSlug } = await params;
  const { organisation, membership } = await requireOrgRole(orgSlug, "ADMIN");

  const org = await prisma.organisation.findUnique({
    where: { id: organisation.id },
    select: { name: true, description: true, logoUrl: true, slug: true },
  });

  if (!org) {
    // requireOrgRole guarantees the org exists; this is defensive.
    return <p className="text-body-ui text-ink-muted">Organisation not found.</p>;
  }

  const isOwner = membership.role === "OWNER";
  const canDelete = canDeleteOrg(membership);
  // Owner-only, tenant-scoped counts. "Active" means the client is enabled and
  // holds at least one credential that is neither revoked nor expired.
  const now = new Date();
  const [totalApiClients, activeApiClients] = isOwner
    ? await Promise.all([
        prisma.apiClient.count({ where: { organisationId: organisation.id } }),
        prisma.apiClient.count({
          where: {
            organisationId: organisation.id,
            status: "ACTIVE",
            credentials: { some: { revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] } },
          },
        }),
      ])
    : [0, 0];
  // The page itself is OWNER/ADMIN only, and so are webhooks (canManageWebhooks).
  const webhooks = await countWebhookEndpoints(organisation.id);

  return (
    <div className="flex flex-col gap-7">
      <OrgPageHeader
        organisation={{ name: org.name, slug: org.slug, logoUrl: org.logoUrl }}
        title="Settings"
        description={`What people see on your public page, and how ${org.name} connects to other tools.`}
      />

      <div className="flex min-w-0 flex-col gap-6">
        <EditOrgForm
          id="profile"
          organisationSlug={org.slug}
          initial={{
            name: org.name,
            description: org.description ?? "",
            logoUrl: org.logoUrl,
          }}
        />

        <section id="public-page" aria-labelledby="public-page-title" className={cn(sectionCard, "flex flex-col gap-4 md:flex-row md:items-center")}>
          <div className="min-w-0 flex-1">
            <h2 id="public-page-title" className="text-h4 text-ink">Public page</h2>
            <p className="mt-0.5 text-body-ui text-ink-muted">One link that always lists what is coming up. The address can&apos;t be changed.</p>
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="max-w-full truncate rounded-full bg-muted px-3.5 py-2 font-mono text-sm text-ink-secondary">/{org.slug}</span>
            <CopyOrganisationUrl slug={org.slug} />
            <Link
              href={`/${org.slug}`}
              className="inline-flex min-h-9 items-center gap-1 px-2 text-sm font-semibold text-ink-secondary underline-offset-4 hover:text-ink hover:underline"
            >
              Open
              <ExternalLink aria-hidden className="size-3.5" />
            </Link>
          </div>
        </section>

        {isOwner ? (
          <section id="api-access" aria-labelledby="api-access-title" className={cn(sectionCard, "flex flex-col gap-4 md:flex-row md:items-center")}>
            <div className="min-w-0 flex-1">
              <h2 id="api-access-title" className="text-h4 text-ink">API access</h2>
              <p className="mt-0.5 text-body-ui text-ink-muted">Let another system read your events with a scoped, rotatable key.</p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Chip tone={activeApiClients > 0 ? "success" : "neutral"}>
                {totalApiClients === 0
                  ? "No clients yet"
                  : activeApiClients === 0
                    ? "No active clients"
                    : `${activeApiClients} active ${activeApiClients === 1 ? "client" : "clients"}`}
              </Chip>
              <Button asChild variant="secondary">
                <Link href={`/dashboard/${org.slug}/settings/api`}>
                  <KeyRound aria-hidden className="size-4" />
                  Manage API access
                </Link>
              </Button>
            </div>
          </section>
        ) : null}

        <section id="webhooks" aria-labelledby="webhooks-title" className={cn(sectionCard, "flex flex-col gap-4 md:flex-row md:items-center")}>
          <div className="min-w-0 flex-1">
            <h2 id="webhooks-title" className="text-h4 text-ink">Webhooks</h2>
            <p className="mt-0.5 text-body-ui text-ink-muted">Send registrations, check-ins and other events to your own systems as they happen.</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Chip tone={webhooks.enabled > 0 ? "success" : "neutral"}>
              {webhooks.total === 0
                ? "No endpoints yet"
                : webhooks.enabled === 0
                  ? "No active endpoints"
                  : `${webhooks.enabled} active ${webhooks.enabled === 1 ? "endpoint" : "endpoints"}`}
            </Chip>
            <Button asChild variant="secondary">
              <Link href={`/dashboard/${org.slug}/settings/webhooks`}>
                <Webhook aria-hidden className="size-4" />
                Manage webhooks
              </Link>
            </Button>
          </div>
        </section>

        {canDelete ? (
          <section
            id="danger-zone"
            aria-labelledby="danger-zone-title"
            className={cn(sectionCard, "flex flex-col gap-4 border-[1.5px] border-danger-border md:flex-row md:items-center")}
          >
            <div className="min-w-0 flex-1">
              <h2 id="danger-zone-title" className="text-h4 text-danger-fg">Delete organisation</h2>
              <p className="mt-0.5 text-body-ui text-ink-secondary">
                Permanently removes {org.name} with all of its events, registrations and memberships. You&apos;ll be asked to type the name to confirm.
              </p>
            </div>
            <div className="shrink-0">
              <DeleteOrganisationButton organisationSlug={org.slug} organisationName={org.name} />
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}
