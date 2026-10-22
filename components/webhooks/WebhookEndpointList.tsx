"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronRight, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Chip, EmptyState } from "@/components/ui/display";
import { useToast } from "@/components/feedback/ToastProvider";
import { createWebhookEndpoint } from "@/app/actions/webhooks";
import { WebhookEndpointFormDialog, WebhookSecretDialog } from "@/components/webhooks/WebhookDialogs";
import { WebhookStateChip } from "@/components/webhooks/WebhookStateChip";
import type { WebhookEndpointState } from "@/lib/webhooks/eventTypes";

export type WebhookEndpointListItem = {
  id: string;
  host: string;
  url: string;
  description: string;
  eventCount: number;
  state: WebhookEndpointState;
  lastDeliveryLabel: string | null;
  lastDeliveryOk: boolean | null;
};

export function WebhookEndpointList(props: { organisationSlug: string; endpoints: WebhookEndpointListItem[]; maxEndpoints: number }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  const [formOpen, setFormOpen] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const atLimit = props.endpoints.length >= props.maxEndpoints;

  return (
    <section aria-labelledby="webhook-endpoints-title" className="flex flex-col gap-4">
      <WebhookSecretDialog secret={secret} onClose={() => setSecret(null)} />
      <WebhookEndpointFormDialog
        key={formKey}
        open={formOpen}
        mode="create"
        pending={pending}
        error={error}
        onClose={() => setFormOpen(false)}
        onSubmit={(values) => {
          setError(null);
          startTransition(async () => {
            const result = await createWebhookEndpoint({ organisationSlug: props.organisationSlug, ...values });
            if (!result.ok) {
              setError(result.error);
              return;
            }
            setFormOpen(false);
            setSecret(result.data?.secret ?? null);
            showToast("Webhook endpoint added", "success");
            router.refresh();
          });
        }}
      />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 id="webhook-endpoints-title" className="text-title text-ink">Endpoints</h2>
          <p className="mt-0.5 text-body-ui text-ink-muted">
            {props.endpoints.length} of {props.maxEndpoints} used.
          </p>
        </div>
        <Button
          variant="primary"
          startIcon={<Plus />}
          disabled={atLimit}
          onClick={() => {
            setError(null);
            setFormKey((key) => key + 1);
            setFormOpen(true);
          }}
        >
          Add endpoint
        </Button>
      </div>
      {props.endpoints.length === 0 ? (
        <EmptyState mood="sleepy" title="No webhook endpoints yet">
          Add an endpoint to send registrations, check-ins and other events to your own systems.
        </EmptyState>
      ) : (
        <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-lg border border-line bg-canvas">
          {props.endpoints.map((endpoint) => (
            <li key={endpoint.id}>
              <Link
                href={`/dashboard/${props.organisationSlug}/settings/webhooks/${endpoint.id}`}
                className="flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-subtle focus-visible:bg-subtle sm:px-5"
              >
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="truncate font-mono text-sm font-semibold text-ink">{endpoint.host}</span>
                    <WebhookStateChip state={endpoint.state} />
                  </span>
                  <span className="mt-0.5 block truncate text-caption text-ink-muted">
                    {endpoint.description || `${endpoint.eventCount} ${endpoint.eventCount === 1 ? "event" : "events"}`}
                    {" · "}
                    {endpoint.lastDeliveryLabel ? `Last delivery ${endpoint.lastDeliveryLabel}` : "No deliveries yet"}
                  </span>
                </span>
                {endpoint.lastDeliveryOk === null ? null : (
                  <Chip size="sm" tone={endpoint.lastDeliveryOk ? "success" : "danger"} className="hidden sm:inline-flex">
                    {endpoint.lastDeliveryOk ? "Delivered" : "Failing"}
                  </Chip>
                )}
                <ChevronRight aria-hidden className="size-4 shrink-0 text-ink-muted" />
                <span className="sr-only">Manage endpoint {endpoint.host}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
