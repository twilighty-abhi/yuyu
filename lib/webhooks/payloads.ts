import { EventStatus, RsvpStatus } from "@prisma/client";
import { z } from "zod";

/**
 * Webhook payload DTOs (docs/WEBHOOKS.md#payloads).
 *
 * Deliberately minimal and explicit, consistent with the machine API's
 * participant/event DTOs: ids, statuses, timestamps, the event title/slug and
 * the attendee's display name. Like the machine API, payloads carry no email
 * address or other contact data, no user ids, no registration or feedback
 * answers, and no ticket, check-in, certificate or invitation capabilities.
 * Every object is a strict Zod schema, so an extra field fails loudly.
 */

export const REGISTRATION_WEBHOOK_STATUSES = [
  RsvpStatus.CONFIRMED,
  RsvpStatus.WAITLISTED,
  RsvpStatus.PENDING_APPROVAL,
  RsvpStatus.REJECTED,
  "CANCELLED",
  "REMOVED",
] as const;
export type RegistrationWebhookStatus = (typeof REGISTRATION_WEBHOOK_STATUSES)[number];

const isoDate = z.string().datetime();

export const webhookEventRefSchema = z.object({
  kind: z.enum(["event", "series_occurrence"]),
  id: z.string(),
  occurrenceId: z.string().nullable(),
  title: z.string(),
  slug: z.string(),
  startDateTime: isoDate,
  endDateTime: isoDate,
  timezone: z.string(),
}).strict();

export const webhookRegistrationSchema = z.object({
  id: z.string(),
  status: z.enum(REGISTRATION_WEBHOOK_STATUSES),
  displayName: z.string(),
  registeredAt: isoDate,
  checkedInAt: isoDate.nullable(),
}).strict();

const registrationCreatedData = z.object({ event: webhookEventRefSchema, registration: webhookRegistrationSchema }).strict();
const registrationStatusData = z.object({
  event: webhookEventRefSchema,
  registration: webhookRegistrationSchema,
  previousStatus: z.enum(REGISTRATION_WEBHOOK_STATUSES).nullable(),
}).strict();
const checkInCreatedData = z.object({ event: webhookEventRefSchema, registration: webhookRegistrationSchema, checkedInAt: isoDate }).strict();
const checkInUndoneData = z.object({ event: webhookEventRefSchema, registration: webhookRegistrationSchema, undoneAt: isoDate }).strict();
const eventStatusData = z.object({
  event: webhookEventRefSchema.extend({ status: z.nativeEnum(EventStatus) }).strict(),
  previousStatus: z.nativeEnum(EventStatus).nullable(),
}).strict();
const feedbackData = z.object({
  event: webhookEventRefSchema,
  feedback: z.object({ id: z.string(), submittedAt: isoDate }).strict(),
}).strict();
const pingData = z.object({ endpointId: z.string(), message: z.string() }).strict();

export const webhookDataSchemas = {
  "registration.created": registrationCreatedData,
  "registration.status_changed": registrationStatusData,
  "checkin.created": checkInCreatedData,
  "checkin.undone": checkInUndoneData,
  "event.published": eventStatusData,
  "event.cancelled": eventStatusData,
  "feedback.submitted": feedbackData,
  ping: pingData,
} as const;

export type WebhookDataType = keyof typeof webhookDataSchemas;

export const webhookEnvelopeSchema = z.object({
  id: z.string().regex(/^evt_[0-9a-f]{32}$/),
  type: z.enum(Object.keys(webhookDataSchemas) as [WebhookDataType, ...WebhookDataType[]]),
  createdAt: isoDate,
  organisation: z.object({ id: z.string(), slug: z.string() }).strict(),
  data: z.record(z.string(), z.unknown()),
}).strict();

export type WebhookEnvelope = z.infer<typeof webhookEnvelopeSchema>;

/** Validates `data` against its type's strict schema and returns a clean envelope. */
export function buildWebhookEnvelope(params: {
  id: string;
  type: WebhookDataType;
  createdAt: Date;
  organisation: { id: string; slug: string };
  data: unknown;
}): WebhookEnvelope {
  const data = webhookDataSchemas[params.type].parse(params.data) as Record<string, unknown>;
  return webhookEnvelopeSchema.parse({
    id: params.id,
    type: params.type,
    createdAt: params.createdAt.toISOString(),
    organisation: { id: params.organisation.id, slug: params.organisation.slug },
    data,
  });
}

// ---------------------------------------------------------------------------
// Pure mappers. Inputs may be wider Prisma rows; only allow-listed fields are copied.

export type EventRefSource =
  | {
      kind: "event";
      event: { id: string; title: string; slug: string; startDateTime: Date; endDateTime: Date; timezone: string };
    }
  | {
      kind: "series_occurrence";
      instance: { id: string; startDateTime: Date; endDateTime: Date };
      series: { id: string; title: string; slug: string; timezone: string };
    };

export function webhookEventRef(source: EventRefSource): z.infer<typeof webhookEventRefSchema> {
  if (source.kind === "event") {
    return {
      kind: "event",
      id: source.event.id,
      occurrenceId: null,
      title: source.event.title,
      slug: source.event.slug,
      startDateTime: source.event.startDateTime.toISOString(),
      endDateTime: source.event.endDateTime.toISOString(),
      timezone: source.event.timezone,
    };
  }
  return {
    kind: "series_occurrence",
    id: source.series.id,
    occurrenceId: source.instance.id,
    title: source.series.title,
    slug: source.series.slug,
    startDateTime: source.instance.startDateTime.toISOString(),
    endDateTime: source.instance.endDateTime.toISOString(),
    timezone: source.series.timezone,
  };
}

export function webhookRegistration(
  rsvp: { id: string; guestName: string | null; createdAt: Date; checkedInAt: Date | null; user?: { name: string | null } | null },
  status: RegistrationWebhookStatus,
): z.infer<typeof webhookRegistrationSchema> {
  return {
    id: rsvp.id,
    status,
    // Same fallback as the machine API participant DTO.
    displayName: rsvp.user?.name?.trim() || rsvp.guestName?.trim() || "Participant",
    registeredAt: rsvp.createdAt.toISOString(),
    checkedInAt: rsvp.checkedInAt?.toISOString() ?? null,
  };
}
