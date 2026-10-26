import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { EventPageSectionType, EventPrivacyType, EventStatus, MembershipRole } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const identity = vi.hoisted(() => ({ id: "" }));
vi.mock("@/lib/auth", () => ({ auth: async () => (identity.id ? { user: { id: identity.id } } : null) }));
vi.mock("@/lib/actionRateLimit", () => ({ isActionRateLimited: async () => false }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const webhooks = vi.hoisted(() => ({ emit: vi.fn() }));
vi.mock("@/lib/webhooks/emit", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/webhooks/emit")>()), emitWebhookEvent: webhooks.emit }));

import { prisma } from "@/lib/db";
import { publishEvent } from "@/app/actions/event";
import { saveEventPage } from "@/app/actions/event-website";

const suffix = randomUUID().replace(/-/g, "");
let orgId: string;
let orgSlug: string;
let ownerId: string;
let memberId: string;
let eventCounter = 0;

async function makeDraft(page: boolean | null) {
  eventCounter += 1;
  const event = await prisma.event.create({
    data: {
      organisationId: orgId,
      title: `Publish event ${eventCounter}`,
      slug: `publish-${eventCounter}-${suffix}`,
      startDateTime: new Date("2030-01-01T10:00:00.000Z"),
      endDateTime: new Date("2030-01-01T11:00:00.000Z"),
      timezone: "UTC",
      status: EventStatus.DRAFT,
      privacyType: EventPrivacyType.PUBLIC,
    },
  });
  if (page !== null) await prisma.eventPage.create({ data: { eventId: event.id, isPublished: page, tagline: "Kept" } });
  return event;
}

const stored = (eventId: string) =>
  prisma.event.findUniqueOrThrow({ where: { id: eventId }, select: { status: true, page: { select: { isPublished: true, tagline: true } } } });

beforeAll(async () => {
  orgSlug = `publish-org-${suffix}`;
  const org = await prisma.organisation.create({ data: { name: "Publish org", slug: orgSlug } });
  orgId = org.id;
  const owner = await prisma.user.create({ data: { email: `publish-owner-${suffix}@example.test` } });
  const member = await prisma.user.create({ data: { email: `publish-member-${suffix}@example.test` } });
  ownerId = owner.id;
  memberId = member.id;
  await prisma.membership.createMany({ data: [
    { userId: ownerId, organisationId: orgId, role: MembershipRole.OWNER },
    { userId: memberId, organisationId: orgId, role: MembershipRole.MEMBER },
  ] });
});

afterAll(async () => {
  await prisma.organisation.delete({ where: { id: orgId } });
  await prisma.user.deleteMany({ where: { id: { in: [ownerId, memberId] } } });
  await prisma.$disconnect();
});

describe("publishEvent", () => {
  it("releases the unreleased website of a draft, keeping its content", async () => {
    const event = await makeDraft(false);
    identity.id = ownerId;
    expect(await publishEvent({ organisationSlug: orgSlug, eventSlug: event.slug })).toEqual({ ok: true });
    expect(await stored(event.id)).toEqual({ status: EventStatus.PUBLISHED, page: { isPublished: true, tagline: "Kept" } });
  });

  it("emits event.published and audits once when two organisers publish the same draft at once", async () => {
    const event = await makeDraft(false);
    identity.id = ownerId;
    webhooks.emit.mockClear();
    const results = await Promise.all([1, 2, 3].map(() => publishEvent({ organisationSlug: orgSlug, eventSlug: event.slug })));
    expect(results).toEqual([{ ok: true }, { ok: true }, { ok: true }]);
    expect(await stored(event.id)).toMatchObject({ status: EventStatus.PUBLISHED, page: { isPublished: true } });
    const published = webhooks.emit.mock.calls.filter(([emitted]) => emitted.eventId === event.id);
    expect(published).toEqual([[{ type: "event.published", eventId: event.id, previousStatus: EventStatus.DRAFT }]]);
    expect(await prisma.auditEvent.count({ where: { action: "EVENT_PUBLISHED", targetId: event.id } })).toBe(1);
    // Publishing an already published event is a no-op for both.
    expect(await publishEvent({ organisationSlug: orgSlug, eventSlug: event.slug })).toEqual({ ok: true });
    expect(webhooks.emit.mock.calls.filter(([emitted]) => emitted.eventId === event.id)).toHaveLength(1);
    expect(await prisma.auditEvent.count({ where: { action: "EVENT_PUBLISHED", targetId: event.id } })).toBe(1);
  });

  it("creates a released website when the draft has none", async () => {
    const event = await makeDraft(null);
    identity.id = ownerId;
    expect(await publishEvent({ organisationSlug: orgSlug, eventSlug: event.slug })).toEqual({ ok: true });
    expect((await stored(event.id)).page?.isPublished).toBe(true);
  });

  it("leaves both status and website untouched for a member without publish rights", async () => {
    const event = await makeDraft(false);
    identity.id = memberId;
    expect(await publishEvent({ organisationSlug: orgSlug, eventSlug: event.slug })).toMatchObject({ ok: false });
    expect(await stored(event.id)).toEqual({ status: EventStatus.DRAFT, page: { isPublished: false, tagline: "Kept" } });
  });
});

async function makeEvent(status: EventStatus, page: boolean | null) {
  const event = await makeDraft(page);
  return prisma.event.update({ where: { id: event.id }, data: { status } });
}

const allSections = Object.values(EventPageSectionType).map((type, sortOrder) => ({ type, isVisible: true, sortOrder }));

describe("saveEventPage", () => {
  it("creates the website released for a published event that had no page row", async () => {
    const event = await makeEvent(EventStatus.PUBLISHED, null);
    identity.id = ownerId;
    expect(await saveEventPage({ organisationSlug: orgSlug, eventId: event.id, tagline: "New", aboutHtml: "", sections: allSections })).toEqual({ ok: true });
    expect((await stored(event.id)).page).toEqual({ isPublished: true, tagline: "New" });
  });

  it("creates it unreleased for a draft, and never changes release on update", async () => {
    const draft = await makeEvent(EventStatus.DRAFT, null);
    identity.id = ownerId;
    expect(await saveEventPage({ organisationSlug: orgSlug, eventId: draft.id, tagline: "Draft", aboutHtml: "", sections: allSections })).toEqual({ ok: true });
    expect((await stored(draft.id)).page?.isPublished).toBe(false);
    const live = await makeEvent(EventStatus.PUBLISHED, true);
    expect(await saveEventPage({ organisationSlug: orgSlug, eventId: live.id, tagline: "Edited", aboutHtml: "", sections: allSections })).toEqual({ ok: true });
    expect((await stored(live.id)).page).toEqual({ isPublished: true, tagline: "Edited" });
  });
});

describe("migration 20261021010000_realign_event_publication", () => {
  const sql = fs.readFileSync(path.join(process.cwd(), "prisma/migrations/20261021010000_realign_event_publication/migration.sql"), "utf8");
  const statements = sql.split(/;\s*$/m).map((s) => s.replace(/^\s*--.*$/gm, "").trim()).filter(Boolean);
  const run = async () => { for (const statement of statements) await prisma.$executeRawUnsafe(statement); };

  it("releases published events stuck at 404, withdraws others, adds missing pages, and is idempotent", async () => {
    const stuck = await makeEvent(EventStatus.PUBLISHED, false);
    const pageless = await makeEvent(EventStatus.PUBLISHED, null);
    const hidden = await makeEvent(EventStatus.HIDDEN, true);
    const draft = await makeEvent(EventStatus.DRAFT, false);
    const fine = await makeEvent(EventStatus.PUBLISHED, true);
    const before = await prisma.eventPage.findUniqueOrThrow({ where: { eventId: fine.id } });

    await run();
    expect(await stored(stuck.id)).toEqual({ status: EventStatus.PUBLISHED, page: { isPublished: true, tagline: "Kept" } });
    expect((await stored(pageless.id)).page).toEqual({ isPublished: true, tagline: "" });
    expect((await stored(hidden.id)).page?.isPublished).toBe(false);
    expect((await stored(draft.id)).page?.isPublished).toBe(false);
    expect((await prisma.eventPage.findUniqueOrThrow({ where: { eventId: fine.id } })).updatedAt).toEqual(before.updatedAt);

    const pagesBefore = await prisma.eventPage.count({ where: { event: { organisationId: orgId } } });
    await run();
    expect(await prisma.eventPage.count({ where: { event: { organisationId: orgId } } })).toBe(pagesBefore);
  });
});
