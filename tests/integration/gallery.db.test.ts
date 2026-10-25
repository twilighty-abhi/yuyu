import { randomUUID } from "node:crypto";
import { EventPrivacyType, EventStatus, RegistrationMode, RsvpStatus, SoloPolicy, SubmissionStatus, type Event } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => vi.fn(async (): Promise<{ user: { id: string } } | null> => null));
vi.mock("@/lib/auth", () => ({ auth: authMock }));
vi.mock("@/lib/actionRateLimit", () => ({ isActionRateLimited: async () => false }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { prisma } from "@/lib/db";
import { loadProjectGallery, loadPublicResults } from "@/lib/core/judging";
import { resolvePublicJudgingEvent } from "@/lib/publicJudgingPage";
import { parseGalleryParams } from "@/lib/judgingPaging";

/*
 * Public project gallery search, the *Award winners* filter, and the orders
 * (docs/HACKATHON.md): applied in SQL with id tiebreaks and their own counts,
 * the winners filter and awards order only once results are published, the
 * results page search, public-safe DTOs, and the event page's visibility
 * rules unchanged (null is a real 404).
 */

const suffix = randomUUID().replaceAll("-", "");
const orgSlug = `gallery-${suffix}`;
const otherOrgSlug = `gallery-other-${suffix}`;
const HOUR = 3_600_000;
const base = Date.UTC(2031, 0, 1, 9, 0, 0, 0);

let organisationId = "";
let otherOrganisationId = "";
let event: Event;
let otherEvent: Event;
/** Submission id by title. */
const ids = new Map<string, string>();

async function createEvent(orgId: string, label: string): Promise<Event> {
  return prisma.event.create({
    data: {
      organisationId: orgId,
      title: `Gallery ${label} ${suffix}`,
      slug: `gallery-${label}-${suffix}`,
      startDateTime: new Date(Date.now() - 48 * HOUR),
      endDateTime: new Date(Date.now() - 24 * HOUR),
      timezone: "UTC",
      status: EventStatus.PUBLISHED,
      registrationMode: RegistrationMode.TEAM,
      teamMaxSize: 4,
      soloPolicy: SoloPolicy.SOLO_ALLOWED,
      submissionsEnabled: true,
      submissionsOpenAt: new Date(Date.now() - 4 * HOUR),
      submissionsCloseAt: new Date(Date.now() - HOUR),
      projectGalleryPublic: true,
      page: { create: { isPublished: true } },
    },
  });
}

async function solo(target: Event, name: string, title: string, minutes: number, status: SubmissionStatus = SubmissionStatus.SUBMITTED) {
  const rsvp = await prisma.rSVP.create({
    data: { eventId: target.id, guestName: name, guestEmail: `${randomUUID()}@example.test`, attendeeKey: `guest:${randomUUID()}@example.test`, status: RsvpStatus.CONFIRMED },
  });
  const submission = await prisma.submission.create({
    data: {
      eventId: target.id,
      rsvpId: rsvp.id,
      title,
      summary: "Summary",
      status,
      submittedAt: status === SubmissionStatus.DRAFT ? null : new Date(base + minutes * 60_000),
      disqualifiedReason: status === SubmissionStatus.DISQUALIFIED ? "Secret reason" : null,
    },
  });
  if (target.id === event?.id) ids.set(title, submission.id);
  return submission;
}

async function team(target: Event, name: string, title: string, minutes: number) {
  const created = await prisma.team.create({
    data: { eventId: target.id, name, nameKey: name.toLowerCase(), status: RsvpStatus.CONFIRMED, joinToken: randomUUID(), manageTokenHash: randomUUID() },
  });
  await prisma.rSVP.create({
    data: { eventId: target.id, teamId: created.id, guestName: `${name} Lead`, guestEmail: `${randomUUID()}@example.test`, attendeeKey: `guest:${randomUUID()}@example.test`, status: RsvpStatus.CONFIRMED },
  });
  const submission = await prisma.submission.create({
    data: { eventId: target.id, teamId: created.id, title, summary: "Summary", status: SubmissionStatus.SUBMITTED, submittedAt: new Date(base + minutes * 60_000) },
  });
  if (target.id === event?.id) ids.set(title, submission.id);
  return submission;
}

/** Whatever the page would load for an anonymous viewer: the event page's rules first, then the gallery. */
async function publicGallery(slug: string, raw: Record<string, string>, org = orgSlug) {
  authMock.mockResolvedValue(null);
  const resolved = await resolvePublicJudgingEvent(org, slug);
  if (!resolved) return null;
  return loadProjectGallery(resolved.event.id, undefined, parseGalleryParams(raw, resolved.event.resultsPublishedAt != null));
}

const titles = (gallery: Awaited<ReturnType<typeof loadProjectGallery>>) => gallery?.projects.map((project) => project.title);

describe.sequential("public gallery search, filter, and sort", () => {
  beforeAll(async () => {
    const [org, otherOrg] = await Promise.all([
      prisma.organisation.create({ data: { name: `Gallery ${suffix}`, slug: orgSlug } }),
      prisma.organisation.create({ data: { name: `Gallery other ${suffix}`, slug: otherOrgSlug } }),
    ]);
    organisationId = org.id;
    otherOrganisationId = otherOrg.id;
    event = await createEvent(organisationId, "main");
    otherEvent = await createEvent(otherOrganisationId, "other");

    await solo(event, "Ada Lovelace", "zebra tracker", 1);
    await solo(event, "Grace Hopper", "Apple picker", 2);
    await team(event, `Rocket Crew ${suffix.slice(0, 6)}`, "Launcher", 3);
    await solo(event, "Linus Pauling", "100% Solar_Car", 4);
    await team(event, `Banana Split ${suffix.slice(0, 6)}`, "mango", 5);
    // Two projects with the same title and time: only the id orders them.
    await solo(event, "Twin One", "Twin", 6);
    const twinB = await prisma.submission.create({
      data: {
        eventId: event.id,
        rsvpId: (await prisma.rSVP.create({ data: { eventId: event.id, guestName: "Twin Two", guestEmail: `${randomUUID()}@example.test`, attendeeKey: `guest:${randomUUID()}@example.test`, status: RsvpStatus.CONFIRMED } })).id,
        title: "Twin",
        summary: "Summary",
        status: SubmissionStatus.SUBMITTED,
        submittedAt: new Date(base + 6 * 60_000),
      },
    });
    ids.set("Twin#2", twinB.id);
    // Never listed: drafts, withdrawn, disqualified (even as an award winner).
    await solo(event, "Hidden Draft", "Hidden draft", 7, SubmissionStatus.DRAFT);
    await solo(event, "Hidden Gone", "Hidden withdrawn", 8, SubmissionStatus.WITHDRAWN);
    await solo(event, "Hidden Dq", "Hidden disqualified", 9, SubmissionStatus.DISQUALIFIED);
    // Another organisation's event, with a winner of its own.
    const foreign = await solo(otherEvent, "Foreign Person", "Foreign apple", 1);
    const foreignAward = await prisma.eventAward.create({ data: { eventId: otherEvent.id, name: "Foreign", position: 0 } });
    await prisma.eventAwardWinner.create({ data: { awardId: foreignAward.id, submissionId: foreign.id, place: 1 } });

    // Awards: "Overall" (position 0) and "Best design" (position 1).
    // mango wins Overall 2nd and Best design 1st; Launcher wins Overall 1st;
    // the disqualified project still holds Best design 2nd but is never shown.
    const overall = await prisma.eventAward.create({ data: { eventId: event.id, name: "Overall", position: 0 } });
    const design = await prisma.eventAward.create({ data: { eventId: event.id, name: "Best design", position: 1 } });
    const dq = await prisma.submission.findFirstOrThrow({ where: { eventId: event.id, title: "Hidden disqualified" } });
    await prisma.eventAwardWinner.createMany({
      data: [
        { awardId: overall.id, submissionId: ids.get("Launcher")!, place: 1 },
        { awardId: overall.id, submissionId: ids.get("mango")!, place: 2 },
        { awardId: design.id, submissionId: ids.get("mango")!, place: 1 },
        { awardId: design.id, submissionId: dq.id, place: 2 },
        { awardId: design.id, submissionId: ids.get("zebra tracker")!, place: 3 },
      ],
    });
  });

  afterAll(async () => {
    await prisma.organisation.deleteMany({ where: { id: { in: [organisationId, otherOrganisationId] } } });
    await prisma.$disconnect();
  });

  it("orders newest first by default and A–Z on request, with id tiebreaks", async () => {
    const [twinA, twinB] = [ids.get("Twin")!, ids.get("Twin#2")!].sort();
    const newest = await publicGallery(event.slug, {});
    expect(newest).toMatchObject({ total: 7, matched: 7, sort: "newest", filter: "all", resultsPublished: false, winners: 0 });
    expect(newest?.projects.slice(0, 2).map((project) => project.id)).toEqual([twinB, twinA]);
    expect(titles(newest)?.slice(2)).toEqual(["mango", "100% Solar_Car", "Launcher", "Apple picker", "zebra tracker"]);

    const az = await publicGallery(event.slug, { sort: "az" });
    expect(titles(az)).toEqual(["100% Solar_Car", "Apple picker", "Launcher", "mango", "Twin", "Twin", "zebra tracker"]);
    expect(az?.projects.filter((project) => project.title === "Twin").map((project) => project.id)).toEqual([twinA, twinB]);
  });

  it("searches title, team name, and a solo entrant's first name, with literal wildcards", async () => {
    expect(titles(await publicGallery(event.slug, { q: "  APPLE  " }))).toEqual(["Apple picker"]);
    expect(titles(await publicGallery(event.slug, { q: "rocket crew" }))).toEqual(["Launcher"]);
    expect(titles(await publicGallery(event.slug, { q: "grace" }))).toEqual(["Apple picker"]);
    // Surnames are never shown, so never matched.
    expect(await publicGallery(event.slug, { q: "Hopper" })).toMatchObject({ matched: 0, projects: [] });
    // `%` and `_` match literally.
    expect(titles(await publicGallery(event.slug, { q: "100%" }))).toEqual(["100% Solar_Car"]);
    expect(titles(await publicGallery(event.slug, { q: "r_c" }))).toEqual(["100% Solar_Car"]);
    expect(await publicGallery(event.slug, { q: "%" })).toMatchObject({ matched: 1 });
    // Hidden statuses and other events never match.
    expect(await publicGallery(event.slug, { q: "Hidden" })).toMatchObject({ matched: 0, total: 7 });
    expect(await publicGallery(event.slug, { q: "Foreign" })).toMatchObject({ matched: 0 });
    // Long input is cut to the bound, not refused.
    expect((await publicGallery(event.slug, { q: "x".repeat(500) }))?.query).toHaveLength(100);
    // Search and sort combine.
    expect(titles(await publicGallery(event.slug, { q: "a", sort: "az" }))).toEqual(["100% Solar_Car", "Apple picker", "Launcher", "mango", "zebra tracker"]);
  });

  it("keeps winners private until results are published", async () => {
    const early = await publicGallery(event.slug, { filter: "winners", sort: "awards" });
    expect(early).toMatchObject({ filter: "all", sort: "newest", winners: 0, matched: 7 });
    expect(early?.projects.every((project) => project.awards.length === 0)).toBe(true);
    // Even calling the core directly with the raw values falls back.
    expect(await loadProjectGallery(event.id, undefined, { filter: "winners", sort: "awards" })).toMatchObject({ filter: "all", sort: "newest", matched: 7 });
  });

  it("filters to award winners and orders awards first once published", async () => {
    await prisma.event.update({ where: { id: event.id }, data: { resultsPublishedAt: new Date() } });

    const winners = await publicGallery(event.slug, { filter: "winners" });
    expect(winners).toMatchObject({ filter: "winners", matched: 3, total: 7, winners: 3, resultsPublished: true });
    expect(titles(winners)).toEqual(["mango", "Launcher", "zebra tracker"]);
    expect(winners?.projects.find((project) => project.title === "mango")?.awards).toEqual([
      { name: "Overall", place: 2 },
      { name: "Best design", place: 1 },
    ]);

    // Awards first: best award position, then place, then the rest A–Z.
    const awards = await publicGallery(event.slug, { sort: "awards" });
    expect(titles(awards)).toEqual(["Launcher", "mango", "zebra tracker", "100% Solar_Car", "Apple picker", "Twin", "Twin"]);
    expect(awards?.projects.find((project) => project.title === "Apple picker")?.awards).toEqual([]);

    // Filter, search, and order together.
    expect(titles(await publicGallery(event.slug, { filter: "winners", q: "n", sort: "az" }))).toEqual(["Launcher", "mango"]);
    expect(await publicGallery(event.slug, { filter: "winners", q: "Apple" })).toMatchObject({ matched: 0, projects: [] });

    // Invalid values fall back to the defaults.
    expect(await publicGallery(event.slug, { filter: "losers", sort: "score", page: "-3" })).toMatchObject({ filter: "all", sort: "newest", page: 1, matched: 7 });

    // Public-safe: no emails, scores, comments, or disqualification reasons.
    const text = JSON.stringify(awards);
    expect(text).not.toMatch(/@example\.test|Secret reason|"score"|comment|Hidden|Foreign|Lovelace|Hopper|submittedAt|rsvpId|teamId/);
  });

  it("searches the results page on the shown text", async () => {
    const all = await loadPublicResults(event.id);
    expect(all).toMatchObject({ totalWinners: 4, matchedWinners: 4, query: "" });
    const searched = await loadPublicResults(event.id, { query: "  MANGO " });
    expect(searched).toMatchObject({ query: "MANGO", totalWinners: 4, matchedWinners: 2 });
    expect(searched?.awards.map((award) => [award.name, award.winners.map((winner) => winner.place)])).toEqual([
      ["Overall", [2]],
      ["Best design", [1]],
    ]);
    expect(await loadPublicResults(event.id, { query: "Banana" })).toMatchObject({ matchedWinners: 2 });
    expect(await loadPublicResults(event.id, { query: "Hopper" })).toMatchObject({ matchedWinners: 0, awards: [] });
    expect(JSON.stringify(searched)).not.toMatch(/@example\.test|Secret reason|"score"/);
  });

  it("applies the event page's visibility rules first (null is a 404)", async () => {
    // Wrong organisation slug.
    expect(await publicGallery(event.slug, {}, otherOrgSlug)).toBeNull();
    // Gallery off or window still open.
    await prisma.event.update({ where: { id: event.id }, data: { projectGalleryPublic: false } });
    expect(await publicGallery(event.slug, { q: "a", filter: "winners", sort: "awards" })).toBeNull();
    await prisma.event.update({ where: { id: event.id }, data: { projectGalleryPublic: true, submissionsCloseAt: new Date(Date.now() + HOUR) } });
    expect(await publicGallery(event.slug, {})).toBeNull();
    await prisma.event.update({ where: { id: event.id }, data: { submissionsCloseAt: new Date(Date.now() - HOUR) } });
    // Unreleased page, unpublished event, invite-only event.
    await prisma.eventPage.update({ where: { eventId: event.id }, data: { isPublished: false } });
    expect(await publicGallery(event.slug, { q: "mango" })).toBeNull();
    await prisma.eventPage.update({ where: { eventId: event.id }, data: { isPublished: true } });
    for (const status of [EventStatus.DRAFT, EventStatus.HIDDEN]) {
      await prisma.event.update({ where: { id: event.id }, data: { status } });
      expect(await publicGallery(event.slug, { filter: "winners" }), status).toBeNull();
    }
    await prisma.event.update({ where: { id: event.id }, data: { status: EventStatus.PUBLISHED, privacyType: EventPrivacyType.INVITE_ONLY } });
    expect(await publicGallery(event.slug, {})).toBeNull();
    await prisma.event.update({ where: { id: event.id }, data: { privacyType: EventPrivacyType.PUBLIC } });
    expect(await publicGallery(event.slug, {})).not.toBeNull();
    // Results unpublished: the results page is gone and the gallery drops winners again.
    await prisma.event.update({ where: { id: event.id }, data: { resultsPublishedAt: null } });
    expect(await loadPublicResults(event.id, { query: "mango" })).toBeNull();
    expect(await publicGallery(event.slug, { filter: "winners" })).toMatchObject({ filter: "all", winners: 0 });
  });
});
