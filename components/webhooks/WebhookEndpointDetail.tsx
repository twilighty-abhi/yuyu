"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, Pencil, Power, Send, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Callout, Card, Chip, EmptyState } from "@/components/ui/display";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { ConfirmationDialog } from "@/components/feedback/ConfirmationDialog";
import { useToast } from "@/components/feedback/ToastProvider";
import {
  deleteWebhookEndpoint,
  redeliverWebhook,
  rotateWebhookSecret,
  sendWebhookTest,
  setWebhookEndpointEnabled,
  updateWebhookEndpoint,
} from "@/app/actions/webhooks";
import { WebhookEndpointFormDialog, WebhookSecretDialog } from "@/components/webhooks/WebhookDialogs";
import { WebhookStateChip } from "@/components/webhooks/WebhookStateChip";
import { WEBHOOK_EVENT_LABELS, type WebhookEndpointState, type WebhookEventType } from "@/lib/webhooks/eventTypes";

export type WebhookDetailEndpoint = {
  id: string;
  url: string;
  host: string;
  description: string;
  eventTypes: WebhookEventType[];
  state: WebhookEndpointState;
  consecutiveFailures: number;
  disabledLabel: string | null;
  lastSuccessLabel: string | null;
  lastFailureLabel: string | null;
};

export type WebhookDetailDelivery = {
  id: string;
  eventId: string;
  eventType: string;
  status: "PENDING" | "PROCESSING" | "SUCCEEDED" | "FAILED";
  attempts: number;
  lastStatusCode: number | null;
  lastError: string | null;
  responseTimeMs: number | null;
  timeLabel: string;
  timeIso: string;
  nextAttemptLabel: string | null;
};

const STATUS_CHIP: Record<WebhookDetailDelivery["status"], { label: string; tone: "success" | "danger" | "warning" | "neutral" }> = {
  SUCCEEDED: { label: "Delivered", tone: "success" },
  FAILED: { label: "Failed", tone: "danger" },
  PENDING: { label: "Retrying", tone: "warning" },
  PROCESSING: { label: "Sending", tone: "neutral" },
};

type ActionOutcome = { ok: true; data?: unknown } | { ok: false; error: string };

