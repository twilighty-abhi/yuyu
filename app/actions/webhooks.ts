"use server";

import { WebhookDeliveryStatus } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { canManageWebhooks, getMembership } from "@/lib/permissions";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import { recordAuditEvent } from "@/lib/audit";
import { MAX_WEBHOOK_ENDPOINTS_PER_ORGANISATION, WEBHOOK_EVENT_TYPES } from "@/lib/webhooks/eventTypes";
import { generateWebhookSecret } from "@/lib/webhooks/signature";
import { encryptWebhookSecret } from "@/lib/webhooks/secrets";
import {
  parseWebhookUrl,
  resolveWebhookTarget,
  webhookHostLabel,
  webhookPrivateTargetsAllowed,
  WebhookTargetBlockedError,
} from "@/lib/webhooks/urlSafety";
import { enqueueWebhookPing } from "@/lib/webhooks/emit";
import { deliverWebhookNow } from "@/lib/webhooks/delivery";
import type { ActionResult } from "./org";

const NOT_FOUND = "Webhook endpoint not found.";

const organisationSlug = z.string().trim().min(1).max(120);
const endpointId = z.string().trim().min(1).max(128);
const endpointFields = {
  url: z.string().trim().min(1).max(2048),
  description: z.string().trim().max(200).default(""),
  eventTypes: z.array(z.enum(WEBHOOK_EVENT_TYPES)).min(1).max(WEBHOOK_EVENT_TYPES.length).transform((items) => [...new Set(items)]),
};
const createSchema = z.object({ organisationSlug, ...endpointFields }).strict();
const updateSchema = z.object({ organisationSlug, endpointId, ...endpointFields }).strict();
const endpointSchema = z.object({ organisationSlug, endpointId }).strict();
const enabledSchema = z.object({ organisationSlug, endpointId, enabled: z.boolean() }).strict();
const redeliverSchema = z.object({ organisationSlug, endpointId, deliveryId: z.string().trim().min(1).max(128) }).strict();

type Access = { error: string } | { userId: string; organisation: { id: string; slug: string } };

/** Organisation OWNER/ADMIN only (`canManageWebhooks`); collaborators and members never qualify. */
async function requireWebhookAdmin(slug: string, bucket: "webhookManage" | "webhookTest"): Promise<Access> {
  const session = await auth();
  if (!session?.user?.id) return { error: "You must be signed in." };
  const organisation = await prisma.organisation.findUnique({ where: { slug }, select: { id: true, slug: true } });
  if (!organisation) return { error: "Organisation not found." };
  const membership = await getMembership(session.user.id, organisation.id);
  if (!canManageWebhooks(membership)) return { error: "Only organisation owners and admins can manage webhooks." };
  if (await isActionRateLimited(bucket, session.user.id)) {
    return { error: bucket === "webhookTest" ? "Too many test sends. Try again later." : "Too many webhook changes. Try again shortly." };
  }
  return { userId: session.user.id, organisation };
}

function revalidate(slug: string, id?: string) {
  revalidatePath(`/dashboard/${slug}/settings`);
  revalidatePath(`/dashboard/${slug}/settings/webhooks`);
  if (id) revalidatePath(`/dashboard/${slug}/settings/webhooks/${id}`);
}

/** Save-time SSRF check: URL rules, then DNS, with every resolved address vetted. */
async function validateTarget(raw: string): Promise<{ url: string } | { error: string }> {
  const allowPrivate = webhookPrivateTargetsAllowed();
  const parsed = parseWebhookUrl(raw, { allowPrivate });
  if (!parsed.ok) return { error: parsed.error };
  try {
    await resolveWebhookTarget(parsed.url, { allowPrivate });
  } catch (error) {
    if (error instanceof WebhookTargetBlockedError) return { error: "This host resolves to a private or reserved address. Use a public host." };
    return { error: "We couldn't find that host. Check the URL and try again." };
  }
  return { url: parsed.url };
}

