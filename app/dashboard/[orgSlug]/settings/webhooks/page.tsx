import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireOrgRole } from "@/lib/permissions";
import { PageHeader } from "@/components/ui/display";
import { WebhookEndpointList } from "@/components/webhooks/WebhookEndpointList";
import { listWebhookEndpoints } from "@/lib/webhooks/management";
import { MAX_WEBHOOK_ENDPOINTS_PER_ORGANISATION } from "@/lib/webhooks/eventTypes";
import { formatRelativeTime } from "@/lib/format/datetime";

export const metadata: Metadata = { title: "Webhooks", description: "Send organisation events to your own systems." };

export default async function WebhooksPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  // Owners and admins only; members and co-organisers are redirected away.
  const { organisation } = await requireOrgRole(orgSlug, "ADMIN");
  const endpoints = await listWebhookEndpoints(organisation.id);
  const now = new Date();
  return (
    <div className="flex flex-col gap-8 pb-6">
      <div className="flex flex-col gap-3">
        <Link href={`/dashboard/${organisation.slug}/settings`} className="inline-flex min-h-9 items-center gap-1.5 self-start text-sm font-semibold text-ink-secondary hover:text-ink">
          <ArrowLeft aria-hidden className="size-4" />
          Settings
        </Link>
        <PageHeader
          title="Webhooks"
          description="Yuyu sends a signed POST request to your endpoints when registrations, check-ins, events and feedback change. Payloads hold names and statuses only: no email addresses, answers or ticket links."
        />
      </div>
      <WebhookEndpointList
        organisationSlug={organisation.slug}
        maxEndpoints={MAX_WEBHOOK_ENDPOINTS_PER_ORGANISATION}
        endpoints={endpoints.map((endpoint) => ({
          id: endpoint.id,
          host: endpoint.host,
          url: endpoint.url,
          description: endpoint.description,
          eventCount: endpoint.eventTypes.length,
          state: endpoint.state,
          lastDeliveryLabel: endpoint.lastDelivery ? formatRelativeTime(endpoint.lastDelivery.at, "UTC", now) : null,
          lastDeliveryOk: endpoint.lastDelivery
            ? endpoint.lastDelivery.status === "SUCCEEDED" ? true : endpoint.lastDelivery.status === "FAILED" ? false : null
            : null,
        }))}
      />
      <p className="text-caption text-ink-muted">
        How to verify signatures, the event payloads and the retry policy are described in the Yuyu webhooks guide (docs/WEBHOOKS.md).
      </p>
    </div>
  );
}