export function WebhookEndpointDetail(props: {
  organisationSlug: string;
  endpoint: WebhookDetailEndpoint;
  deliveries: WebhookDetailDelivery[];
  autoDisableAfter: number;
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  const [secret, setSecret] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editKey, setEditKey] = useState(0);
  const [editError, setEditError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"rotate" | "disable" | "delete" | null>(null);
  const { endpoint } = props;
  const base = { organisationSlug: props.organisationSlug, endpointId: endpoint.id };

  function reportTest(result: ActionOutcome, label: string) {
    if (!result.ok) return showToast(result.error, "error");
    const data = result.data as { delivered: boolean; statusCode: number | null; error: string | null } | undefined;
    if (data?.delivered) showToast(`${label}: HTTP ${data.statusCode}`, "success");
    else showToast(`${label} failed: ${data?.error ?? "no response"}`, "error");
    router.refresh();
  }

  function run(operation: () => Promise<ActionOutcome>, success: string, after?: (result: ActionOutcome) => void) {
    startTransition(async () => {
      const result = await operation();
      if (!result.ok) return showToast(result.error, "error");
      after?.(result);
      showToast(success, "success");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <WebhookSecretDialog secret={secret} onClose={() => setSecret(null)} />
      <WebhookEndpointFormDialog
        key={editKey}
        open={editOpen}
        mode="edit"
        initial={{ url: endpoint.url, description: endpoint.description, eventTypes: endpoint.eventTypes }}
        pending={pending}
        error={editError}
        onClose={() => setEditOpen(false)}
        onSubmit={(values) => {
          setEditError(null);
          startTransition(async () => {
            const result = await updateWebhookEndpoint({ ...base, ...values });
            if (!result.ok) return setEditError(result.error);
            setEditOpen(false);
            showToast("Webhook endpoint saved", "success");
            router.refresh();
          });
        }}
      />

      {endpoint.state === "auto_disabled" ? (
        <Callout tone="danger" title="Turned off automatically">
          Yuyu stopped sending to this endpoint after {props.autoDisableAfter} failed deliveries in a row{endpoint.disabledLabel ? ` (${endpoint.disabledLabel})` : ""}. Fix the receiver, send a test, then turn it back on.
        </Callout>
      ) : null}

      <Card as="section" aria-labelledby="webhook-endpoint-title" className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="webhook-endpoint-title" className="min-w-0 break-all font-mono text-[15px] font-semibold text-ink">{endpoint.url}</h2>
            <WebhookStateChip state={endpoint.state} />
          </div>
          {endpoint.description ? <p className="text-body-ui text-ink-secondary">{endpoint.description}</p> : null}
          <p className="text-caption text-ink-muted">
            Last success {endpoint.lastSuccessLabel ?? "never"} · Last failure {endpoint.lastFailureLabel ?? "never"}
            {endpoint.consecutiveFailures > 0 ? ` · ${endpoint.consecutiveFailures} failed in a row` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {endpoint.eventTypes.map((type) => (
            <Chip key={type} size="sm" tone="outline">{WEBHOOK_EVENT_LABELS[type].label}</Chip>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            size="sm"
            startIcon={<Send />}
            disabled={pending || endpoint.state !== "enabled"}
            onClick={() => startTransition(async () => reportTest(await sendWebhookTest(base), "Test event"))}
          >
            Send test
          </Button>
          <Button variant="secondary" size="sm" startIcon={<Pencil />} disabled={pending} onClick={() => { setEditError(null); setEditKey((key) => key + 1); setEditOpen(true); }}>
            Edit
          </Button>
          <Button variant="secondary" size="sm" startIcon={<KeyRound />} disabled={pending} onClick={() => setConfirm("rotate")}>
            Rotate secret
          </Button>
          {endpoint.state === "enabled" ? (
            <Button variant="secondary" size="sm" startIcon={<Power />} disabled={pending} onClick={() => setConfirm("disable")}>
              Disable
            </Button>
          ) : (
            <Button
              variant="secondary"
              size="sm"
              startIcon={<Power />}
              disabled={pending}
              onClick={() => run(() => setWebhookEndpointEnabled({ ...base, enabled: true }), "Webhook endpoint turned on")}
            >
              Enable
            </Button>
          )}
          <Button variant="dangerQuiet" size="sm" startIcon={<Trash2 />} disabled={pending} onClick={() => setConfirm("delete")}>
            Delete
          </Button>
        </div>
      </Card>

      <section aria-labelledby="webhook-deliveries-title" className="flex flex-col gap-3">
        <div>
          <h2 id="webhook-deliveries-title" className="text-title text-ink">Recent deliveries</h2>
          <p className="mt-0.5 text-body-ui text-ink-muted">The last 50 events sent to this endpoint. History is kept for 30 days.</p>
        </div>
        {props.deliveries.length === 0 ? (
          <EmptyState mood="sleepy">No deliveries yet. Send a test to check the connection.</EmptyState>
        ) : (
          <Table label="Recent webhook deliveries">
            <THead>
              <tr>
                <TH>Time</TH>
                <TH>Event</TH>
                <TH>Result</TH>
                <TH>Response</TH>
                <TH>Duration</TH>
                <TH>Attempts</TH>
                <TH><span className="sr-only">Actions</span></TH>
              </tr>
            </THead>
            <TBody>
              {props.deliveries.map((delivery) => {
                const chip = STATUS_CHIP[delivery.status];
                return (
                  <TR key={delivery.id} data-testid="webhook-delivery-row">
                    <TD className="whitespace-nowrap"><time dateTime={delivery.timeIso}>{delivery.timeLabel}</time></TD>
                    <TD className="font-mono text-sm">{delivery.eventType}</TD>
                    <TD>
                      <div className="flex flex-col gap-0.5">
                        <Chip size="sm" tone={chip.tone} className="self-start">{chip.label}</Chip>
                        {delivery.lastError ? <span className="max-w-[28ch] text-caption text-ink-muted">{delivery.lastError}</span> : null}
                        {delivery.nextAttemptLabel ? <span className="text-caption text-ink-muted">Next try {delivery.nextAttemptLabel}</span> : null}
                      </div>
                    </TD>
                    <TD className="whitespace-nowrap font-mono text-sm">{delivery.lastStatusCode ?? "—"}</TD>
                    <TD className="whitespace-nowrap text-sm">{delivery.responseTimeMs != null ? `${delivery.responseTimeMs} ms` : "—"}</TD>
                    <TD className="text-sm">{delivery.attempts}</TD>
                    <TD className="text-right">
                      {delivery.status === "FAILED" ? (
                        <Button
                          variant="quiet"
                          size="sm"
                          disabled={pending || endpoint.state !== "enabled"}
                          onClick={() =>
                            startTransition(async () =>
                              reportTest(await redeliverWebhook({ ...base, deliveryId: delivery.id }), "Redelivery"),
                            )
                          }
                        >
                          Redeliver
                        </Button>
                      ) : null}
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        )}
      </section>

      <ConfirmationDialog
        open={confirm === "rotate"}
        title="Rotate the signing secret?"
        message="Requests are signed with the new secret straight away, so update your receiver before the next event."
        confirmLabel="Rotate secret"
        destructive={false}
        loading={pending}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          setConfirm(null);
          run(() => rotateWebhookSecret(base), "Signing secret rotated", (result) => {
            const data = result.ok ? (result.data as { secret?: string } | undefined) : undefined;
            if (data?.secret) setSecret(data.secret);
          });
        }}
      />
      <ConfirmationDialog
        open={confirm === "disable"}
        title="Turn off this endpoint?"
        message="Yuyu stops sending events to it. Events that are waiting to be retried are marked as failed; you can redeliver them later."
        confirmLabel="Disable endpoint"
        loading={pending}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          setConfirm(null);
          run(() => setWebhookEndpointEnabled({ ...base, enabled: false }), "Webhook endpoint turned off");
        }}
      />
      <ConfirmationDialog
        open={confirm === "delete"}
        title="Delete this webhook endpoint?"
        message={`${endpoint.host} stops receiving events and its delivery history is removed. This cannot be undone.`}
        confirmLabel="Delete endpoint"
        loading={pending}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          setConfirm(null);
          startTransition(async () => {
            const result = await deleteWebhookEndpoint(base);
            if (!result.ok) return showToast(result.error, "error");
            showToast("Webhook endpoint deleted", "success");
            router.push(`/dashboard/${props.organisationSlug}/settings/webhooks`);
          });
        }}
      />
    </div>
  );
}
