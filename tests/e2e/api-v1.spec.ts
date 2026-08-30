import { randomUUID } from "node:crypto";
import { EventStatus, PrismaClient, RsvpStatus } from "@prisma/client";
import { expect, test } from "@playwright/test";
import { generateApiCredential } from "@/lib/api/v1/credentialSecret";

// Bearer credentials must never be captured in Playwright trace artifacts.
test.use({ trace: "off" });
test.describe.configure({ mode: "serial" });

const prisma = new PrismaClient();
const suffix = randomUUID().replace(/-/g, "");
let organisationAId: string;
let organisationBId: string;
let eventAId: string;
let eventASecondId: string;
let eventBId: string;
let fullCredential: string;
let rotationCredential: string;
let eventsOnlyCredential: string;
let participantsOnlyCredential: string;
let primaryCredentialId: string;

function bearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}

test.beforeAll(async () => {
  const [organisationA, organisationB] = await Promise.all([
    prisma.organisation.create({ data: { name: "API HTTP tenant A", slug: `api-http-a-${suffix}` } }),
    prisma.organisation.create({ data: { name: "API HTTP tenant B", slug: `api-http-b-${suffix}` } }),
  ]);
  organisationAId = organisationA.id;
  organisationBId = organisationB.id;

  const [eventA, eventASecond, eventB] = await Promise.all([
    prisma.event.create({ data: { organisationId: organisationAId, title: "API HTTP event A", slug: `api-http-event-a-${suffix}`, startDateTime: new Date("2030-01-01T10:00:00.000Z"), endDateTime: new Date("2030-01-01T11:00:00.000Z"), timezone: "UTC", status: EventStatus.PUBLISHED } }),
    prisma.event.create({ data: { organisationId: organisationAId, title: "API HTTP event A second", slug: `api-http-event-a-second-${suffix}`, startDateTime: new Date("2030-01-02T10:00:00.000Z"), endDateTime: new Date("2030-01-02T11:00:00.000Z"), timezone: "UTC", status: EventStatus.HIDDEN } }),
    prisma.event.create({ data: { organisationId: organisationBId, title: "API HTTP event B", slug: `api-http-event-b-${suffix}`, startDateTime: new Date("2030-01-03T10:00:00.000Z"), endDateTime: new Date("2030-01-03T11:00:00.000Z"), timezone: "UTC", status: EventStatus.PUBLISHED } }),
  ]);
  eventAId = eventA.id;
  eventASecondId = eventASecond.id;
  eventBId = eventB.id;

  await prisma.rSVP.createMany({ data: [
    { eventId: eventAId, attendeeKey: `api-http-confirmed-${suffix}`, guestEmail: `api-http-confirmed-${suffix}@example.test`, guestName: "Confirmed API participant", status: RsvpStatus.CONFIRMED, checkedInAt: new Date("2030-01-01T10:15:00.000Z") },
    { eventId: eventAId, attendeeKey: `api-http-not-checked-in-${suffix}`, guestEmail: `api-http-not-checked-in-${suffix}@example.test`, guestName: "Not checked-in API participant", status: RsvpStatus.CONFIRMED },
    { eventId: eventAId, attendeeKey: `api-http-waitlisted-${suffix}`, guestEmail: `api-http-waitlisted-${suffix}@example.test`, guestName: "Waitlisted API participant", status: RsvpStatus.WAITLISTED },
  ] });

  const fullClient = await prisma.apiClient.create({
    data: {
      organisationId: organisationAId,
      name: "API HTTP full client",
      scopes: { create: [{ scope: "events:read" }, { scope: "participants:read" }, { scope: "participants:attendance:read" }] },
    },
  });
  const eventsOnlyClient = await prisma.apiClient.create({
    data: {
      organisationId: organisationAId,
      name: "API HTTP events-only client",
      scopes: { create: { scope: "events:read" } },
    },
  });
  const participantsOnlyClient = await prisma.apiClient.create({
    data: {
      organisationId: organisationAId,
      name: "API HTTP participants-only client",
      scopes: { create: { scope: "participants:read" } },
    },
  });

  primaryCredentialId = `cr${suffix.slice(0, 32)}`;
  const rotationCredentialId = `cr${suffix.slice(0, 30)}02`;
  const eventsOnlyCredentialId = `cr${suffix.slice(0, 30)}03`;
  const participantsOnlyCredentialId = `cr${suffix.slice(0, 30)}04`;
  const primary = generateApiCredential(primaryCredentialId);
  const rotation = generateApiCredential(rotationCredentialId);
  const eventsOnly = generateApiCredential(eventsOnlyCredentialId);
  const participantsOnly = generateApiCredential(participantsOnlyCredentialId);
  fullCredential = primary.token;
  rotationCredential = rotation.token;
  eventsOnlyCredential = eventsOnly.token;
  participantsOnlyCredential = participantsOnly.token;

  await prisma.apiCredential.createMany({ data: [
    { id: primaryCredentialId, apiClientId: fullClient.id, name: "Primary", secretHash: primary.secretHash },
    { id: rotationCredentialId, apiClientId: fullClient.id, name: "Rotation", secretHash: rotation.secretHash },
    { id: eventsOnlyCredentialId, apiClientId: eventsOnlyClient.id, name: "Primary", secretHash: eventsOnly.secretHash },
    { id: participantsOnlyCredentialId, apiClientId: participantsOnlyClient.id, name: "Primary", secretHash: participantsOnly.secretHash },
  ] });
});

test.afterAll(async () => {
  if (organisationAId) await prisma.organisation.delete({ where: { id: organisationAId } });
  if (organisationBId) await prisma.organisation.delete({ where: { id: organisationBId } });
  await prisma.$disconnect();
});

