import "server-only";

import http from "node:http";
import https from "node:https";
import net from "node:net";
import { Prisma, WebhookDeliveryStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { sqlUtcTimestamp } from "@/lib/sqlTimestamp";
import { recordAuditEvent } from "@/lib/audit";
import { decryptWebhookSecret } from "@/lib/webhooks/secrets";
import { webhookSignatureHeader } from "@/lib/webhooks/signature";
import {
  pinnedLookup,
  resolveWebhookTarget,
  webhookHostLabel,
  webhookPrivateTargetsAllowed,
  WebhookTargetBlockedError,
} from "@/lib/webhooks/urlSafety";
import { redactAlertText } from "@/lib/opsAlerts";

/**
 * Webhook delivery worker (docs/WEBHOOKS.md#delivery-and-retries).
 *
 * Runs inside the existing one-minute outbox scheduler (lib/outboxWorker.ts)
 * and the `POST /api/internal/outbox` recovery route. Rows are claimed with
 * `FOR UPDATE SKIP LOCKED` and finished under a lease (`lockedAt`), so
 * concurrent replicas never deliver the same attempt twice.
 */

export const WEBHOOK_TIMEOUT_MS = 10_000;
export const WEBHOOK_MAX_PAYLOAD_BYTES = 256 * 1024;
export const WEBHOOK_MAX_ATTEMPTS = 8;
export const WEBHOOK_AUTO_DISABLE_AFTER = 20;
export const WEBHOOK_AUTO_DISABLED_REASON = "auto_disabled";
const STALE_LEASE_MS = 5 * 60_000;
const BATCH_SIZE = 25;
const CONCURRENCY = 5;
const RESPONSE_EXCERPT_BYTES = 512;
const USER_AGENT = "Yuyu-Webhooks/1";

/** Nominal wait after failed attempt n (1-based): 1 m, 5 m, 30 m, 1 h, 3 h, 6 h, 12 h ≈ 22.6 h in total. */
export const WEBHOOK_RETRY_DELAYS_MS = [60_000, 5 * 60_000, 30 * 60_000, 60 * 60_000, 3 * 60 * 60_000, 6 * 60 * 60_000, 12 * 60 * 60_000] as const;

/** Backoff with ±20% jitter so many endpoints that failed together do not retry in lockstep. */
export function webhookRetryDelayMs(failedAttempt: number, random: () => number = Math.random) {
  const index = Math.min(Math.max(failedAttempt, 1), WEBHOOK_RETRY_DELAYS_MS.length) - 1;
  const base = WEBHOOK_RETRY_DELAYS_MS[index]!;
  const jitter = 0.8 + Math.min(Math.max(random(), 0), 1) * 0.4;
  return Math.round(base * jitter);
}

export class WebhookDeliveryError extends Error {
  override name = "WebhookDeliveryError";
  constructor(message: string, readonly permanent = false) {
    super(message);
  }
}

/** Short, UI-safe reason. Never contains the URL, a secret, or more than a body excerpt. */
export function describeWebhookFailure(error: unknown) {
  if (error instanceof WebhookTargetBlockedError) return "Blocked: the host is private, reserved or not allowed";
  if (error instanceof WebhookDeliveryError) return error.message;
  const code = error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : "";
  switch (code) {
    case "ENOTFOUND":
    case "EAI_AGAIN":
      return "Host not found";
    case "ECONNREFUSED":
      return "Connection refused";
    case "ECONNRESET":
      return "Connection reset";
    case "ETIMEDOUT":
      return "Timed out";
    case "EHOSTUNREACH":
    case "ENETUNREACH":
      return "Host unreachable";
    default:
      if (/^(ERR_TLS|CERT_|UNABLE_TO|DEPTH_ZERO|SELF_SIGNED|ERR_SSL)/.test(code)) return `TLS error (${code})`;
      return /^[A-Z0-9_]{1,40}$/.test(code) ? `Network error (${code})` : "Network error";
  }
}

function sanitizeExcerpt(raw: Buffer) {
  const text = raw.toString("utf8").replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
  return text ? redactAlertText(text, 120) : "";
}

export type WebhookHttpResult = { statusCode: number; responseTimeMs: number; excerpt: string };

/**
 * POST with a hard timeout, no redirects (Node's http client never follows
 * them; a 3xx is reported as a failure) and a socket pinned to the vetted
 * address. Only a short response excerpt is read.
 */
export async function postWebhook(params: { url: string; body: string; headers: Record<string, string>; timeoutMs?: number }): Promise<WebhookHttpResult> {
  const allowPrivate = webhookPrivateTargetsAllowed();
  const body = Buffer.from(params.body, "utf8");
  if (body.length > WEBHOOK_MAX_PAYLOAD_BYTES) throw new WebhookDeliveryError("Payload too large", true);
  const started = performance.now();
  const timeoutMs = params.timeoutMs ?? WEBHOOK_TIMEOUT_MS;
  const deadline = AbortSignal.timeout(timeoutMs);
  const addresses = await Promise.race([
    resolveWebhookTarget(params.url, { allowPrivate }),
    new Promise<never>((_, reject) => deadline.addEventListener("abort", () => reject(new WebhookDeliveryError(`Timed out after ${timeoutMs / 1000} s`)), { once: true })),
  ]);
  const target = new URL(params.url);
  const hostname = target.hostname.replace(/^\[|\]$/g, "");
  const isHttps = target.protocol === "https:";
  const client = isHttps ? https : http;

  return await new Promise<WebhookHttpResult>((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const request = client.request(
      {
        protocol: target.protocol,
        hostname,
        port: target.port || (isHttps ? 443 : 80),
        path: `${target.pathname}${target.search}`,
        method: "POST",
        agent: false,
        lookup: pinnedLookup(addresses) as unknown as net.LookupFunction,
        ...(isHttps && !net.isIP(hostname) ? { servername: hostname } : {}),
        headers: { ...params.headers, "content-length": String(body.length) },
      },
      (response) => {
        const chunks: Buffer[] = [];
        let size = 0;
        const done = () =>
          finish(() =>
            resolve({
              statusCode: response.statusCode ?? 0,
              responseTimeMs: Math.round(performance.now() - started),
              excerpt: sanitizeExcerpt(Buffer.concat(chunks)),
            }),
          );
        response.on("data", (chunk: Buffer) => {
          if (size < RESPONSE_EXCERPT_BYTES) {
            chunks.push(chunk.subarray(0, RESPONSE_EXCERPT_BYTES - size));
            size += chunk.length;
          }
          if (size >= RESPONSE_EXCERPT_BYTES) {
            done();
            response.destroy();
          }
        });
        response.on("end", done);
        response.on("close", done);
        response.on("error", done);
      },
    );
    const timer = setTimeout(() => {
      finish(() => reject(new WebhookDeliveryError(`Timed out after ${timeoutMs / 1000} s`)));
      request.destroy();
    }, Math.max(1, timeoutMs - (performance.now() - started)));
    request.on("error", (error) => finish(() => reject(error)));
    request.end(body);
  });
}

type ClaimedRow = {
  id: string;
  endpointId: string;
  eventId: string;
  eventType: string;
  payload: Prisma.JsonValue;
  attempts: number;
  lockedAt: Date;
};

async function claimDeliveries(options: { limit: number; deliveryId?: string }) {
  const now = new Date();
  // `nextAttemptAt` is timestamp(3): a value written with sub-millisecond
  // precision is rounded, possibly up into the next millisecond, so a row
  // queued in this same millisecond counts as due.
  const dueBy = new Date(now.getTime() + 1);
  const byId = options.deliveryId ? Prisma.sql`AND "id" = ${options.deliveryId}` : Prisma.empty;
  return prisma.$queryRaw<ClaimedRow[]>`
    UPDATE "WebhookDelivery" AS d
    SET "status" = 'PROCESSING', "lockedAt" = ${sqlUtcTimestamp(now)}, "attempts" = d."attempts" + 1, "lastAttemptAt" = ${sqlUtcTimestamp(now)}
    WHERE d."id" IN (
      SELECT "id" FROM "WebhookDelivery"
      WHERE "status" = 'PENDING' AND "nextAttemptAt" <= ${sqlUtcTimestamp(dueBy)} ${byId}
      ORDER BY "nextAttemptAt" ASC
      LIMIT ${options.limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING d."id", d."endpointId", d."eventId", d."eventType", d."payload", d."attempts", d."lockedAt"
  `;
}

function leaseWhere(row: ClaimedRow) {
  return { id: row.id, status: WebhookDeliveryStatus.PROCESSING, lockedAt: row.lockedAt };
}

async function autoDisableEndpoint(endpoint: { id: string; organisationId: string; url: string }) {
  const now = new Date();
  const disabled = await prisma.webhookEndpoint.updateMany({
    where: { id: endpoint.id, enabled: true, consecutiveFailures: { gte: WEBHOOK_AUTO_DISABLE_AFTER } },
    data: { enabled: false, disabledReason: WEBHOOK_AUTO_DISABLED_REASON, disabledAt: now },
  });
  if (disabled.count !== 1) return;
  // Keep each queued delivery's own last failure ("Blocked: …", the HTTP
  // status) visible after the endpoint is switched off: it is usually the
  // reason the endpoint was disabled. Rows never attempted say why they stop.
  await prisma.$executeRaw`
    UPDATE "WebhookDelivery"
    SET "status" = 'FAILED',
        "lastError" = CASE WHEN "lastError" IS NULL THEN 'Endpoint disabled'
                           ELSE left('Endpoint disabled after: ' || "lastError", 300) END
    WHERE "endpointId" = ${endpoint.id} AND "status" = 'PENDING'`;
  await recordAuditEvent({
    action: "WEBHOOK_ENDPOINT_AUTO_DISABLED",
    organisationId: endpoint.organisationId,
    targetType: "WebhookEndpoint",
    targetId: endpoint.id,
    metadata: { host: webhookHostLabel(endpoint.url), consecutiveFailures: WEBHOOK_AUTO_DISABLE_AFTER },
  }).catch(() => undefined);
}

export type DeliveryOutcome = { id: string; ok: boolean; statusCode: number | null; error: string | null; responseTimeMs: number | null };

async function deliverClaimed(row: ClaimedRow): Promise<DeliveryOutcome> {
  const endpoint = await prisma.webhookEndpoint.findUnique({
    where: { id: row.endpointId },
    select: { id: true, organisationId: true, url: true, enabled: true, secretEncrypted: true },
  });
  if (!endpoint || !endpoint.enabled) {
    await prisma.webhookDelivery.updateMany({ where: leaseWhere(row), data: { status: WebhookDeliveryStatus.FAILED, lockedAt: null, lastError: "Endpoint disabled" } });
    return { id: row.id, ok: false, statusCode: null, error: "Endpoint disabled", responseTimeMs: null };
  }

  let statusCode: number | null = null;
  let responseTimeMs: number | null = null;
  let failure: string | null = null;
  let permanent = false;
  let countsAgainstEndpoint = true;
  try {
    const secret = (() => {
      try {
        return decryptWebhookSecret(endpoint.secretEncrypted);
      } catch {
        countsAgainstEndpoint = false;
        throw new WebhookDeliveryError("Signing secret unreadable; rotate the secret", true);
      }
    })();
    const body = JSON.stringify(row.payload);
    const timestamp = Math.floor(Date.now() / 1000);
    const result = await postWebhook({
      url: endpoint.url,
      body,
      headers: {
        "content-type": "application/json",
        "user-agent": USER_AGENT,
        "x-yuyu-event-id": row.eventId,
        "x-yuyu-event-type": row.eventType,
        "x-yuyu-signature": webhookSignatureHeader(secret, timestamp, body),
      },
    });
    statusCode = result.statusCode;
    responseTimeMs = result.responseTimeMs;
    if (statusCode < 200 || statusCode > 299) {
      const kind = statusCode >= 300 && statusCode < 400 ? "Redirect not followed" : "Unexpected response";
      failure = `${kind} (HTTP ${statusCode})${result.excerpt ? `: ${result.excerpt}` : ""}`;
    }
  } catch (error) {
    failure = describeWebhookFailure(error);
    permanent = error instanceof WebhookDeliveryError && error.permanent;
  }

  const now = new Date();
  if (!failure) {
    await prisma.webhookDelivery.updateMany({
      where: leaseWhere(row),
      data: { status: WebhookDeliveryStatus.SUCCEEDED, lockedAt: null, deliveredAt: now, lastStatusCode: statusCode, responseTimeMs, lastError: null },
    });
    await prisma.webhookEndpoint.update({ where: { id: endpoint.id }, data: { consecutiveFailures: 0, lastSuccessAt: now } });
    return { id: row.id, ok: true, statusCode, error: null, responseTimeMs };
  }

  const terminal = permanent || row.attempts >= WEBHOOK_MAX_ATTEMPTS;
  await prisma.webhookDelivery.updateMany({
    where: leaseWhere(row),
    data: {
      status: terminal ? WebhookDeliveryStatus.FAILED : WebhookDeliveryStatus.PENDING,
      lockedAt: null,
      nextAttemptAt: terminal ? now : new Date(now.getTime() + webhookRetryDelayMs(row.attempts)),
      lastStatusCode: statusCode,
      responseTimeMs,
      lastError: failure.slice(0, 300),
    },
  });
  if (countsAgainstEndpoint) {
    const updated = await prisma.webhookEndpoint.update({
      where: { id: endpoint.id },
      data: { consecutiveFailures: { increment: 1 }, lastFailureAt: now },
      select: { consecutiveFailures: true },
    });
    if (updated.consecutiveFailures >= WEBHOOK_AUTO_DISABLE_AFTER) await autoDisableEndpoint(endpoint);
  }
  return { id: row.id, ok: false, statusCode, error: failure, responseTimeMs };
}

async function runWithConcurrency<T, R>(items: T[], limit: number, work: (item: T) => Promise<R>) {
  const results: R[] = [];
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++]!;
      results.push(await work(item));
    }
  });
  await Promise.all(workers);
  return results;
}

