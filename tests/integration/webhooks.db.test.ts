import http from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { EventPermission, EventPrivacyType, EventStatus, MembershipRole, WebhookDeliveryStatus } from "@prisma/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const identity = vi.hoisted(() => ({ id: "" }));
vi.mock("@/lib/auth", () => ({ auth: async () => (identity.id ? { user: { id: identity.id } } : null) }));
vi.mock("@/lib/actionRateLimit", () => ({ isActionRateLimited: async () => false }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

process.env.MFA_ENCRYPTION_KEY ||= Buffer.alloc(32, 3).toString("base64");

import { prisma } from "@/lib/db";
import {
  createWebhookEndpoint,
  deleteWebhookEndpoint,
  redeliverWebhook,
  rotateWebhookSecret,
  sendWebhookTest,
  setWebhookEndpointEnabled,
  updateWebhookEndpoint,
} from "@/app/actions/webhooks";
import { publishEvent } from "@/app/actions/event";
import { submitRsvpCore } from "@/lib/rsvpCore";
import { approveRsvpForUser } from "@/lib/core/rsvpLifecycle";
import { cancelRsvpForUser } from "@/lib/core/rsvpCancel";
import { commitCheckInProjection, commitUndoCheckInProjection } from "@/lib/checkInMutations";
import { submitFeedback } from "@/lib/feedback";
import { flushWebhookEmits, enqueueWebhookPing } from "@/lib/webhooks/emit";
import { WEBHOOK_AUTO_DISABLE_AFTER, deliverWebhookBatch, deliverWebhookNow } from "@/lib/webhooks/delivery";
import { decryptWebhookSecret, encryptWebhookSecret } from "@/lib/webhooks/secrets";
import { verifyWebhookSignature } from "@/lib/webhooks/signature";
import { setWebhookResolverForTests } from "@/lib/webhooks/urlSafety";
import { getWebhookEndpointDetail, listWebhookEndpoints } from "@/lib/webhooks/management";
import { WEBHOOK_EVENT_TYPES } from "@/lib/webhooks/eventTypes";
import { purgeExpiredOperationalData } from "@/lib/retention";

type Received = { path: string; headers: http.IncomingHttpHeaders; body: string };

const suffix = randomUUID().replace(/-/g, "").slice(0, 16);
const received: Received[] = [];
let respondWith: { status: number; headers?: Record<string, string>; body?: string } = { status: 200 };
let server: http.Server;
let receiverUrl = "";
let downUrl = "";

let orgId = "";
let orgSlug = "";
let otherOrgId = "";
let otherOrgSlug = "";
let ownerId = "";
let adminId = "";
let memberId = "";
let collaboratorId = "";
let otherAdminId = "";
let publicEventId = "";
let publicEventSlug = "";
let approvalEventId = "";
let approvalEventSlug = "";
let endpointId = "";
let endpointSecret = "";

function as(userId: string) {
  identity.id = userId;
}

async function settle() {
  await flushWebhookEmits();
}

async function deliveriesOf(type: string) {
  return prisma.webhookDelivery.findMany({ where: { organisationId: orgId, eventType: type }, orderBy: { createdAt: "asc" } });
}

async function deliverAll() {
  // Rows can wait for a retry; pull everything due for this organisation now.
  await prisma.webhookDelivery.updateMany({ where: { organisationId: orgId, status: WebhookDeliveryStatus.PENDING }, data: { nextAttemptAt: new Date(Date.now() - 1000) } });
  return deliverWebhookBatch(100);
}

describe.sequential("organisation webhooks", () => {
  beforeAll(async () => {
    process.env.WEBHOOKS_ALLOW_PRIVATE_TARGETS = "1";
    server = http.createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        received.push({ path: request.url ?? "", headers: request.headers, body: Buffer.concat(chunks).toString("utf8") });
        response.writeHead(respondWith.status, respondWith.headers ?? { "content-type": "text/plain" });
        response.end(respondWith.body ?? "ok");
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    receiverUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/hooks/yuyu`;
    // A port that was just released: nothing listens there.
    const probe = http.createServer();
    await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
    downUrl = `http://127.0.0.1:${(probe.address() as AddressInfo).port}/down`;
    await new Promise<void>((resolve) => probe.close(() => resolve()));

    orgSlug = `hooks-a-${suffix}`;
    otherOrgSlug = `hooks-b-${suffix}`;
    const [org, otherOrg] = await Promise.all([
      prisma.organisation.create({ data: { name: "Hooks A", slug: orgSlug } }),
      prisma.organisation.create({ data: { name: "Hooks B", slug: otherOrgSlug } }),
    ]);
    orgId = org.id;
    otherOrgId = otherOrg.id;
    const users = await Promise.all(
      ["owner", "admin", "member", "collab", "other-admin"].map((label) =>
        prisma.user.create({ data: { name: `Hooks ${label}`, email: `hooks-${label}-${suffix}@example.test`, emailVerified: new Date() } }),
      ),
    );
    [ownerId, adminId, memberId, collaboratorId, otherAdminId] = users.map((user) => user.id) as [string, string, string, string, string];
    await prisma.membership.createMany({
      data: [
        { userId: ownerId, organisationId: orgId, role: MembershipRole.OWNER },
        { userId: adminId, organisationId: orgId, role: MembershipRole.ADMIN },
        { userId: memberId, organisationId: orgId, role: MembershipRole.MEMBER },
        { userId: otherAdminId, organisationId: otherOrgId, role: MembershipRole.ADMIN },
      ],
    });
    publicEventSlug = `public-${suffix}`;
    approvalEventSlug = `approval-${suffix}`;
    const base = { organisationId: orgId, startDateTime: new Date("2031-01-01T10:00:00Z"), endDateTime: new Date("2031-01-01T12:00:00Z"), timezone: "UTC", status: EventStatus.PUBLISHED };
    const publicEvent = await prisma.event.create({ data: { ...base, title: "Hooks public", slug: publicEventSlug, privacyType: EventPrivacyType.PUBLIC, page: { create: { isPublished: true } } } });
    const approvalEvent = await prisma.event.create({ data: { ...base, title: "Hooks approval", slug: approvalEventSlug, privacyType: EventPrivacyType.APPROVAL_REQUIRED, page: { create: { isPublished: true } } } });
    publicEventId = publicEvent.id;
    approvalEventId = approvalEvent.id;
    // A co-organiser holding every grant on an event is still not an organisation admin.
    await prisma.eventCollaborator.create({
      data: { eventId: publicEventId, userId: collaboratorId, permissions: Object.values(EventPermission) },
    });
    await prisma.eventFeedbackForm.create({ data: { eventId: publicEventId, isOpen: true, certificateEnabled: false } });
  });

  beforeEach(() => {
    received.length = 0;
    respondWith = { status: 200 };
    process.env.WEBHOOKS_ALLOW_PRIVATE_TARGETS = "1";
  });

  afterEach(() => setWebhookResolverForTests(null));

  afterAll(async () => {
    delete process.env.WEBHOOKS_ALLOW_PRIVATE_TARGETS;
    await flushWebhookEmits();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await prisma.organisation.deleteMany({ where: { id: { in: [orgId, otherOrgId].filter(Boolean) } } });
    await prisma.user.deleteMany({ where: { email: { endsWith: `-${suffix}@example.test` } } });
    await prisma.$disconnect();
  });

  it("creates an endpoint for an admin, shows the secret once and stores it encrypted", async () => {
    as(adminId);
    const result = await createWebhookEndpoint({ organisationSlug: orgSlug, url: receiverUrl, description: "CRM sync", eventTypes: [...WEBHOOK_EVENT_TYPES] });
    expect(result.ok).toBe(true);
    if (!result.ok || !result.data) throw new Error("create failed");
    endpointId = result.data.endpointId;
    endpointSecret = result.data.secret;
    expect(endpointSecret).toMatch(/^whsec_[A-Za-z0-9_-]{43}$/);

    const stored = await prisma.webhookEndpoint.findUniqueOrThrow({ where: { id: endpointId } });
    expect(stored.secretEncrypted).not.toContain(endpointSecret.slice(6));
    expect(decryptWebhookSecret(stored.secretEncrypted)).toBe(endpointSecret);

    // Read models never carry the secret.
    expect(JSON.stringify(await listWebhookEndpoints(orgId))).not.toContain("whsec_");
    expect(JSON.stringify(await getWebhookEndpointDetail(orgId, endpointId))).not.toMatch(/whsec_|secretEncrypted/);

    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { action: "WEBHOOK_ENDPOINT_CREATED", targetId: endpointId } });
    expect(audit.metadata).toEqual({ host: new URL(receiverUrl).host, eventTypeCount: WEBHOOK_EVENT_TYPES.length });
    expect(JSON.stringify(audit.metadata)).not.toContain("/hooks/yuyu");
  });

  it("refuses members, co-organisers and other organisations' admins", async () => {
    as(memberId);
    await expect(createWebhookEndpoint({ organisationSlug: orgSlug, url: receiverUrl, eventTypes: ["checkin.created"] })).resolves.toMatchObject({ ok: false, error: expect.stringMatching(/owners and admins/) });
    await expect(sendWebhookTest({ organisationSlug: orgSlug, endpointId })).resolves.toMatchObject({ ok: false });
    as(collaboratorId);
    await expect(createWebhookEndpoint({ organisationSlug: orgSlug, url: receiverUrl, eventTypes: ["checkin.created"] })).resolves.toMatchObject({ ok: false, error: expect.stringMatching(/owners and admins/) });
    await expect(rotateWebhookSecret({ organisationSlug: orgSlug, endpointId })).resolves.toMatchObject({ ok: false });

    // Another tenant's admin, addressing this endpoint through their own organisation: not found.
    as(otherAdminId);
    const notFound = { ok: false, error: "Webhook endpoint not found." };
    await expect(updateWebhookEndpoint({ organisationSlug: otherOrgSlug, endpointId, url: receiverUrl, eventTypes: ["checkin.created"] })).resolves.toEqual(notFound);
    await expect(rotateWebhookSecret({ organisationSlug: otherOrgSlug, endpointId })).resolves.toEqual(notFound);
    await expect(setWebhookEndpointEnabled({ organisationSlug: otherOrgSlug, endpointId, enabled: false })).resolves.toEqual(notFound);
    await expect(sendWebhookTest({ organisationSlug: otherOrgSlug, endpointId })).resolves.toEqual(notFound);
    await expect(deleteWebhookEndpoint({ organisationSlug: otherOrgSlug, endpointId })).resolves.toEqual(notFound);
    await expect(getWebhookEndpointDetail(otherOrgId, endpointId)).resolves.toBeNull();
    await expect(listWebhookEndpoints(otherOrgId)).resolves.toEqual([]);
    // ...and through the victim's slug they are simply not an admin there.
    await expect(deleteWebhookEndpoint({ organisationSlug: orgSlug, endpointId })).resolves.toMatchObject({ ok: false });
    await expect(prisma.webhookEndpoint.count({ where: { id: endpointId } })).resolves.toBe(1);
    expect(received).toHaveLength(0);
  });

  it("queues events after RSVP create, approval, check-in, undo, publish, cancel and feedback", async () => {
    const created = await submitRsvpCore({ orgSlug, eventSlug: publicEventSlug, guestEmail: `guest-${suffix}@example.test`, name: "Grace Hopper", answers: {} }, { userId: null });
    expect(created.ok).toBe(true);
    await settle();
    const [registration] = await deliveriesOf("registration.created");
    expect(registration).toBeDefined();
    const envelope = registration!.payload as Record<string, unknown> & { data: { registration: { id: string; status: string; displayName: string }; event: { slug: string } } };
    expect(envelope).toMatchObject({ type: "registration.created", organisation: { id: orgId, slug: orgSlug } });
    expect(envelope.data.registration).toMatchObject({ status: "CONFIRMED", displayName: "Grace Hopper" });
    expect(envelope.data.event.slug).toBe(publicEventSlug);
    const rsvpId = envelope.data.registration.id;
    const rsvp = await prisma.rSVP.findUniqueOrThrow({ where: { id: rsvpId } });
    const json = JSON.stringify(registration!.payload);
    expect(json).not.toContain(rsvp.checkInToken);
    expect(json).not.toContain("@example.test");

    const pending = await submitRsvpCore({ orgSlug, eventSlug: approvalEventSlug, guestEmail: `pending-${suffix}@example.test`, name: "Alan Turing", answers: {} }, { userId: null });
    expect(pending.ok).toBe(true);
    await settle();
    const pendingRsvp = await prisma.rSVP.findFirstOrThrow({ where: { eventId: approvalEventId } });
    expect(await approveRsvpForUser(adminId, { organisationSlug: orgSlug, rsvpId: pendingRsvp.id, eventId: approvalEventId })).toEqual({ ok: true });
    await settle();
    const [approved] = await deliveriesOf("registration.status_changed");
    expect(approved!.payload).toMatchObject({ data: { registration: { id: pendingRsvp.id, status: "CONFIRMED" }, previousStatus: "PENDING_APPROVAL" } });

    const checkedInAt = new Date();
    await commitCheckInProjection({ rsvpId, actorUserId: adminId, source: "online", checkedInAt, force: false });
    await settle();
    const [checkIn] = await deliveriesOf("checkin.created");
    expect(checkIn!.payload).toMatchObject({ data: { registration: { id: rsvpId }, checkedInAt: checkedInAt.toISOString() } });
    await commitUndoCheckInProjection({ rsvpId, actorUserId: adminId, source: "online" });
    await settle();
    expect(await deliveriesOf("checkin.undone")).toHaveLength(1);

    // Attendee cancellation (the row is deleted; the payload comes from a snapshot).
    expect(await cancelRsvpForUser(null, { checkInToken: rsvp.checkInToken })).toMatchObject({ ok: true });
    await settle();
    const statusChanges = await deliveriesOf("registration.status_changed");
    expect(statusChanges.at(-1)!.payload).toMatchObject({ data: { registration: { id: rsvpId, status: "CANCELLED", displayName: "Grace Hopper" }, previousStatus: "CONFIRMED" } });

    const draft = await prisma.event.create({ data: { organisationId: orgId, title: "Hooks draft", slug: `draft-${suffix}`, startDateTime: new Date("2031-02-01T10:00:00Z"), endDateTime: new Date("2031-02-01T12:00:00Z"), timezone: "UTC", status: EventStatus.DRAFT } });
    as(adminId);
    expect(await publishEvent({ organisationSlug: orgSlug, eventSlug: draft.slug })).toEqual({ ok: true });
    await settle();
    const [published] = await deliveriesOf("event.published");
    expect(published!.payload).toMatchObject({ data: { event: { id: draft.id, status: "PUBLISHED" }, previousStatus: "DRAFT" } });

    expect(await submitFeedback({ orgSlug, eventSlug: publicEventSlug, answers: {} })).toMatchObject({ ok: true });
    await settle();
    const [feedback] = await deliveriesOf("feedback.submitted");
    expect(Object.keys((feedback!.payload as { data: { feedback: object } }).data.feedback).sort()).toEqual(["id", "submittedAt"]);

    // One row per endpoint and event, each with a stable, unique event id.
    const all = await prisma.webhookDelivery.findMany({ where: { organisationId: orgId } });
    expect(new Set(all.map((row) => row.eventId)).size).toBe(all.length);
    expect(all.every((row) => row.endpointId === endpointId && row.status === WebhookDeliveryStatus.PENDING)).toBe(true);
  });

  it("delivers signed requests with the documented headers", async () => {
    const result = await deliverAll();
    expect(result.failed).toBe(0);
    expect(result.delivered).toBeGreaterThanOrEqual(7);
    expect(received.length).toBe(result.delivered);
    for (const request of received) {
      expect(request.path).toBe("/hooks/yuyu");
      expect(request.headers["content-type"]).toBe("application/json");
      expect(request.headers["user-agent"]).toBe("Yuyu-Webhooks/1");
      const envelope = JSON.parse(request.body) as { id: string; type: string };
      expect(request.headers["x-yuyu-event-id"]).toBe(envelope.id);
      expect(request.headers["x-yuyu-event-type"]).toBe(envelope.type);
      expect(verifyWebhookSignature({ secret: endpointSecret, header: request.headers["x-yuyu-signature"] as string, body: request.body })).toBe(true);
    }
    const rows = await prisma.webhookDelivery.findMany({ where: { organisationId: orgId } });
    expect(rows.every((row) => row.status === WebhookDeliveryStatus.SUCCEEDED && row.lastStatusCode === 200 && row.responseTimeMs !== null && row.attempts === 1)).toBe(true);
    const endpoint = await prisma.webhookEndpoint.findUniqueOrThrow({ where: { id: endpointId } });
    expect(endpoint.lastSuccessAt).not.toBeNull();
    expect(endpoint.consecutiveFailures).toBe(0);
  });

  it("claims each row once when two workers run together", async () => {
    const endpoint = { id: endpointId, organisation: { id: orgId, slug: orgSlug } };
    await Promise.all(Array.from({ length: 6 }, () => enqueueWebhookPing(endpoint)));
    const [first, second] = await Promise.all([deliverWebhookBatch(100), deliverWebhookBatch(100)]);
    expect(first.delivered + second.delivered).toBe(6);
    expect(received).toHaveLength(6);
    expect(new Set(received.map((request) => request.headers["x-yuyu-event-id"])).size).toBe(6);
  });

  it("retries a 500 later with backoff and counts the failure", async () => {
    respondWith = { status: 500, body: "Internal error for ada@example.com token=abcdef" };
    const id = await enqueueWebhookPing({ id: endpointId, organisation: { id: orgId, slug: orgSlug } });
    const before = Date.now();
    const outcome = await deliverWebhookNow(id);
    expect(outcome).toMatchObject({ ok: false, statusCode: 500 });
    const row = await prisma.webhookDelivery.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe(WebhookDeliveryStatus.PENDING);
    expect(row.attempts).toBe(1);
    expect(row.lastStatusCode).toBe(500);
    expect(row.lastError).toMatch(/^Unexpected response \(HTTP 500\)/);
    expect(row.lastError).not.toContain("ada@example.com");
    expect(row.lastError).not.toContain("abcdef");
    expect(row.nextAttemptAt.getTime()).toBeGreaterThanOrEqual(before + 45_000);
    expect((await prisma.webhookEndpoint.findUniqueOrThrow({ where: { id: endpointId } })).consecutiveFailures).toBe(1);

    respondWith = { status: 204 };
    await deliverAll();
    const retried = await prisma.webhookDelivery.findUniqueOrThrow({ where: { id } });
    expect(retried).toMatchObject({ status: WebhookDeliveryStatus.SUCCEEDED, attempts: 2, lastStatusCode: 204 });
    expect((await prisma.webhookEndpoint.findUniqueOrThrow({ where: { id: endpointId } })).consecutiveFailures).toBe(0);
  });

  it("does not follow a redirect", async () => {
    respondWith = { status: 302, headers: { location: `${new URL(receiverUrl).origin}/redirected` } };
    const id = await enqueueWebhookPing({ id: endpointId, organisation: { id: orgId, slug: orgSlug } });
    const outcome = await deliverWebhookNow(id);
    expect(outcome).toMatchObject({ ok: false, statusCode: 302, error: expect.stringMatching(/^Redirect not followed \(HTTP 302\)/) });
    expect(received.map((request) => request.path)).toEqual(["/hooks/yuyu"]);
    await prisma.webhookDelivery.update({ where: { id }, data: { status: WebhookDeliveryStatus.FAILED } });
  });

  it("redelivers a failed delivery with the same event id", async () => {
    const failed = await prisma.webhookDelivery.findFirstOrThrow({ where: { endpointId, status: WebhookDeliveryStatus.FAILED } });
    as(adminId);
    const result = await redeliverWebhook({ organisationSlug: orgSlug, endpointId, deliveryId: failed.id });
    expect(result).toMatchObject({ ok: true, data: { delivered: true, statusCode: 200 } });
    expect(received.at(-1)!.headers["x-yuyu-event-id"]).toBe(failed.eventId);
    await expect(prisma.webhookDelivery.findUniqueOrThrow({ where: { id: failed.id } })).resolves.toMatchObject({ status: WebhookDeliveryStatus.SUCCEEDED });
    // Successful rows cannot be redelivered.
    await expect(redeliverWebhook({ organisationSlug: orgSlug, endpointId, deliveryId: failed.id })).resolves.toMatchObject({ ok: false });
  });

  it("sends a test ping and rotates the secret", async () => {
    as(ownerId);
    await expect(sendWebhookTest({ organisationSlug: orgSlug, endpointId })).resolves.toMatchObject({ ok: true, data: { delivered: true, statusCode: 200 } });
    expect(received.at(-1)!.headers["x-yuyu-event-type"]).toBe("ping");
    const rotated = await rotateWebhookSecret({ organisationSlug: orgSlug, endpointId });
    if (!rotated.ok || !rotated.data) throw new Error("rotate failed");
    expect(rotated.data.secret).not.toBe(endpointSecret);
    await sendWebhookTest({ organisationSlug: orgSlug, endpointId });
    const last = received.at(-1)!;
    expect(verifyWebhookSignature({ secret: rotated.data.secret, header: last.headers["x-yuyu-signature"] as string, body: last.body })).toBe(true);
    expect(verifyWebhookSignature({ secret: endpointSecret, header: last.headers["x-yuyu-signature"] as string, body: last.body })).toBe(false);
    endpointSecret = rotated.data.secret;
    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { action: "WEBHOOK_SECRET_ROTATED", targetId: endpointId } });
    expect(JSON.stringify(audit.metadata)).not.toContain("whsec_");
  });

  it("keeps the user's action fast and successful when the receiver is down", async () => {
    await prisma.webhookEndpoint.update({ where: { id: endpointId }, data: { url: downUrl } });
    const started = Date.now();
    const result = await submitRsvpCore({ orgSlug, eventSlug: publicEventSlug, guestEmail: `down-${suffix}@example.test`, name: "Down Guest", answers: {} }, { userId: null });
    expect(result.ok).toBe(true);
    expect(Date.now() - started).toBeLessThan(5_000);
    await settle();
    const [row] = (await deliveriesOf("registration.created")).filter((delivery) => delivery.status === WebhookDeliveryStatus.PENDING);
    const outcome = await deliverWebhookNow(row!.id);
    expect(outcome).toMatchObject({ ok: false, error: "Connection refused" });
    await expect(prisma.webhookDelivery.findUniqueOrThrow({ where: { id: row!.id } })).resolves.toMatchObject({ status: WebhookDeliveryStatus.PENDING, attempts: 1 });
    await prisma.webhookEndpoint.update({ where: { id: endpointId }, data: { url: receiverUrl } });
  });

  it(`turns an endpoint off after ${WEBHOOK_AUTO_DISABLE_AFTER} consecutive failures`, async () => {
    respondWith = { status: 503 };
    await prisma.webhookEndpoint.update({ where: { id: endpointId }, data: { consecutiveFailures: WEBHOOK_AUTO_DISABLE_AFTER - 1 } });
    const waiting = await enqueueWebhookPing({ id: endpointId, organisation: { id: orgId, slug: orgSlug } });
    const id = await enqueueWebhookPing({ id: endpointId, organisation: { id: orgId, slug: orgSlug } });
    // A third delivery already failed once and is waiting for its retry.
    const retrying = await enqueueWebhookPing({ id: endpointId, organisation: { id: orgId, slug: orgSlug } });
    await prisma.webhookDelivery.update({ where: { id: waiting }, data: { nextAttemptAt: new Date(Date.now() + 3_600_000) } });
    await prisma.webhookDelivery.update({ where: { id: retrying }, data: { nextAttemptAt: new Date(Date.now() + 3_600_000), attempts: 1, lastError: "HTTP 503" } });
    await deliverWebhookNow(id);
    const endpoint = await prisma.webhookEndpoint.findUniqueOrThrow({ where: { id: endpointId } });
    expect(endpoint).toMatchObject({ enabled: false, disabledReason: "auto_disabled", consecutiveFailures: WEBHOOK_AUTO_DISABLE_AFTER });
    await expect(prisma.webhookDelivery.findUniqueOrThrow({ where: { id: waiting } })).resolves.toMatchObject({ status: WebhookDeliveryStatus.FAILED, lastError: "Endpoint disabled" });
    // The root cause of an earlier failure is kept.
    await expect(prisma.webhookDelivery.findUniqueOrThrow({ where: { id: retrying } })).resolves.toMatchObject({ status: WebhookDeliveryStatus.FAILED, lastError: "Endpoint disabled after: HTTP 503" });
    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { action: "WEBHOOK_ENDPOINT_AUTO_DISABLED", targetId: endpointId } });
    expect(audit.actorUserId).toBeNull();
    expect((await getWebhookEndpointDetail(orgId, endpointId))!.endpoint.state).toBe("auto_disabled");

    // Nothing more is queued for a disabled endpoint.
    await submitRsvpCore({ orgSlug, eventSlug: publicEventSlug, guestEmail: `after-${suffix}@example.test`, name: "After Guest", answers: {} }, { userId: null });
    await settle();
    await expect(prisma.webhookDelivery.count({ where: { endpointId, status: WebhookDeliveryStatus.PENDING } })).resolves.toBe(0);

    as(adminId);
    respondWith = { status: 200 };
    await expect(setWebhookEndpointEnabled({ organisationSlug: orgSlug, endpointId, enabled: true })).resolves.toEqual({ ok: true });
    await expect(prisma.webhookEndpoint.findUniqueOrThrow({ where: { id: endpointId } })).resolves.toMatchObject({ enabled: true, disabledReason: null, consecutiveFailures: 0 });
  });

  it("connects to the address it vetted, not to a fresh DNS answer", async () => {
    // System DNS cannot resolve this name; the request only reaches the
    // receiver because the socket uses the pinned, already-checked address.
    setWebhookResolverForTests(async () => [{ address: "127.0.0.1", family: 4 }]);
    const port = new URL(receiverUrl).port;
    await prisma.webhookEndpoint.update({ where: { id: endpointId }, data: { url: `http://pinned.example.test:${port}/hooks/yuyu` } });
    const id = await enqueueWebhookPing({ id: endpointId, organisation: { id: orgId, slug: orgSlug } });
    await expect(deliverWebhookNow(id)).resolves.toMatchObject({ ok: true, statusCode: 200 });
    expect(received.at(-1)!.headers.host).toBe(`pinned.example.test:${port}`);
    await prisma.webhookEndpoint.update({ where: { id: endpointId }, data: { url: receiverUrl } });
  });

  it("blocks private targets at save time when the development flag is off", async () => {
    delete process.env.WEBHOOKS_ALLOW_PRIVATE_TARGETS;
    setWebhookResolverForTests(async (host) => (host === "rebind.example.test" ? [{ address: "127.0.0.1", family: 4 }] : [{ address: "93.184.216.34", family: 4 }]));
    as(adminId);
    for (const url of [receiverUrl, "https://127.0.0.1/hook", "https://localhost/hook", "https://[::ffff:127.0.0.1]/hook", "https://2130706433/hook", "https://169.254.169.254/latest", "https://hooks.example.test:9000/x"]) {
      await expect(createWebhookEndpoint({ organisationSlug: orgSlug, url, eventTypes: ["checkin.created"] })).resolves.toMatchObject({ ok: false });
    }
    await expect(createWebhookEndpoint({ organisationSlug: orgSlug, url: "https://rebind.example.test/hook", eventTypes: ["checkin.created"] })).resolves.toMatchObject({ ok: false, error: expect.stringMatching(/private or reserved/) });
    await expect(updateWebhookEndpoint({ organisationSlug: orgSlug, endpointId, url: "https://rebind.example.test/hook", eventTypes: ["checkin.created"] })).resolves.toMatchObject({ ok: false });
    await expect(prisma.webhookEndpoint.count({ where: { organisationId: orgId } })).resolves.toBe(1);
  });

  it("blocks a host that resolves to a private address at delivery time (DNS rebinding)", async () => {
    delete process.env.WEBHOOKS_ALLOW_PRIVATE_TARGETS;
    setWebhookResolverForTests(async () => [{ address: "93.184.216.34", family: 4 }]);
    const rebinding = await prisma.webhookEndpoint.create({
      data: { organisationId: orgId, url: "https://rebind.example.test/hook", eventTypes: ["checkin.created"], secretEncrypted: encryptWebhookSecret("whsec_x") },
    });
    // The name resolved publicly when saved; it now answers with loopback.
    setWebhookResolverForTests(async () => [{ address: "127.0.0.1", family: 4 }]);
    const id = await enqueueWebhookPing({ id: rebinding.id, organisation: { id: orgId, slug: orgSlug } });
    const outcome = await deliverWebhookNow(id);
    expect(outcome).toMatchObject({ ok: false, statusCode: null, error: expect.stringMatching(/^Blocked/) });
    expect(received).toHaveLength(0);
    await prisma.webhookEndpoint.delete({ where: { id: rebinding.id } });
  });

  it("caps an organisation at 10 endpoints", async () => {
    as(adminId);
    for (let index = 0; index < 9; index += 1) {
      await expect(createWebhookEndpoint({ organisationSlug: orgSlug, url: `${receiverUrl}?n=${index}`, eventTypes: ["event.published"] })).resolves.toMatchObject({ ok: true });
    }
    await expect(createWebhookEndpoint({ organisationSlug: orgSlug, url: receiverUrl, eventTypes: ["event.published"] })).resolves.toMatchObject({ ok: false, error: expect.stringMatching(/up to 10/) });
    await prisma.webhookEndpoint.deleteMany({ where: { organisationId: orgId, id: { not: endpointId } } });
  });

  it("purges delivery history older than 30 days", async () => {
    const id = await enqueueWebhookPing({ id: endpointId, organisation: { id: orgId, slug: orgSlug } });
    const recent = await enqueueWebhookPing({ id: endpointId, organisation: { id: orgId, slug: orgSlug } });
    await prisma.webhookDelivery.update({ where: { id }, data: { status: WebhookDeliveryStatus.SUCCEEDED, createdAt: new Date(Date.now() - 31 * 86_400_000) } });
    const purged = await purgeExpiredOperationalData();
    expect(purged.webhookDeliveries).toBeGreaterThanOrEqual(1);
    await expect(prisma.webhookDelivery.count({ where: { id } })).resolves.toBe(0);
    await expect(prisma.webhookDelivery.count({ where: { id: recent } })).resolves.toBe(1);
  });

  it("disables and deletes with audit entries that carry the host only", async () => {
    as(adminId);
    await expect(setWebhookEndpointEnabled({ organisationSlug: orgSlug, endpointId, enabled: false })).resolves.toEqual({ ok: true });
    await expect(sendWebhookTest({ organisationSlug: orgSlug, endpointId })).resolves.toMatchObject({ ok: false });
    await expect(deleteWebhookEndpoint({ organisationSlug: orgSlug, endpointId })).resolves.toEqual({ ok: true });
    await expect(prisma.webhookDelivery.count({ where: { endpointId } })).resolves.toBe(0);
    const audits = await prisma.auditEvent.findMany({ where: { targetId: endpointId, action: { startsWith: "WEBHOOK_" } } });
    expect(audits.map((audit) => audit.action)).toEqual(expect.arrayContaining(["WEBHOOK_ENDPOINT_CREATED", "WEBHOOK_SECRET_ROTATED", "WEBHOOK_ENDPOINT_AUTO_DISABLED", "WEBHOOK_ENDPOINT_ENABLED", "WEBHOOK_ENDPOINT_DISABLED", "WEBHOOK_ENDPOINT_DELETED"]));
    for (const audit of audits) {
      const metadata = JSON.stringify(audit.metadata);
      expect(metadata).not.toMatch(/whsec_|\/hooks\/yuyu|http:/);
    }
  });
});