export async function createWebhookEndpoint(input: unknown): Promise<ActionResult<{ endpointId: string; secret: string }>> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Enter a URL and choose at least one event." };
  const access = await requireWebhookAdmin(parsed.data.organisationSlug, "webhookManage");
  if ("error" in access) return { ok: false, error: access.error };
  const target = await validateTarget(parsed.data.url);
  if ("error" in target) return { ok: false, error: target.error };

  const secret = generateWebhookSecret();
  const created = await prisma.$transaction(async (tx) => {
    // Serialise creations per organisation so the endpoint cap holds under races.
    await tx.$queryRaw`SELECT "id" FROM "Organisation" WHERE "id" = ${access.organisation.id} FOR UPDATE`;
    const count = await tx.webhookEndpoint.count({ where: { organisationId: access.organisation.id } });
    if (count >= MAX_WEBHOOK_ENDPOINTS_PER_ORGANISATION) return null;
    const endpoint = await tx.webhookEndpoint.create({
      data: {
        organisationId: access.organisation.id,
        url: target.url,
        description: parsed.data.description,
        eventTypes: parsed.data.eventTypes,
        secretEncrypted: encryptWebhookSecret(secret),
        createdByUserId: access.userId,
      },
      select: { id: true },
    });
    await recordAuditEvent({
      action: "WEBHOOK_ENDPOINT_CREATED",
      actorUserId: access.userId,
      organisationId: access.organisation.id,
      targetType: "WebhookEndpoint",
      targetId: endpoint.id,
      metadata: { host: webhookHostLabel(target.url), eventTypeCount: parsed.data.eventTypes.length },
      client: tx,
    });
    return endpoint;
  });
  if (!created) return { ok: false, error: `An organisation can have up to ${MAX_WEBHOOK_ENDPOINTS_PER_ORGANISATION} webhook endpoints.` };
  revalidate(access.organisation.slug, created.id);
  return { ok: true, data: { endpointId: created.id, secret } };
}

export async function updateWebhookEndpoint(input: unknown): Promise<ActionResult> {
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Enter a URL and choose at least one event." };
  const access = await requireWebhookAdmin(parsed.data.organisationSlug, "webhookManage");
  if ("error" in access) return { ok: false, error: access.error };
  const existing = await prisma.webhookEndpoint.findFirst({
    where: { id: parsed.data.endpointId, organisationId: access.organisation.id },
    select: { id: true, url: true },
  });
  if (!existing) return { ok: false, error: NOT_FOUND };
  const target = await validateTarget(parsed.data.url);
  if ("error" in target) return { ok: false, error: target.error };
  await prisma.$transaction(async (tx) => {
    await tx.webhookEndpoint.update({
      where: { id: existing.id },
      data: { url: target.url, description: parsed.data.description, eventTypes: parsed.data.eventTypes },
    });
    await recordAuditEvent({
      action: "WEBHOOK_ENDPOINT_UPDATED",
      actorUserId: access.userId,
      organisationId: access.organisation.id,
      targetType: "WebhookEndpoint",
      targetId: existing.id,
      metadata: { host: webhookHostLabel(target.url), eventTypeCount: parsed.data.eventTypes.length, urlChanged: existing.url !== target.url },
      client: tx,
    });
  });
  revalidate(access.organisation.slug, existing.id);
  return { ok: true };
}

export async function deleteWebhookEndpoint(input: unknown): Promise<ActionResult> {
  const parsed = endpointSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: NOT_FOUND };
  const access = await requireWebhookAdmin(parsed.data.organisationSlug, "webhookManage");
  if ("error" in access) return { ok: false, error: access.error };
  const existing = await prisma.webhookEndpoint.findFirst({
    where: { id: parsed.data.endpointId, organisationId: access.organisation.id },
    select: { id: true, url: true },
  });
  if (!existing) return { ok: false, error: NOT_FOUND };
  await prisma.$transaction(async (tx) => {
    await tx.webhookEndpoint.delete({ where: { id: existing.id } });
    await recordAuditEvent({
      action: "WEBHOOK_ENDPOINT_DELETED",
      actorUserId: access.userId,
      organisationId: access.organisation.id,
      targetType: "WebhookEndpoint",
      targetId: existing.id,
      metadata: { host: webhookHostLabel(existing.url) },
      client: tx,
    });
  });
  revalidate(access.organisation.slug);
  return { ok: true };
}

export async function rotateWebhookSecret(input: unknown): Promise<ActionResult<{ secret: string }>> {
  const parsed = endpointSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: NOT_FOUND };
  const access = await requireWebhookAdmin(parsed.data.organisationSlug, "webhookManage");
  if ("error" in access) return { ok: false, error: access.error };
  const existing = await prisma.webhookEndpoint.findFirst({
    where: { id: parsed.data.endpointId, organisationId: access.organisation.id },
    select: { id: true, url: true },
  });
  if (!existing) return { ok: false, error: NOT_FOUND };
  const secret = generateWebhookSecret();
  await prisma.$transaction(async (tx) => {
    await tx.webhookEndpoint.update({ where: { id: existing.id }, data: { secretEncrypted: encryptWebhookSecret(secret) } });
    await recordAuditEvent({
      action: "WEBHOOK_SECRET_ROTATED",
      actorUserId: access.userId,
      organisationId: access.organisation.id,
      targetType: "WebhookEndpoint",
      targetId: existing.id,
      metadata: { host: webhookHostLabel(existing.url) },
      client: tx,
    });
  });
  revalidate(access.organisation.slug, existing.id);
  return { ok: true, data: { secret } };
}

