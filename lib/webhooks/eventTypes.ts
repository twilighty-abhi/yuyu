/**
 * Outgoing webhook event types (docs/WEBHOOKS.md). Shared by the server and the
 * settings UI, so this module must stay free of server-only imports.
 */
export const WEBHOOK_EVENT_TYPES = [
  "registration.created",
  "registration.status_changed",
  "checkin.created",
  "checkin.undone",
  "event.published",
  "event.cancelled",
  "feedback.submitted",
] as const;

export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];

/** The test event. Always deliverable through "Send test"; never subscribed to. */
export const WEBHOOK_PING_EVENT = "ping" as const;

export type WebhookEnvelopeType = WebhookEventType | typeof WEBHOOK_PING_EVENT;

export const WEBHOOK_EVENT_LABELS: Record<WebhookEventType, { label: string; description: string }> = {
  "registration.created": { label: "Registration created", description: "Someone registers, or an organiser adds a guest." },
  "registration.status_changed": { label: "Registration status changed", description: "Approved, declined, re-accepted, promoted from the waitlist, cancelled or removed." },
  "checkin.created": { label: "Checked in", description: "An attendee is checked in at the entrance." },
  "checkin.undone": { label: "Check-in undone", description: "An entrance check-in is reversed." },
  "event.published": { label: "Event published", description: "An event goes live." },
  "event.cancelled": { label: "Event cancelled", description: "An event is marked as cancelled." },
  "feedback.submitted": { label: "Feedback submitted", description: "Someone submits the feedback form (no answers are sent)." },
};

export const MAX_WEBHOOK_ENDPOINTS_PER_ORGANISATION = 10;

export function isWebhookEventType(value: unknown): value is WebhookEventType {
  return typeof value === "string" && (WEBHOOK_EVENT_TYPES as readonly string[]).includes(value);
}

/** Endpoint state shown in the settings UI: on, switched off by a person, or switched off after repeated failures. */
export type WebhookEndpointState = "enabled" | "disabled" | "auto_disabled";