test("rejects missing credentials without accepting browser authentication", async ({ request }) => {
  const response = await request.get("/api/v1/events", { headers: { Cookie: "yuyu.session-token.v2=not-a-machine-credential" } });
  expect(response.status()).toBe(401);
  expect(response.headers()["cache-control"]).toBe("no-store");
  await expect(response.json()).resolves.toEqual({ error: { code: "INVALID_CREDENTIAL", message: "A valid API credential is required." } });
});

test("lists only the authenticated tenant's events with bounded cursor pagination", async ({ request }) => {
  const first = await request.get("/api/v1/events?limit=1", { headers: bearer(fullCredential) });
  expect(first.status()).toBe(200);
  expect(first.headers()["cache-control"]).toBe("no-store");
  const firstBody = await first.json();
  expect(firstBody.data).toHaveLength(1);
  expect(firstBody.data[0]).toEqual(expect.objectContaining({ id: expect.any(String), title: expect.any(String), timezone: "UTC" }));
  expect(firstBody.data.some((event: { id: string }) => event.id === eventBId)).toBe(false);
  expect(firstBody.pagination.nextCursor).toEqual(expect.any(String));

  const second = await request.get(`/api/v1/events?limit=1&cursor=${encodeURIComponent(firstBody.pagination.nextCursor)}`, { headers: bearer(fullCredential) });
  expect(second.status()).toBe(200);
  const secondBody = await second.json();
  expect(secondBody.data).toHaveLength(1);
  expect(new Set([firstBody.data[0].id, secondBody.data[0].id])).toEqual(new Set([eventAId, eventASecondId]));
});

test("returns an event contract without accepting caller-selected tenants", async ({ request }) => {
  const response = await request.get(`/api/v1/events/${eventAId}`, { headers: bearer(fullCredential) });
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body).toEqual({ data: expect.objectContaining({ id: eventAId, title: "API HTTP event A" }) });
  expect(body.data).not.toHaveProperty("organisationId");

  const suppliedOrganisation = await request.get(`/api/v1/events/${eventAId}?organisationId=${organisationBId}`, { headers: bearer(fullCredential) });
  expect(suppliedOrganisation.status()).toBe(400);
  await expect(suppliedOrganisation.json()).resolves.toMatchObject({ error: { code: "INVALID_REQUEST" } });

  const crossTenant = await request.get(`/api/v1/events/${eventBId}`, { headers: bearer(fullCredential) });
  expect(crossTenant.status()).toBe(404);
  await expect(crossTenant.json()).resolves.toMatchObject({ error: { code: "RESOURCE_NOT_FOUND" } });
});

test("returns only confirmed participants and excludes private fields", async ({ request }) => {
  const response = await request.get(`/api/v1/events/${eventAId}/participants`, { headers: bearer(fullCredential) });
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body.data).toEqual(expect.arrayContaining([
    { id: expect.any(String), displayName: "Confirmed API participant", registeredAt: expect.any(String) },
    { id: expect.any(String), displayName: "Not checked-in API participant", registeredAt: expect.any(String) },
  ]));
  const serialized = JSON.stringify(body);
  expect(serialized).not.toContain("api-http-confirmed-");
  expect(serialized).not.toContain("checkInToken");
  expect(serialized).not.toContain("attendeeKey");
  expect(serialized).not.toContain("guestEmail");
  expect(serialized).not.toContain("checkedInAt");
});

test("filters attendance without exposing timestamps and protects timestamp access", async ({ request }) => {
  const filtered = await request.get(`/api/v1/events/${eventAId}/participants?attendance=checked_in`, { headers: bearer(fullCredential) });
  expect(filtered.status()).toBe(200);
  const filteredBody = await filtered.json();
  expect(filteredBody).toMatchObject({ data: [{ displayName: "Confirmed API participant" }] });
  expect(JSON.stringify(filteredBody)).not.toContain("checkedInAt");

  const attendance = await request.get(`/api/v1/events/${eventAId}/participants?attendance=not_checked_in&include=attendance`, { headers: bearer(fullCredential) });
  expect(attendance.status()).toBe(200);
  await expect(attendance.json()).resolves.toMatchObject({ data: [{ displayName: "Not checked-in API participant", checkedInAt: null }] });

  const denied = await request.get(`/api/v1/events/${eventAId}/participants?include=attendance`, { headers: bearer(participantsOnlyCredential) });
  expect(denied.status()).toBe(403);
  await expect(denied.json()).resolves.toMatchObject({ error: { code: "INSUFFICIENT_SCOPE" } });

  const deniedFilter = await request.get(`/api/v1/events/${eventAId}/participants?attendance=checked_in`, { headers: bearer(participantsOnlyCredential) });
  expect(deniedFilter.status()).toBe(403);
  await expect(deniedFilter.json()).resolves.toMatchObject({ error: { code: "INSUFFICIENT_SCOPE" } });
});

test("enforces the participant scope", async ({ request }) => {
  const response = await request.get(`/api/v1/events/${eventAId}/participants`, { headers: bearer(eventsOnlyCredential) });
  expect(response.status()).toBe(403);
  await expect(response.json()).resolves.toMatchObject({ error: { code: "INSUFFICIENT_SCOPE" } });
});

test("supports rotation and independently rejects a revoked credential", async ({ request }) => {
  expect((await request.get(`/api/v1/events/${eventAId}`, { headers: bearer(rotationCredential) })).status()).toBe(200);
  await prisma.apiCredential.update({ where: { id: primaryCredentialId }, data: { revokedAt: new Date() } });
  expect((await request.get(`/api/v1/events/${eventAId}`, { headers: bearer(fullCredential) })).status()).toBe(401);
  expect((await request.get(`/api/v1/events/${eventAId}`, { headers: bearer(rotationCredential) })).status()).toBe(200);
});