export async function setWebhookEndpointEnabled(input: unknown): Promise<ActionResult> {
  const parsed = enabledSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: NOT_FOUND };
  const access = await requireWebhookAdmin(parsed.data.organisationSlug, "webhookManage");
  if ("error" in access) return { ok: false, error: access.error };
  const existing = await prisma.webhookEndpoint.findFirst({
    where: { id: parsed.data.endpointId, organisationId: access.organisation.id },
    select: { id: true, url: true, enabled: true },
  });
  if (!existing) return { ok: false, error: NOT_FOUND };
  if (existing.enabled === parsed.data.enabled) return { ok: true };
  await prisma.$transaction(async (tx) => {
    await tx.webhookEndpoint.update({
      where: { id: existing.id },
      data: parsed.data.enabled
        ? { enabled: true, disabledReason: null, disabledAt: null, consecutiveFailures: 0 }
        : { enabled: false, disabledReason: null, disabledAt: new Date() },
    });
    if (!parsed.data.enabled) {
      // Queued events for a switched-off endpoint stay in the log as failed; Redeliver resends them.
      await tx.webhookDelivery.updateMany({
        where: { endpointId: existing.id, status: WebhookDeliveryStatus.PENDING },
        data: { status: WebhookDeliveryStatus.FAILED, lastError: "Endpoint disabled" },
      });
    }
    await recordAuditEvent({
      action: parsed.data.enabled ? "WEBHOOK_ENDPOINT_ENABLED" : "WEBHOOK_ENDPOINT_DISABLED",
      actorUserId: access.userId,
      organisationId: access.organisation.id,
      targetType: "WebhookEndpoint",
      targetId: existing.id,
      metadata: { host: webhookHostLabel(existing.url) },
      client: tx,
    });
  });
  revalidate(access.organisation.slug, existing.id);
  return { ok: true };
}

type TestResult = { delivered: boolean; statusCode: number | null; error: string | null; responseTimeMs: number | null };

function toTestResult(outcome: Awaited<ReturnType<typeof deliverWebhookNow>>): TestResult {
  if (!outcome) return { delivered: false, statusCode: null, error: "Queued; the next delivery run will send it.", responseTimeMs: null };
  return { delivered: outcome.ok, statusCode: outcome.statusCode, error: outcome.error, responseTimeMs: outcome.responseTimeMs };
}

/** Sends a signed `ping` to one endpoint now and reports the response. */
export async function sendWebhookTest(input: unknown): Promise<ActionResult<TestResult>> {
  const parsed = endpointSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: NOT_FOUND };
  const access = await requireWebhookAdmin(parsed.data.organisationSlug, "webhookTest");
  if ("error" in access) return { ok: false, error: access.error };
  const endpoint = await prisma.webhookEndpoint.findFirst({
    where: { id: parsed.data.endpointId, organisationId: access.organisation.id },
    select: { id: true, enabled: true },
  });
  if (!endpoint) return { ok: false, error: NOT_FOUND };
  if (!endpoint.enabled) return { ok: false, error: "Turn the endpoint on before sending a test." };
  const deliveryId = await enqueueWebhookPing({ id: endpoint.id, organisation: access.organisation });
  const result = toTestResult(await deliverWebhookNow(deliveryId));
  revalidate(access.organisation.slug, endpoint.id);
  return { ok: true, data: result };
}

/** Resends one failed delivery with the same event id (receivers can de-duplicate on it). */
export async function redeliverWebhook(input: unknown): Promise<ActionResult<TestResult>> {
  const parsed = redeliverSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: NOT_FOUND };
  const access = await requireWebhookAdmin(parsed.data.organisationSlug, "webhookTest");
  if ("error" in access) return { ok: false, error: access.error };
  const delivery = await prisma.webhookDelivery.findFirst({
    where: {
      id: parsed.data.deliveryId,
      endpointId: parsed.data.endpointId,
      organisationId: access.organisation.id,
      endpoint: { organisationId: access.organisation.id },
    },
    select: { id: true, status: true, endpoint: { select: { id: true, enabled: true } } },
  });
  if (!delivery) return { ok: false, error: "Delivery not found." };
  if (!delivery.endpoint.enabled) return { ok: false, error: "Turn the endpoint on before redelivering." };
  if (delivery.status !== WebhookDeliveryStatus.FAILED) return { ok: false, error: "Only failed deliveries can be redelivered." };
  const reset = await prisma.webhookDelivery.updateMany({
    where: { id: delivery.id, status: WebhookDeliveryStatus.FAILED },
    data: { status: WebhookDeliveryStatus.PENDING, attempts: 0, nextAttemptAt: new Date(), lastError: null },
  });
  if (reset.count !== 1) return { ok: false, error: "This delivery changed; refresh and try again." };
  const result = toTestResult(await deliverWebhookNow(delivery.id));
  revalidate(access.organisation.slug, delivery.endpoint.id);
  return { ok: true, data: result };
}
