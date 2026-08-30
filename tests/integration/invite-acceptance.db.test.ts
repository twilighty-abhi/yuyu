import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EventPermission } from "@prisma/client";
import { prisma } from "@/lib/db";
import { acceptEventCollaboratorInviteToken, acceptOrganisationInviteToken } from "@/lib/inviteAcceptance";
import { createEventCollaboratorToken, hashEventCollaboratorToken } from "@/lib/eventCollaboratorToken";

const suffix = randomUUID().replace(/-/g, "");
let organisationId: string;
let firstUserId: string;
let secondUserId: string;
let eventId: string;

describe.sequential("single-use invite concurrency", () => {
  beforeAll(async () => {
    const [first, second, organisation] = await Promise.all([
      prisma.user.create({ data: { name: "Invite user one", email: `invite-one-${suffix}@example.test` } }),
      prisma.user.create({ data: { name: "Invite user two", email: `invite-two-${suffix}@example.test` } }),
      prisma.organisation.create({ data: { name: "Invite concurrency org", slug: `invite-org-${suffix}` } }),
    ]);
    firstUserId = first.id;
    secondUserId = second.id;
    organisationId = organisation.id;
    const event = await prisma.event.create({
      data: {
        organisationId,
        title: "Invite concurrency event",
        slug: `invite-event-${suffix}`,
        startDateTime: new Date("2030-01-01T10:00:00.000Z"),
        endDateTime: new Date("2030-01-01T11:00:00.000Z"),
        timezone: "UTC",
      },
    });
    eventId = event.id;
  });

  afterAll(async () => {
    if (organisationId) await prisma.organisation.deleteMany({ where: { id: organisationId } });
    await prisma.user.deleteMany({ where: { id: { in: [firstUserId, secondUserId].filter(Boolean) } } });
    await prisma.$disconnect();
  });

  it("grants membership to only one concurrent claimant", async () => {
    const token = `org_${suffix}`;
    await prisma.organisationInvite.create({
      data: { organisationId, token, role: "MEMBER", createdByUserId: firstUserId, expiresAt: new Date(Date.now() + 60_000) },
    });
    const results = await Promise.all([
      acceptOrganisationInviteToken(token, firstUserId),
      acceptOrganisationInviteToken(token, secondUserId),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    await expect(prisma.membership.count({ where: { organisationId } })).resolves.toBe(1);
  });

  it("creates one collaborator grant for concurrent acceptance attempts", async () => {
    const token = createEventCollaboratorToken();
    await prisma.eventCollaboratorInvite.create({
      data: {
        eventId,
        email: `invite-one-${suffix}@example.test`,
        tokenHash: hashEventCollaboratorToken(token),
        permissions: [EventPermission.EDIT_DETAILS],
        createdByUserId: firstUserId,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    const user = { id: firstUserId, email: `invite-one-${suffix}@example.test` };
    const results = await Promise.all([
      acceptEventCollaboratorInviteToken(token, user),
      acceptEventCollaboratorInviteToken(token, user),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    await expect(prisma.eventCollaborator.count({ where: { eventId, userId: firstUserId } })).resolves.toBe(1);
  });
});
