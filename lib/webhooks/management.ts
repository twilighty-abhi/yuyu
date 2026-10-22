import "server-only";

import { WebhookDeliveryStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { isWebhookEventType, type WebhookEndpointState, type WebhookEventType } from "@/lib/webhooks/eventTypes";
import { webhookHostLabel } from "@/lib/webhooks/urlSafety";
import { WEBHOOK_AUTO_DISABLED_REASON } from "@/lib/webhooks/delivery";

/**
 * Read models for the organisation webhook settings. Explicit selects only:
 * the encrypted secret and delivery payloads never reach a page or client.
 * Every query carries the organisation predicate.
 */

export type { WebhookEndpointState };

export type WebhookEndpointSummary = {
  id: string;
  url: string;
  host: string;
  description: string;
  eventTypes: WebhookEventType[];
  state: WebhookEndpointState;
  consecutiveFailures: number;
  disabledAt: string | null;
  createdAt: string;
  updatedAt: string;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastDelivery: { status: WebhookDeliveryStatus; statusCode: number | null; at: string } | null;
};

export type WebhookDeliveryRow = {
  id: string;
  eventId: string;
  eventType: string;
  status: WebhookDeliveryStatus;
  attempts: number;
  lastStatusCode: number | null;
  lastError: string | null;
  responseTimeMs: number | null;
  createdAt: string;
  lastAttemptAt: string | null;
  nextAttemptAt: string | null;
};

const endpointSelect = {
  id: true,
  url: true,
  description: true,
  eventTypes: true,
  enabled: true,
  disabledReason: true,
  disabledAt: true,
  consecutiveFailures: true,
  createdAt: true,
  updatedAt: true,
  lastSuccessAt: true,
  lastFailureAt: true,
  deliveries: {
    orderBy: { createdAt: "desc" },
    take: 1,
    select: { status: true, lastStatusCode: true, lastAttemptAt: true, createdAt: true },
  },
} as const;

type EndpointRecord = {
  id: string;
  url: string;
  description: string;
  eventTypes: string[];
  enabled: boolean;
  disabledReason: string | null;
  disabledAt: Date | null;
  consecutiveFailures: number;
  createdAt: Date;
  updatedAt: Date;
  lastSuccessAt: Date | null;
  lastFailureAt: Date | null;
  deliveries: Array<{ status: WebhookDeliveryStatus; lastStatusCode: number | null; lastAttemptAt: Date | null; createdAt: Date }>;
};

function summary(record: EndpointRecord): WebhookEndpointSummary {
  const last = record.deliveries[0];
  return {
    id: record.id,
    url: record.url,
    host: webhookHostLabel(record.url),
    description: record.description,
    eventTypes: record.eventTypes.filter(isWebhookEventType),
    state: record.enabled ? "enabled" : record.disabledReason === WEBHOOK_AUTO_DISABLED_REASON ? "auto_disabled" : "disabled",
    consecutiveFailures: record.consecutiveFailures,
    disabledAt: record.disabledAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    lastSuccessAt: record.lastSuccessAt?.toISOString() ?? null,
    lastFailureAt: record.lastFailureAt?.toISOString() ?? null,
    lastDelivery: last ? { status: last.status, statusCode: last.lastStatusCode, at: (last.lastAttemptAt ?? last.createdAt).toISOString() } : null,
  };
}

export async function listWebhookEndpoints(organisationId: string) {
  const rows = await prisma.webhookEndpoint.findMany({
    where: { organisationId },
    orderBy: { createdAt: "asc" },
    select: endpointSelect,
  });
  return rows.map(summary);
}

export async function getWebhookEndpointDetail(organisationId: string, endpointId: string) {
  const record = await prisma.webhookEndpoint.findFirst({ where: { id: endpointId, organisationId }, select: endpointSelect });
  if (!record) return null;
  const deliveries = await prisma.webhookDelivery.findMany({
    where: { endpointId: record.id, organisationId },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      eventId: true,
      eventType: true,
      status: true,
      attempts: true,
      lastStatusCode: true,
      lastError: true,
      responseTimeMs: true,
      createdAt: true,
      lastAttemptAt: true,
      nextAttemptAt: true,
    },
  });
  return {
    endpoint: summary(record),
    deliveries: deliveries.map((row): WebhookDeliveryRow => ({
      ...row,
      createdAt: row.createdAt.toISOString(),
      lastAttemptAt: row.lastAttemptAt?.toISOString() ?? null,
      nextAttemptAt: row.status === WebhookDeliveryStatus.PENDING ? row.nextAttemptAt.toISOString() : null,
    })),
  };
}

export async function countWebhookEndpoints(organisationId: string) {
  const [total, enabled] = await Promise.all([
    prisma.webhookEndpoint.count({ where: { organisationId } }),
    prisma.webhookEndpoint.count({ where: { organisationId, enabled: true } }),
  ]);
  return { total, enabled };
}
