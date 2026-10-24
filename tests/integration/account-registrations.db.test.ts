import { randomUUID } from "node:crypto";
import { EventStatus } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { ACCOUNT_REGISTRATIONS_LIMIT, loadAccountRegistrationRecords, loadAccountRegistrations } from "@/lib/accountRegistrations";

/**
 * Account → Registrations paging (one page per section, page numbers in the
 * URL): one-off events and series occurrences are ordered together, every
 * page is keyed on the signed-in user's own RSVPs, and the totals are exact.
 */
const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
const now = new Date("2031-06-15T12:00:00.000Z");
const HOUR = 3_600_000;
let organisationId = "";
let userId = "";
let otherUserId = "";

/** Expected order per section: start time (soonest upcoming / latest past first), then RSVP id. */
const expected = { upcoming: [] as Array<{ id: string; start: number }>, past: [] as Array<{ id: string; start: number }> };

async function rsvpFor(user: string, target: { eventId?: string; eventInstanceId?: string }) {
  return prisma.rSVP.create({ data: { ...target, userId: user, attendeeKey: `user:${user}` }, select: { id: true } });
}

describe.sequential("account registrations paging", () => {
  beforeAll(async () => {
    const org = await prisma.organisation.create({ data: { name: `Account paging ${suffix}`, slug: `account-paging-${suffix}` } });
    organisationId = org.id;
    const [user, other] = await Promise.all([
      prisma.user.create({ data: { name: "Paging Person", email: `paging-${suffix}@example.test` } }),
      prisma.user.create({ data: { name: "Other Person", email: `paging-other-${suffix}@example.test` } }),
    ]);
    userId = user.id;
    otherUserId = other.id;
    const series = await prisma.eventSeries.create({
      data: { organisationId, title: "Weekly", slug: `weekly-${suffix}`, recurrenceRule: "FREQ=WEEKLY", timezone: "UTC", status: EventStatus.PUBLISHED },
    });

    // 120 registrations: events and series occurrences interleaved in time,
    // half upcoming and half past, with some sharing a start time.
    for (let n = 0; n < 120; n += 1) {
      const upcoming = n % 2 === 0;
      const offsetHours = (Math.floor(n / 2) % 50) * 5 + 1;
      const start = new Date(now.getTime() + (upcoming ? offsetHours * HOUR : -(offsetHours + 2) * HOUR));
      const end = new Date(start.getTime() + HOUR);
      let rsvpId: string;
      if (n % 3 === 0) {
        const instance = await prisma.eventInstance.create({ data: { eventSeriesId: series.id, startDateTime: start, endDateTime: end } });
        rsvpId = (await rsvpFor(userId, { eventInstanceId: instance.id })).id;
        await rsvpFor(otherUserId, { eventInstanceId: instance.id });
      } else {
        const event = await prisma.event.create({
          data: {
            organisationId,
            title: `Paging ${n}`,
            slug: `paging-${suffix}-${n}`,
            startDateTime: start,
            endDateTime: end,
            timezone: "UTC",
            status: EventStatus.PUBLISHED,
            page: { create: { isPublished: true } },
          },
        });
        rsvpId = (await rsvpFor(userId, { eventId: event.id })).id;
        await rsvpFor(otherUserId, { eventId: event.id });
      }
      expected[upcoming ? "upcoming" : "past"].push({ id: rsvpId, start: start.getTime() });
    }
    const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    expected.upcoming.sort((a, b) => a.start - b.start || byId(a, b));
    expected.past.sort((a, b) => b.start - a.start || byId(a, b));
  });

  afterAll(async () => {
    if (organisationId) await prisma.organisation.delete({ where: { id: organisationId } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId].filter(Boolean) } } });
    await prisma.$disconnect();
  });

  it("walks every page of each section once, in order, with exact totals", async () => {
    for (const section of ["upcoming", "past"] as const) {
      const seen: string[] = [];
      for (let page = 1; page <= 2; page += 1) {
        const records = await loadAccountRegistrationRecords(userId, now, { [section]: page });
        expect(records.pagination[section]).toEqual({ page, totalPages: 2, total: 60, pageSize: ACCOUNT_REGISTRATIONS_LIMIT });
        seen.push(...records[section].map((item) => item.rsvp.id));
      }
      expect(seen).toEqual(expected[section].map((row) => row.id));
    }
  });

  it("mixes series occurrences and one-off events on the same page and clamps pages past the end", async () => {
    const first = await loadAccountRegistrations(userId, now);
    expect(first.upcoming).toHaveLength(ACCOUNT_REGISTRATIONS_LIMIT);
    expect(first.upcoming.some((row) => row.isSeries)).toBe(true);
    expect(first.upcoming.some((row) => !row.isSeries)).toBe(true);
    const beyond = await loadAccountRegistrations(userId, now, { past: 99 });
    expect(beyond.pagination.past.page).toBe(2);
    expect(beyond.past.map((row) => row.id)).toEqual(expected.past.slice(ACCOUNT_REGISTRATIONS_LIMIT).map((row) => row.id));
  });

  it("only ever reads the signed-in user's own registrations", async () => {
    const mine = new Set([...expected.upcoming, ...expected.past].map((row) => row.id));
    const records = await loadAccountRegistrationRecords(userId, now, { upcoming: 2, past: 2 });
    for (const item of [...records.upcoming, ...records.past]) expect(mine.has(item.rsvp.id)).toBe(true);
    const nobody = await loadAccountRegistrationRecords(`missing-${suffix}`, now);
    expect(nobody.pagination.upcoming).toMatchObject({ page: 1, total: 0 });
    expect(nobody.upcoming).toEqual([]);
  });
});
