import { randomUUID } from "node:crypto";
import { EventPermission, EventStatus, JudgingStatus, MembershipRole, RegistrationMode, SoloPolicy, type Event } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const identity = vi.hoisted(() => ({ id: "" }));
vi.mock("@/lib/auth", () => ({ auth: async () => (identity.id ? { user: { id: identity.id } } : null) }));
vi.mock("@/lib/actionRateLimit", () => ({ isActionRateLimited: async () => false }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { prisma } from "@/lib/db";
import { submitRsvpCore } from "@/lib/rsvpCore";
import { hashTeamManageToken } from "@/lib/teamToken";
import { resolveJudgingOrganiser, type JudgingOrganiserContext } from "@/lib/judgingAccess";
import {
  countResultsAnnouncementRecipients,
  createJudgingCriterion,
  loadJudgingSetup,
  publishResults,
  requestSubmissionLink,
  resolveEntrantByTeamManageToken,
  sendResultsAnnouncement,
  setJudgingStatus,
  submitSubmission,
  unpublishResults,
  updateJudgingSettings,
  withdrawSubmission,
} from "@/lib/core/judging";
import { publishJudgingResults, saveJudgingSettings, sendResultsAnnouncement as sendResultsAnnouncementAction } from "@/app/actions/judging-admin";
import { cloneEvent } from "@/app/actions/event";
import { announcedBefore, resultsAnnouncementState } from "@/lib/hackathonEmails";

/*
 * Hackathon emails are opt-in per event (docs/HACKATHON.md → Hackathon
 * emails, lib/hackathonEmails.ts): `results-published` and
 * `submission-received` are queued only when the organiser turns them on,
 * while registration and capability emails always go out.
 */

const suffix = randomUUID().replaceAll("-", "");
const orgSlug = `emails-${suffix}`;
const otherOrgSlug = `emails-other-${suffix}`;
const startedAt = new Date();
const HOUR = 3_600_000;
let organisationId = "";
let otherOrganisationId = "";
let organiserId = "";
let otherOrganiserId = "";
let judgeId = "";
let sequence = 0;

async function createEvent(): Promise<Event> {
  return prisma.event.create({
    data: {
      organisationId,
      title: `Emails ${suffix}`,
      slug: `emails-${suffix}-${randomUUID().slice(0, 8)}`,
      startDateTime: new Date(Date.now() + 24 * HOUR),
      endDateTime: new Date(Date.now() + 48 * HOUR),
      timezone: "UTC",
      status: EventStatus.PUBLISHED,
      registrationMode: RegistrationMode.TEAM,
      teamMaxSize: 4,
      soloPolicy: SoloPolicy.SOLO_ALLOWED,
      page: { create: { isPublished: true } },
    },
  });
}

async function register(event: Event, label: string, team?: { mode: "create"; name: string } | { mode: "join"; joinToken: string }) {
  sequence += 1;
  const result = await submitRsvpCore(
    { orgSlug, eventSlug: event.slug, guestEmail: `${label}-${sequence}-${suffix}@example.test`, name: `${label} Person`, answers: {} },
    { userId: null, ...(team ? { team } : {}) },
  );
  if (!result.ok || !result.data) throw new Error(`registration failed: ${result.ok ? "no data" : result.error}`);
  return prisma.rSVP.findUniqueOrThrow({ where: { checkInToken: result.data.ticketToken } });
}

async function teamAuth(teamId: string) {
  const team = await prisma.team.findUniqueOrThrow({ where: { id: teamId } });
  const messages = await prisma.outboxMessage.findMany({ where: { kind: "team-created", payload: { path: ["teamId"], equals: teamId } } });
  const token = messages.map((m) => (m.payload as { manageToken?: string }).manageToken).find((raw) => raw && hashTeamManageToken(raw) === team.manageTokenHash);
  if (!token) throw new Error("no manage token");
  const auth = await resolveEntrantByTeamManageToken(token);
  if (!auth) throw new Error("entrant missing");
  return auth;
}

async function organiser(event: Event): Promise<JudgingOrganiserContext> {
  const ctx = await resolveJudgingOrganiser(organiserId, orgSlug, event.id);
  if (!ctx) throw new Error("organiser context missing");
  return ctx;
}

const windowSettings = () => ({
  submissionsEnabled: true,
  submissionsOpenAt: new Date(Date.now() - HOUR).toISOString(),
  submissionsCloseAt: new Date(Date.now() + HOUR).toISOString(),
  judgesSeeAll: true,
  projectGalleryPublic: false,
});

async function openWindow(ctx: JudgingOrganiserContext, emails: { emailEntrantsOnResults?: boolean; emailSubmissionReceipts?: boolean } = {}) {
  const result = await updateJudgingSettings(ctx, { ...windowSettings(), ...emails });
  expect(result.ok).toBe(true);
}

/**
 * An event ready to publish: a team of two (leader and a member) and a solo
 * registrant, all confirmed, with one submitted project. Judging is CLOSED.
 */
async function readyToPublish(emails: { emailEntrantsOnResults?: boolean; emailSubmissionReceipts?: boolean } = {}) {
  const event = await createEvent();
  const ctx = await organiser(event);
  await openWindow(ctx, emails);
  const leader = await register(event, "leader", { mode: "create", name: `Team ${randomUUID().slice(0, 6)}` });
  const team = await prisma.team.findUniqueOrThrow({ where: { id: leader.teamId! } });
  const member = await register(event, "member", { mode: "join", joinToken: team.joinToken });
  const solo = await register(event, "solo");
  expect(await submitSubmission(await teamAuth(team.id), { title: "Project" })).toMatchObject({ ok: true });
  const criterion = await createJudgingCriterion(ctx, { name: "Impact", weight: 1, maxScore: 5 });
  expect(criterion.ok).toBe(true);
  expect(await setJudgingStatus(ctx, JudgingStatus.OPEN)).toMatchObject({ ok: true });
  expect(await setJudgingStatus(ctx, JudgingStatus.CLOSED)).toMatchObject({ ok: true });
  const addresses = [leader, member, solo].map((rsvp) => rsvp.guestEmail!.toLowerCase()).sort();
  return { event, ctx, teamId: team.id, addresses };
}

const announcementsFor = (eventId: string) => ({ kind: "results-published", payload: { path: ["eventId"], equals: eventId } });
const announcedTo = async (eventId: string) =>
  (await prisma.outboxMessage.findMany({ where: announcementsFor(eventId), select: { payload: true } })).map((row) => (row.payload as { to: string }).to).sort();

describe.sequential("hackathon email toggles", () => {
  beforeAll(async () => {
    const [org, otherOrg] = await Promise.all([
      prisma.organisation.create({ data: { name: `Emails ${suffix}`, slug: orgSlug } }),
      prisma.organisation.create({ data: { name: `Emails other ${suffix}`, slug: otherOrgSlug } }),
    ]);
    organisationId = org.id;
    otherOrganisationId = otherOrg.id;
    const [owner, otherOwner, judge] = await Promise.all([
      prisma.user.create({ data: { name: "Organiser", email: `organiser-${suffix}@example.test`, emailVerified: new Date() } }),
      prisma.user.create({ data: { name: "Other organiser", email: `other-${suffix}@example.test`, emailVerified: new Date() } }),
      prisma.user.create({ data: { name: "Judge", email: `judge-${suffix}@example.test`, emailVerified: new Date() } }),
    ]);
    organiserId = owner.id;
    otherOrganiserId = otherOwner.id;
    judgeId = judge.id;
    await prisma.membership.createMany({
      data: [
        { userId: organiserId, organisationId, role: MembershipRole.ADMIN },
        { userId: otherOrganiserId, organisationId: otherOrganisationId, role: MembershipRole.OWNER },
      ],
    });
  });

  afterAll(async () => {
    identity.id = "";
    await prisma.organisation.deleteMany({ where: { id: { in: [organisationId, otherOrganisationId].filter(Boolean) } } });
    await prisma.user.deleteMany({ where: { id: { in: [organiserId, otherOrganiserId, judgeId].filter(Boolean) } } });
    await prisma.outboxMessage.deleteMany({ where: { createdAt: { gte: startedAt } } });
    await prisma.auditEvent.deleteMany({ where: { createdAt: { gte: startedAt }, action: { startsWith: "JUDGING_" } } });
    await prisma.$disconnect();
  });

  it("defaults both switches to false for new events and for rows written without them", async () => {
    const event = await createEvent();
    expect(await prisma.event.findUniqueOrThrow({ where: { id: event.id }, select: { emailEntrantsOnResults: true, emailSubmissionReceipts: true } })).toEqual({
      emailEntrantsOnResults: false,
      emailSubmissionReceipts: false,
    });
    // The migration added NOT NULL DEFAULT false columns, so every existing row reads false.
    const columns = await prisma.$queryRaw<Array<{ column_name: string; is_nullable: string; column_default: string | null }>>`
      SELECT column_name, is_nullable, column_default FROM information_schema.columns
      WHERE table_name = 'Event' AND column_name IN ('emailEntrantsOnResults', 'emailSubmissionReceipts') ORDER BY column_name`;
    expect(columns).toEqual([
      { column_name: "emailEntrantsOnResults", is_nullable: "NO", column_default: "false" },
      { column_name: "emailSubmissionReceipts", is_nullable: "NO", column_default: "false" },
    ]);
    // A row inserted the way pre-migration code wrote it (no mention of the columns) reads false.
    const id = `legacy-${randomUUID()}`;
    await prisma.$executeRaw`
      INSERT INTO "Event" ("id", "organisationId", "title", "slug", "startDateTime", "endDateTime", "timezone", "location", "description", "tags")
      VALUES (${id}, ${organisationId}, 'Legacy', ${`legacy-${suffix}`}, now(), now() + interval '1 hour', 'UTC', '', '', '{}')`;
    expect(await prisma.event.findUniqueOrThrow({ where: { id }, select: { emailEntrantsOnResults: true, emailSubmissionReceipts: true } })).toEqual({
      emailEntrantsOnResults: false,
      emailSubmissionReceipts: false,
    });
    const setup = await loadJudgingSetup(await organiser(event));
    expect(setup?.settings).toMatchObject({ emailEntrantsOnResults: false, emailSubmissionReceipts: false, resultsAnnouncedAt: null });
  });

  it("publishes with results email off: no outbox rows, resultsAnnouncedAt stays null", async () => {
    const { event, ctx, addresses } = await readyToPublish();
    expect(await countResultsAnnouncementRecipients(ctx)).toBe(addresses.length);
    const published = await publishResults(ctx);
    expect(published).toMatchObject({ ok: true, data: { alreadyPublished: false, queued: 0, emailed: false } });
    expect(await prisma.outboxMessage.count({ where: announcementsFor(event.id) })).toBe(0);
    const row = await prisma.event.findUniqueOrThrow({ where: { id: event.id }, select: { resultsPublishedAt: true, resultsAnnouncedAt: true } });
    expect(row.resultsPublishedAt).not.toBeNull();
    expect(row.resultsAnnouncedAt).toBeNull();
    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { action: "JUDGING_RESULTS_PUBLISHED", targetId: event.id } });
    expect(audit.metadata).toMatchObject({ recipients: 0, emailEntrantsOnResults: false });
    // Sending now is refused while the switch is off.
    expect(await sendResultsAnnouncement(ctx)).toMatchObject({ ok: false });
    expect(await prisma.outboxMessage.count({ where: announcementsFor(event.id) })).toBe(0);
    // Unpublish and republish with the switch still off: still nothing.
    expect(await unpublishResults(ctx)).toMatchObject({ ok: true });
    expect(await publishResults(ctx)).toMatchObject({ ok: true, data: { queued: 0, emailed: false } });
    expect(await prisma.outboxMessage.count({ where: announcementsFor(event.id) })).toBe(0);
  });

  it("turning the switch on later and sending now emails each confirmed entrant member once, even with two concurrent sends", async () => {
    const { event, ctx, addresses } = await readyToPublish();
    expect(await publishResults(ctx)).toMatchObject({ ok: true, data: { queued: 0 } });
    const turnOn = await updateJudgingSettings(ctx, { ...windowSettings(), emailEntrantsOnResults: true });
    expect(turnOn).toMatchObject({ ok: true, data: { emailEntrantsOnResults: true, emailSubmissionReceipts: false } });
    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { action: "JUDGING_SETTINGS_UPDATED", targetId: event.id }, orderBy: { createdAt: "desc" } });
    expect(audit.metadata).toMatchObject({ emailEntrantsOnResults: true, emailSubmissionReceipts: false, emailTogglesChanged: "emailEntrantsOnResults" });
    expect(await countResultsAnnouncementRecipients(ctx)).toBe(addresses.length);

    const [first, second] = await Promise.all([sendResultsAnnouncement(ctx), sendResultsAnnouncement(ctx)]);
    expect(first.ok && second.ok).toBe(true);
    const outcomes = [first, second].map((result) => (result.ok ? result.data : null));
    expect(outcomes.map((o) => o?.queued).sort()).toEqual([0, addresses.length]);
    expect(outcomes.filter((o) => o?.alreadyAnnounced)).toHaveLength(1);
    expect(await announcedTo(event.id)).toEqual(addresses);
    expect((await prisma.event.findUniqueOrThrow({ where: { id: event.id }, select: { resultsAnnouncedAt: true } })).resultsAnnouncedAt).not.toBeNull();
    expect(await prisma.auditEvent.count({ where: { action: "JUDGING_RESULTS_ANNOUNCED", targetId: event.id } })).toBe(1);
    expect(await countResultsAnnouncementRecipients(ctx)).toBe(0);

    // A third send is a no-op.
    expect(await sendResultsAnnouncement(ctx)).toMatchObject({ ok: true, data: { queued: 0, alreadyAnnounced: true } });
    expect(await announcedTo(event.id)).toEqual(addresses);

    // Today's no-duplicate rules across unpublish/republish still hold: one copy delivered, the rest withdrawn.
    const delivered = (await prisma.outboxMessage.findMany({ where: announcementsFor(event.id) }))[0]!;
    await prisma.outboxMessage.update({ where: { id: delivered.id }, data: { status: "SENT", sentAt: new Date() } });
    expect(await unpublishResults(ctx)).toMatchObject({ ok: true });
    expect(await publishResults(ctx)).toMatchObject({ ok: true, data: { queued: addresses.length - 1, emailed: true } });
    expect(await announcedTo(event.id)).toEqual(addresses);
  });

  it("after a partly delivered announcement, an unpublish and a republish with the switch off, send now emails only the withdrawn entrants", async () => {
    const { event, ctx, addresses } = await readyToPublish({ emailEntrantsOnResults: true });
    expect(await publishResults(ctx)).toMatchObject({ ok: true, data: { queued: addresses.length, emailed: true } });
    const rows = await prisma.outboxMessage.findMany({ where: announcementsFor(event.id), orderBy: { createdAt: "asc" } });
    const delivered = rows[0]!;
    await prisma.outboxMessage.update({ where: { id: delivered.id }, data: { status: "SENT", sentAt: new Date() } });
    const deliveredTo = (delivered.payload as { to: string }).to;
    expect(await unpublishResults(ctx)).toMatchObject({ ok: true });
    // The delivered copy keeps resultsAnnouncedAt; the other copies were withdrawn.
    const kept = await prisma.event.findUniqueOrThrow({ where: { id: event.id }, select: { resultsAnnouncedAt: true } });
    expect(kept.resultsAnnouncedAt).not.toBeNull();
    expect(await announcedTo(event.id)).toEqual([deliveredTo]);

    // Republish with the switch off: nothing queued, and the publication is not covered.
    expect(await updateJudgingSettings(ctx, { ...windowSettings(), emailEntrantsOnResults: false })).toMatchObject({ ok: true });
    expect(await publishResults(ctx)).toMatchObject({ ok: true, data: { queued: 0, emailed: false } });
    const republished = await prisma.event.findUniqueOrThrow({ where: { id: event.id }, select: { resultsPublishedAt: true, resultsAnnouncedAt: true } });
    expect(republished.resultsAnnouncedAt!.getTime()).toBe(kept.resultsAnnouncedAt!.getTime());
    expect(republished.resultsAnnouncedAt!.getTime()).toBeLessThan(republished.resultsPublishedAt!.getTime());
    const setupOff = await loadJudgingSetup(ctx);
    expect(resultsAnnouncementState(setupOff!.settings)).toBe("off");
    expect(announcedBefore(setupOff!.settings)).toBe(true);
    expect(await sendResultsAnnouncement(ctx)).toMatchObject({ ok: false });

    // Switch on: "Send results email now" is offered and reaches only the withdrawn entrants.
    expect(await updateJudgingSettings(ctx, { ...windowSettings(), emailEntrantsOnResults: true })).toMatchObject({ ok: true });
    const setupOn = await loadJudgingSetup(ctx);
    expect(resultsAnnouncementState(setupOn!.settings)).toBe("ready");
    expect(await countResultsAnnouncementRecipients(ctx)).toBe(addresses.length - 1);
    const [first, second] = await Promise.all([sendResultsAnnouncement(ctx), sendResultsAnnouncement(ctx)]);
    const outcomes = [first, second].map((result) => (result.ok ? result.data : null));
    expect(outcomes.map((o) => o?.queued).sort()).toEqual([0, addresses.length - 1]);
    expect(await announcedTo(event.id)).toEqual(addresses);
    const after = await prisma.event.findUniqueOrThrow({ where: { id: event.id }, select: { resultsPublishedAt: true, resultsAnnouncedAt: true, emailEntrantsOnResults: true } });
    expect(resultsAnnouncementState(after)).toBe("announced");
    expect(await sendResultsAnnouncement(ctx)).toMatchObject({ ok: true, data: { queued: 0, alreadyAnnounced: true } });
    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { action: "JUDGING_RESULTS_ANNOUNCED", targetId: event.id } });
    expect(audit.metadata).toMatchObject({ recipients: addresses.length - 1, announcedBefore: true });
  });

  it("after a fully delivered announcement, a republish with the switch off and send now emails nobody twice", async () => {
    const { event, ctx, addresses } = await readyToPublish({ emailEntrantsOnResults: true });
    expect(await publishResults(ctx)).toMatchObject({ ok: true, data: { queued: addresses.length } });
    await prisma.outboxMessage.updateMany({ where: announcementsFor(event.id), data: { status: "SENT", sentAt: new Date() } });
    expect(await unpublishResults(ctx)).toMatchObject({ ok: true });
    expect(await updateJudgingSettings(ctx, { ...windowSettings(), emailEntrantsOnResults: false })).toMatchObject({ ok: true });
    expect(await publishResults(ctx)).toMatchObject({ ok: true, data: { queued: 0, emailed: false } });
    expect(await updateJudgingSettings(ctx, { ...windowSettings(), emailEntrantsOnResults: true })).toMatchObject({ ok: true });
    expect(await countResultsAnnouncementRecipients(ctx)).toBe(0);
    expect(await sendResultsAnnouncement(ctx)).toMatchObject({ ok: true, data: { queued: 0, alreadyAnnounced: false } });
    expect(await prisma.outboxMessage.count({ where: announcementsFor(event.id) })).toBe(addresses.length);
  });

  it("publishing with the switch on emails as before", async () => {
    const { event, ctx, addresses } = await readyToPublish({ emailEntrantsOnResults: true });
    expect(await publishResults(ctx)).toMatchObject({ ok: true, data: { queued: addresses.length, emailed: true } });
    expect(await announcedTo(event.id)).toEqual(addresses);
    expect((await prisma.event.findUniqueOrThrow({ where: { id: event.id }, select: { resultsAnnouncedAt: true } })).resultsAnnouncedAt).not.toBeNull();
    expect(await sendResultsAnnouncement(ctx)).toMatchObject({ ok: true, data: { queued: 0, alreadyAnnounced: true } });
    expect(await prisma.outboxMessage.count({ where: announcementsFor(event.id) })).toBe(addresses.length);
  });

  it("queues the submission receipt only when receipts are on; registration, team and submission-link emails always go out", async () => {
    const event = await createEvent();
    const ctx = await organiser(event);
    await openWindow(ctx);
    const leader = await register(event, "receipt-leader", { mode: "create", name: `Receipts ${suffix.slice(0, 6)}` });
    const solo = await register(event, "receipt-solo");
    // Registration and capability emails, with both switches off.
    for (const rsvp of [leader, solo]) {
      expect(await prisma.outboxMessage.count({ where: { kind: "rsvp-confirmation", payload: { path: ["to"], equals: rsvp.guestEmail! } } })).toBe(1);
    }
    expect(await prisma.outboxMessage.count({ where: { kind: "team-created", payload: { path: ["teamId"], equals: leader.teamId! } } })).toBe(1);
    expect(await requestSubmissionLink({ rsvpId: solo.id, eventId: event.id })).toEqual({ ok: true, data: { sent: true } });
    expect(await prisma.outboxMessage.count({ where: { kind: "submission-link", payload: { path: ["rsvpId"], equals: solo.id } } })).toBe(1);

    const auth = await teamAuth(leader.teamId!);
    const submitted = await submitSubmission(auth, { title: "No receipt" });
    if (!submitted.ok) throw new Error(submitted.error);
    // The entrant is not told about an email that was never queued.
    expect(submitted.data.receiptQueued).toBe(false);
    const receipts = () => prisma.outboxMessage.count({ where: { kind: "submission-received", payload: { path: ["submissionId"], equals: submitted.data.submissionId } } });
    expect(await receipts()).toBe(0);

    // Turn receipts on; a fresh submission (withdraw, then submit) gets exactly one.
    expect(await updateJudgingSettings(ctx, { ...windowSettings(), emailSubmissionReceipts: true })).toMatchObject({ ok: true, data: { emailSubmissionReceipts: true, emailEntrantsOnResults: false } });
    expect(await withdrawSubmission(auth)).toMatchObject({ ok: true });
    expect(await submitSubmission(auth, { title: "With receipt" })).toMatchObject({ ok: true, data: { receiptQueued: true } });
    expect(await receipts()).toBe(1);
    // Editing a submitted project doesn't send another.
    expect(await submitSubmission(auth, { title: "Edited" })).toMatchObject({ ok: true, data: { receiptQueued: false } });
    expect(await receipts()).toBe(1);

    // Settings saved without the switches (the Settings tab card) keep them.
    expect(await updateJudgingSettings(ctx, windowSettings())).toMatchObject({ ok: true, data: { emailSubmissionReceipts: true } });
  });

  it("refuses the email switches and sending to a JUDGE-only collaborator and to another organisation", async () => {
    const { event, ctx } = await readyToPublish();
    await prisma.eventCollaborator.create({ data: { eventId: event.id, userId: judgeId, permissions: [EventPermission.JUDGE] } });
    expect(await resolveJudgingOrganiser(judgeId, orgSlug, event.id)).toBeNull();
    expect(await resolveJudgingOrganiser(otherOrganiserId, orgSlug, event.id)).toBeNull();
    expect(await resolveJudgingOrganiser(otherOrganiserId, otherOrgSlug, event.id)).toBeNull();

    const scope = { organisationSlug: orgSlug, eventId: event.id };
    const noPermission = { ok: false, error: "You do not have permission to manage judging for this event." };
    for (const userId of [judgeId, otherOrganiserId]) {
      identity.id = userId;
      expect(await saveJudgingSettings({ ...scope, settings: { ...windowSettings(), emailEntrantsOnResults: true, emailSubmissionReceipts: true } })).toMatchObject(noPermission);
      expect(await publishJudgingResults(scope)).toMatchObject(noPermission);
      expect(await sendResultsAnnouncementAction(scope)).toMatchObject(noPermission);
      expect(await sendResultsAnnouncementAction({ organisationSlug: otherOrgSlug, eventId: event.id })).toMatchObject({ ok: false });
    }
    identity.id = "";
    expect(await prisma.event.findUniqueOrThrow({ where: { id: event.id }, select: { emailEntrantsOnResults: true, emailSubmissionReceipts: true, resultsPublishedAt: true } })).toEqual({
      emailEntrantsOnResults: false,
      emailSubmissionReceipts: false,
      resultsPublishedAt: null,
    });

    // A forged context from another organisation finds no event.
    const foreign: JudgingOrganiserContext = { ...ctx, userId: otherOrganiserId, organisationId: otherOrganisationId, orgSlug: otherOrgSlug };
    expect(await sendResultsAnnouncement(foreign)).toMatchObject({ ok: false, error: "Event not found." });
    expect(await updateJudgingSettings(foreign, { ...windowSettings(), emailEntrantsOnResults: true })).toMatchObject({ ok: false, error: "Event not found." });
    expect(await countResultsAnnouncementRecipients(foreign)).toBeNull();

    // The organiser can, through the same actions.
    identity.id = organiserId;
    expect(await saveJudgingSettings({ ...scope, settings: { ...windowSettings(), emailEntrantsOnResults: false } })).toMatchObject({ ok: true });
    expect(await publishJudgingResults(scope)).toMatchObject({ ok: true, data: { queued: 0, emailed: false } });
    expect(await saveJudgingSettings({ ...scope, settings: { ...windowSettings(), emailEntrantsOnResults: true } })).toMatchObject({ ok: true });
    expect(await sendResultsAnnouncementAction(scope)).toMatchObject({ ok: true, data: { queued: 3, alreadyAnnounced: false } });
    identity.id = "";
    expect(await prisma.outboxMessage.count({ where: announcementsFor(event.id) })).toBe(3);
  });

  it("copies both switches when an event is cloned", async () => {
    const event = await createEvent();
    await prisma.event.update({ where: { id: event.id }, data: { emailEntrantsOnResults: true, emailSubmissionReceipts: true } });
    identity.id = organiserId;
    const cloned = await cloneEvent({ organisationSlug: orgSlug, eventId: event.id });
    identity.id = "";
    if (!cloned.ok || !cloned.data) throw new Error(cloned.ok ? "no data" : cloned.error);
    expect(await prisma.event.findUniqueOrThrow({ where: { id: cloned.data.eventId }, select: { emailEntrantsOnResults: true, emailSubmissionReceipts: true } })).toEqual({
      emailEntrantsOnResults: true,
      emailSubmissionReceipts: true,
    });
  });
});
