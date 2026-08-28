import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EventStatus, RsvpStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { authenticateApiCredential, generateApiCredential } from "@/lib/api/v1/credentials";
import { getApiEvent, listApiEvents, listApiParticipants } from "@/lib/api/v1/events";

const suffix = randomUUID().replace(/-/g, "");
let orgA: string;
let orgB: string;
let eventA: string;
let eventB: string;

describe.sequential("machine API tenant boundary", () => {
  beforeAll(async () => {
    const [a, b] = await Promise.all([
      prisma.organisation.create({ data: { name: "API tenant A", slug: `api-a-${suffix}` } }),
      prisma.organisation.create({ data: { name: "API tenant B", slug: `api-b-${suffix}` } }),
    ]);
    orgA = a.id;
    orgB = b.id;
    const [first, second] = await Promise.all([
      prisma.event.create({ data: { organisationId: orgA, title: "Tenant A event", slug: `event-a-${suffix}`, startDateTime: new Date("2030-01-01T10:00:00Z"), endDateTime: new Date("2030-01-01T11:00:00Z"), timezone: "UTC", status: EventStatus.PUBLISHED } }),
      prisma.event.create({ data: { organisationId: orgB, title: "Tenant B event", slug: `event-b-${suffix}`, startDateTime: new Date("2030-01-02T10:00:00Z"), endDateTime: new Date("2030-01-02T11:00:00Z"), timezone: "UTC", status: EventStatus.PUBLISHED } }),
    ]);
    eventA = first.id;
    eventB = second.id;
    await prisma.rSVP.createMany({ data: [
      { eventId: eventA, attendeeKey: `guest:confirmed-${suffix}`, guestEmail: `secret-${suffix}@example.test`, guestName: "Confirmed participant", status: RsvpStatus.CONFIRMED, checkedInAt: new Date("2030-01-01T10:15:00.000Z") },
      { eventId: eventA, attendeeKey: `guest:not-checked-in-${suffix}`, guestEmail: `not-checked-in-${suffix}@example.test`, guestName: "Unconfirmed attendance participant", status: RsvpStatus.CONFIRMED },
      { eventId: eventA, attendeeKey: `guest:waitlisted-${suffix}`, guestEmail: `wait-${suffix}@example.test`, guestName: "Waitlisted participant", status: RsvpStatus.WAITLISTED },
    ] });
  });

  afterAll(async () => {
    if (orgA) await prisma.organisation.delete({ where: { id: orgA } });
    if (orgB) await prisma.organisation.delete({ where: { id: orgB } });
    await prisma.$disconnect();
  });

  it("never resolves an event through a different organisation", async () => {
    await expect(getApiEvent(orgA, eventA)).resolves.not.toBeNull();
    await expect(getApiEvent(orgA, eventB)).resolves.toBeNull();
  });

  it("lists only tenant events with bounded pagination", async () => {
    const result = await listApiEvents(orgA, 1, null);
    expect(result.data).toHaveLength(1);
    expect(result.data[0]?.id).toBe(eventA);
    expect(result.data.some((event) => event.id === eventB)).toBe(false);
  });

  it("returns only confirmed participants and excludes contact/security fields", async () => {
    const result = await listApiParticipants(orgA, eventA, 10, null);
    expect(result?.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ displayName: "Confirmed participant" }),
      expect.objectContaining({ displayName: "Unconfirmed attendance participant" }),
    ]));
    expect(JSON.stringify(result)).not.toContain(`secret-${suffix}@example.test`);
    expect(JSON.stringify(result)).not.toContain("checkInToken");
    await expect(listApiParticipants(orgA, eventB, 10, null)).resolves.toBeNull();
  });

  it("filters attendance without exposing it and reveals it only when requested", async () => {
    const checkedIn = await listApiParticipants(orgA, eventA, 10, null, "checked_in");
    expect(checkedIn?.data).toEqual([expect.objectContaining({ displayName: "Confirmed participant" })]);
    expect(checkedIn?.data[0]).not.toHaveProperty("checkedInAt");

    const withAttendance = await listApiParticipants(orgA, eventA, 10, null, "not_checked_in", true);
    expect(withAttendance?.data).toEqual([
      expect.objectContaining({ displayName: "Unconfirmed attendance participant", checkedInAt: null }),
    ]);
  });

  it("persists only digests and enforces rotation, scopes, disablement, revocation, and expiry immediately", async () => {
    const client = await prisma.apiClient.create({ data: { organisationId: orgA, name: "Integration client", scopes: { create: { scope: "events:read" } } } });
    const primaryId = `cr${suffix.slice(0, 32)}`;
    const rotationId = `cr${suffix.slice(0, 30)}02`;
    const primary = generateApiCredential(primaryId);
    const rotation = generateApiCredential(rotationId);
    await prisma.apiCredential.createMany({ data: [
      { id: primaryId, apiClientId: client.id, name: "Primary", secretHash: primary.secretHash },
      { id: rotationId, apiClientId: client.id, name: "Rotation", secretHash: rotation.secretHash },
    ] });
    const stored = await prisma.apiCredential.findUniqueOrThrow({ where: { id: primaryId }, select: { secretHash: true } });
    expect(primary.token).not.toContain(Buffer.from(stored.secretHash).toString("hex"));

    const primaryHeader = `Bearer ${primary.token}`;
    const rotationHeader = `Bearer ${rotation.token}`;
    await expect(authenticateApiCredential(primaryHeader)).resolves.toMatchObject({ organisationId: orgA, apiClientId: client.id });
    await expect(authenticateApiCredential(rotationHeader)).resolves.toMatchObject({ organisationId: orgA, apiClientId: client.id });

    await prisma.$transaction([
      prisma.apiClientScope.deleteMany({ where: { apiClientId: client.id } }),
      prisma.apiClientScope.create({ data: { apiClientId: client.id, scope: "participants:read" } }),
    ]);
    const changedScope = await authenticateApiCredential(primaryHeader);
    expect(changedScope?.scopes.has("events:read")).toBe(false);
    expect(changedScope?.scopes.has("participants:read")).toBe(true);

    await prisma.apiClient.update({ where: { id: client.id }, data: { status: "DISABLED" } });
    await expect(authenticateApiCredential(primaryHeader)).resolves.toBeNull();
    await expect(authenticateApiCredential(rotationHeader)).resolves.toBeNull();

    await prisma.apiClient.update({ where: { id: client.id }, data: { status: "ACTIVE" } });
    await prisma.apiCredential.update({ where: { id: primaryId }, data: { revokedAt: new Date() } });
    await expect(authenticateApiCredential(primaryHeader)).resolves.toBeNull();
    await expect(authenticateApiCredential(rotationHeader)).resolves.not.toBeNull();

    await prisma.apiCredential.update({ where: { id: rotationId }, data: { expiresAt: new Date(Date.now() - 60_000) } });
    await expect(authenticateApiCredential(rotationHeader)).resolves.toBeNull();
  });
});
