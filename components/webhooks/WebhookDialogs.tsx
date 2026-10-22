"use client";

import { useState } from "react";
import { Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CheckboxCard } from "@/components/ui/choice";
import { Callout } from "@/components/ui/display";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/field";
import { useToast } from "@/components/feedback/ToastProvider";
import { WEBHOOK_EVENT_LABELS, WEBHOOK_EVENT_TYPES, type WebhookEventType } from "@/lib/webhooks/eventTypes";

/** Reveal-once panel for a new or rotated signing secret. */
export function WebhookSecretDialog(props: { secret: string | null; onClose: () => void }) {
  const { showToast } = useToast();
  return (
    <Dialog open={Boolean(props.secret)} onOpenChange={(next) => { if (!next) props.onClose(); }}>
      <DialogContent size="md">
        <DialogHeader title="Copy your signing secret" description="Use it to check the x-yuyu-signature header on every request." />
        <DialogBody className="flex flex-col gap-4">
          <Callout tone="warning">
            Yuyu shows this secret only once. Store it with the receiving application; if it is lost, rotate it.
          </Callout>
          <code data-testid="webhook-secret" className="block select-all break-all rounded-md bg-inverse px-4 py-3 font-mono text-sm text-on-inverse">
            {props.secret}
          </code>
        </DialogBody>
        <DialogFooter>
          <Button
            variant="secondary"
            startIcon={<Copy />}
            onClick={async () => {
              if (!props.secret) return;
              try {
                await navigator.clipboard.writeText(props.secret);
                showToast("Secret copied", "success");
              } catch {
                showToast("Copy failed. Select the secret and copy it instead.", "error");
              }
            }}
          >
            Copy secret
          </Button>
          <Button variant="primary" onClick={props.onClose}>
            I have stored it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export type WebhookFormValues = { url: string; description: string; eventTypes: WebhookEventType[] };

/** Add or edit an endpoint: URL, optional description and the subscribed events. */
export function WebhookEndpointFormDialog(props: {
  open: boolean;
  mode: "create" | "edit";
  initial?: WebhookFormValues;
  pending: boolean;
  error: string | null;
  onSubmit: (values: WebhookFormValues) => void;
  onClose: () => void;
}) {
  const [eventTypes, setEventTypes] = useState<WebhookEventType[]>(props.initial?.eventTypes ?? ["registration.created"]);
  return (
    <Dialog open={props.open} onOpenChange={(next) => { if (!next && !props.pending) props.onClose(); }}>
      <DialogContent size="md">
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            props.onSubmit({
              url: String(form.get("url") ?? ""),
              description: String(form.get("description") ?? ""),
              eventTypes,
            });
          }}
        >
          <DialogHeader
            title={props.mode === "create" ? "Add webhook endpoint" : "Edit webhook endpoint"}
            description="Yuyu sends a signed POST request to this URL when the events you choose happen."
          />
          <DialogBody className="flex flex-col gap-5">
            <Field label="Endpoint URL" required helperText="A public https:// address on port 443 or 8443.">
              <Input name="url" type="url" inputMode="url" autoComplete="off" spellCheck={false} maxLength={2048} placeholder="https://example.com/yuyu-webhooks" defaultValue={props.initial?.url} />
            </Field>
            <Field label="Description" optional>
              <Input name="description" maxLength={200} defaultValue={props.initial?.description} />
            </Field>
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-2 text-label text-ink">Events to send</legend>
              <div className="grid gap-2.5 sm:grid-cols-2">
                {WEBHOOK_EVENT_TYPES.map((type) => (
                  <CheckboxCard
                    key={type}
                    label={WEBHOOK_EVENT_LABELS[type].label}
                    description={<><span className="font-mono">{type}</span> · {WEBHOOK_EVENT_LABELS[type].description}</>}
                    checked={eventTypes.includes(type)}
                    onCheckedChange={(checked) =>
                      setEventTypes((current) => (checked === true ? [...current, type] : current.filter((item) => item !== type)))
                    }
                  />
                ))}
              </div>
            </fieldset>
            {props.error ? <Callout tone="danger" role="alert">{props.error}</Callout> : null}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={props.onClose} disabled={props.pending}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={props.pending} disabled={eventTypes.length === 0}>
              {props.mode === "create" ? "Add endpoint" : "Save changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
