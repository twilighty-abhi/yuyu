import { randomUUID } from "node:crypto";
import { ContentVisibility, EventStatus, PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";

test.describe.configure({ mode: "serial" });
const prisma = new PrismaClient();
const suffix = randomUUID().replaceAll("-", "");
const orgSlug = `visibility-${suffix}`;
const eventSlug = `private-release-${suffix}`;
let organisationId = "";
let eventId = "";
let unreleasedOpenGraph: Uint8Array = new Uint8Array();

test.beforeAll(async () => {
  const organisation = await prisma.organisation.create({ data: { name: `Visibility ${suffix}`, slug: orgSlug } });
  organisationId = organisation.id;
  const event = await prisma.event.create({
    data: {
      organisationId,
      title: `Unreleased ${suffix}`,
      slug: eventSlug,
      startDateTime: new Date("2035-01-01T10:00:00.000Z"),
      endDateTime: new Date("2035-01-01T12:00:00.000Z"),
      timezone: "UTC",
      status: EventStatus.PUBLISHED,
      page: { create: { isPublished: false } },
      speakers: { create: { name: "Private speaker", slug: "private-speaker", visibility: ContentVisibility.PUBLISHED } },
      sessions: { create: { title: "Private session", slug: "private-session", startDateTime: new Date("2035-01-01T10:00:00.000Z"), endDateTime: new Date("2035-01-01T11:00:00.000Z"), visibility: ContentVisibility.PUBLISHED } },
    },
  });
  eventId = event.id;
});

test.afterAll(async () => {
  if (organisationId) await prisma.organisation.delete({ where: { id: organisationId } });
  await prisma.$disconnect();
});

test("an unreleased website is absent from every anonymous event surface", async ({ request }) => {
  for (const path of [
    `/${orgSlug}/${eventSlug}`,
    `/${orgSlug}/${eventSlug}/schedule`,
    `/${orgSlug}/${eventSlug}/sessions/private-session`,
    `/${orgSlug}/${eventSlug}/speakers/private-speaker`,
  ]) {
    const response = await request.get(path);
    const body = await response.text();
    // Next.js 16 may stream the not-found boundary after the HTTP status has
    // been committed, producing a noindex soft 404. In either form, protected
    // event content must be absent.
    expect([200, 404], path).toContain(response.status());
    expect(body, path).not.toContain(`Unreleased ${suffix}`);
    if (response.status() === 200) {
      expect(body, path).toMatch(/<meta[^>]+name=["']robots["'][^>]+noindex/i);
    }
  }

  const search = await request.get(`/api/search?q=${encodeURIComponent(suffix)}`);
  expect(search.status()).toBe(200);
  expect((await search.json()).events).toEqual([]);
  expect(await (await request.get(`/${orgSlug}`)).text()).not.toContain(`Unreleased ${suffix}`);
  expect(await (await request.get(`/discover?q=${encodeURIComponent(suffix)}`)).text()).not.toContain(`Unreleased ${suffix}`);
  unreleasedOpenGraph = await (await request.get(`/${orgSlug}/${eventSlug}/opengraph-image`)).body();
});

test("release makes the public website and programme reachable", async ({ request }) => {
  await prisma.eventPage.update({ where: { eventId }, data: { isPublished: true } });
  expect((await request.get(`/${orgSlug}/${eventSlug}`)).status()).toBe(200);
  expect((await request.get(`/${orgSlug}/${eventSlug}/schedule`)).status()).toBe(200);
  expect((await request.get(`/${orgSlug}/${eventSlug}/sessions/private-session`)).status()).toBe(200);
  expect((await request.get(`/${orgSlug}/${eventSlug}/speakers/private-speaker`)).status()).toBe(200);
  const releasedOpenGraph = await (await request.get(`/${orgSlug}/${eventSlug}/opengraph-image`)).body();
  expect(releasedOpenGraph.equals(unreleasedOpenGraph)).toBe(false);
});