/** One worker pass. Never throws for an individual delivery. */
export async function deliverWebhookBatch(limit = BATCH_SIZE) {
  // A worker may stop after claiming; hand stale leases back to the queue.
  await prisma.webhookDelivery.updateMany({
    where: { status: WebhookDeliveryStatus.PROCESSING, lockedAt: { lt: new Date(Date.now() - STALE_LEASE_MS) } },
    data: { status: WebhookDeliveryStatus.PENDING, lockedAt: null },
  });
  const rows = await claimDeliveries({ limit: Math.min(Math.max(limit, 1), 100) });
  const outcomes = await runWithConcurrency(rows, CONCURRENCY, (row) =>
    deliverClaimed(row).catch(async () => {
      // Unexpected (database) failure: release the lease for a later retry.
      await prisma.webhookDelivery.updateMany({ where: leaseWhere(row), data: { status: WebhookDeliveryStatus.PENDING, lockedAt: null, nextAttemptAt: new Date(Date.now() + webhookRetryDelayMs(row.attempts)) } }).catch(() => undefined);
      return { id: row.id, ok: false, statusCode: null, error: "Delivery failed", responseTimeMs: null } satisfies DeliveryOutcome;
    }),
  );
  return { delivered: outcomes.filter((outcome) => outcome.ok).length, failed: outcomes.filter((outcome) => !outcome.ok).length };
}

/** Deliver one pending row now (Send test, Redeliver). Null when another worker holds it. */
export async function deliverWebhookNow(deliveryId: string): Promise<DeliveryOutcome | null> {
  const [row] = await claimDeliveries({ limit: 1, deliveryId });
  if (!row) return null;
  return deliverClaimed(row);
}

/** Retention: delivery history older than 30 days is removed by the scheduler. */
export const WEBHOOK_DELIVERY_RETENTION_DAYS = 30;
