import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireOrgRole } from "@/lib/permissions";
import { PageHeader } from "@/components/ui/display";
import { WebhookEndpointDetail } from "@/components/webhooks/WebhookEndpointDetail";
import { getWebhookEndpointDetail } from "@/lib/webhooks/management";
import { WEBHOOK_AUTO_DISABLE_AFTER } from "@/lib/webhooks/delivery";
import { formatRelativeTime } from "@/lib/format/datetime";

export const metadata: Metadata = { title: "Webhook endpoint", description: "Delivery log and settings for one webhook endpoint." };

export default async function WebhookEndpointPage({ params }: { params: Promise<{ orgSlug: string; endpointId: string }> }) {
  const { orgSlug, endpointId } = await params;
  const { organisation } = await requireOrgRole(orgSlug, "ADMIN");
  // Scoped to this organisation: another tenant's endpoint id is a plain 404.
  const detail = await getWebhookEndpointDetail(organisation.id, endpointId);
  if (!detail) notFound();
  const now = new Date();
  const label = (value: string | null) => (value ? formatRelativeTime(value, "UTC", now) : null);
  const { endpoint } = detail;
  return (
    <div className="flex flex-col gap-8 pb-6">
      <div className="flex flex-col gap-3">
        <Link href={`/dashboard/${organisation.slug}/settings/webhooks`} className="inline-flex min-h-9 items-center gap-1.5 self-start text-sm font-semibold text-ink-secondary hover:text-ink">
          <ArrowLeft aria-hidden className="size-4" />
          Webhooks
        </Link>
        <PageHeader title={endpoint.host} description="Endpoint settings and its recent deliveries." />
      </div>
      <WebhookEndpointDetail
        organisationSlug={organisation.slug}
        autoDisableAfter={WEBHOOK_AUTO_DISABLE_AFTER}
        endpoint={{
          id: endpoint.id,
          url: endpoint.url,
          host: endpoint.host,
          description: endpoint.description,
          eventTypes: endpoint.eventTypes,
          state: endpoint.state,
          consecutiveFailures: endpoint.consecutiveFailures,
          disabledLabel: label(endpoint.disabledAt),
          lastSuccessLabel: label(endpoint.lastSuccessAt),
          lastFailureLabel: label(endpoint.lastFailureAt),
        }}
        deliveries={detail.deliveries.map((delivery) => ({
          id: delivery.id,
          eventId: delivery.eventId,
          eventType: delivery.eventType,
          status: delivery.status,
          attempts: delivery.attempts,
          lastStatusCode: delivery.lastStatusCode,
          lastError: delivery.lastError,
          responseTimeMs: delivery.responseTimeMs,
          timeIso: delivery.lastAttemptAt ?? delivery.createdAt,
          timeLabel: formatRelativeTime(delivery.lastAttemptAt ?? delivery.createdAt, "UTC", now),
          nextAttemptLabel: delivery.nextAttemptAt ? formatNext(delivery.nextAttemptAt, now) : null,
        }))}
      />
    </div>
  );
}

function formatNext(iso: string, now: Date) {
  const minutes = Math.max(0, Math.round((new Date(iso).getTime() - now.getTime()) / 60_000));
  if (minutes < 1) return "in under a minute";
  if (minutes < 60) return `in ${minutes} min`;
  const hours = Math.round(minutes / 60);
  return `in about ${hours} ${hours === 1 ? "hour" : "hours"}`;
}
