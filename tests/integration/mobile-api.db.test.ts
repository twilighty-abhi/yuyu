import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { EventPermission, EventPrivacyType, EventStatus, RsvpStatus } from "@prisma/client";

// Never let an ambient Redis or base URL leak into this suite.
process.env.REDIS_URL = "";
process.env.NEXT_PUBLIC_BASE_URL = "https://yuyu.test";
// Each request gets its own client address so the shared per-IP sign-in
// bucket does not throttle this suite; per-account limits still apply.
process.env.TRUSTED_PROXY_IP_HEADER = "x-real-ip";

const published = vi.hoisted(() => vi.fn());
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-real-ip": `198.51.100.${Math.floor(Math.random() * 250)}` }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const authMock = vi.hoisted(() => vi.fn(async (): Promise<{ user: { id: string } } | null> => null));
vi.mock("@/lib/auth", () => ({ auth: authMock }));
vi.mock("@/lib/outboxWorker", () => ({ startOutboxWorker: vi.fn() }));
vi.mock("@/lib/ticketCheckInEvents", () => ({ publishTicketCheckedIn: published }));

import { prisma } from "@/lib/db";
import { REFRESH_REUSE_GRACE_MS } from "@/lib/mobileAuth";
import { POST as login } from "@/app/api/mobile/v1/auth/login/route";
import { POST as refresh } from "@/app/api/mobile/v1/auth/refresh/route";
import { POST as logoutAll } from "@/app/api/mobile/v1/auth/logout-all/route";
import { GET as me } from "@/app/api/mobile/v1/me/route";
import { GET as myRegistrations } from "@/app/api/mobile/v1/me/registrations/route";
import { POST as cancelMine } from "@/app/api/mobile/v1/me/registrations/[rsvpId]/cancel/route";
import { GET as eventDetail } from "@/app/api/mobile/v1/orgs/[orgSlug]/events/[eventId]/route";
import { GET as guestList } from "@/app/api/mobile/v1/orgs/[orgSlug]/events/[eventId]/guests/route";
import { POST as approve } from "@/app/api/mobile/v1/orgs/[orgSlug]/events/[eventId]/guests/[rsvpId]/approve/route";
import { POST as checkIn } from "@/app/api/mobile/v1/orgs/[orgSlug]/events/[eventId]/check-in/route";
import { POST as sendBroadcast } from "@/app/api/mobile/v1/orgs/[orgSlug]/events/[eventId]/broadcasts/route";
import { GET as broadcastsMeta } from "@/app/api/mobile/v1/orgs/[orgSlug]/events/[eventId]/broadcasts/meta/route";
import { GET as publicEvent } from "@/app/api/mobile/v1/public/events/[orgSlug]/[eventSlug]/route";
import { GET as schedule } from "@/app/api/mobile/v1/orgs/[orgSlug]/events/[eventId]/schedule/route";
import { POST as registrationState } from "@/app/api/mobile/v1/orgs/[orgSlug]/events/[eventId]/registration/state/route";
import { DELETE as deleteGuest } from "@/app/api/mobile/v1/orgs/[orgSlug]/events/[eventId]/guests/[rsvpId]/route";
import { POST as restoreGuest } from "@/app/api/mobile/v1/orgs/[orgSlug]/events/[eventId]/guests/restore/route";
import { updateEvent } from "@/app/actions/event";
import { updateEventSchema } from "@/lib/validators";

const suffix = randomUUID().replaceAll("-", "").slice(0, 16);
const PASSWORD = "correct horse battery staple";
const ids = { orgA: "", orgB: "", eventA: "", eventB: "", owner: "", collaborator: "", attendee: "", other: "" };
const slugs = { orgA: `mob-a-${suffix}`, orgB: `mob-b-${suffix}`, eventA: `event-a-${suffix}`, eventB: `event-b-${suffix}` };
const email = (name: string) => `${name}-${suffix}@example.test`;

function post(path: string, body: unknown, token?: string) {
  return new Request(`https://yuyu.test${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
}
function get(path: string, token?: string) {
  return new Request(`https://yuyu.test${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
}
const params = <T extends Record<string, string>>(value: T) => ({ params: Promise.resolve(value) });
const none = params({});

async function signIn(name: string, deviceName = "Test phone") {
  const response = await login(post("/api/mobile/v1/auth/login", { email: email(name), password: PASSWORD, deviceName, platform: "android" }), none);
  expect(response.status).toBe(200);
  const body = await response.json();
  return body.data as { accessToken: string; refreshToken: string };
}

async function createUser(name: string) {
  const user = await prisma.user.create({ data: { email: email(name), name, emailVerified: new Date(), passwordHash: await bcrypt.hash(PASSWORD, 4) } });
  return user.id;
}

async function createEvent(organisationId: string, slug: string) {
  const event = await prisma.event.create({ data: {
    organisationId, title: `Mobile ${slug}`, slug,
    startDateTime: new Date(Date.now() + 2 * 60 * 60_000), endDateTime: new Date(Date.now() + 4 * 60 * 60_000),
    timezone: "UTC", status: EventStatus.PUBLISHED, privacyType: EventPrivacyType.PUBLIC,
    page: { create: { isPublished: true } },
  } });
  return event.id;
}

describe.sequential("mobile API integration", () => {
  beforeAll(async () => {
    const [orgA, orgB] = await Promise.all([
      prisma.organisation.create({ data: { name: "Mobile A", slug: slugs.orgA } }),
      prisma.organisation.create({ data: { name: "Mobile B", slug: slugs.orgB } }),
    ]);
    ids.orgA = orgA.id;
    ids.orgB = orgB.id;
    ids.owner = await createUser("owner");
    ids.collaborator = await createUser("collab");
    ids.attendee = await createUser("attendee");
    ids.other = await createUser("other");
    ids.eventA = await createEvent(orgA.id, slugs.eventA);
    ids.eventB = await createEvent(orgB.id, slugs.eventB);
    await prisma.membership.create({ data: { userId: ids.owner, organisationId: orgA.id, role: "OWNER" } });
    await prisma.eventCollaborator.create({ data: { userId: ids.collaborator, eventId: ids.eventA, permissions: [EventPermission.CHECK_IN] } });
  });

  beforeEach(() => published.mockClear());

  afterAll(async () => {
    await prisma.organisation.deleteMany({ where: { id: { in: [ids.orgA, ids.orgB].filter(Boolean) } } });
    await prisma.user.deleteMany({ where: { id: { in: [ids.owner, ids.collaborator, ids.attendee, ids.other].filter(Boolean) } } });
    await prisma.$disconnect();
  });

  it("signs in, rotates refresh tokens, and revokes the session when a rotated token is reused", async () => {
    const first = await signIn("attendee");
    const stored = await prisma.mobileSession.findFirstOrThrow({ where: { userId: ids.attendee }, orderBy: { createdAt: "desc" } });
    expect(JSON.stringify(stored)).not.toContain(first.accessToken);
    expect(JSON.stringify(stored)).not.toContain(first.refreshToken);
    expect(stored.platform).toBe("android");

    const rotated = await refresh(post("/api/mobile/v1/auth/refresh", { refreshToken: first.refreshToken }), none);
    expect(rotated.status).toBe(200);
    const second = (await rotated.json()).data as { accessToken: string; refreshToken: string };
    expect(second.refreshToken).not.toBe(first.refreshToken);
    expect((await me(get("/api/mobile/v1/me", first.accessToken), none)).status).toBe(401);
    expect((await me(get("/api/mobile/v1/me", second.accessToken), none)).status).toBe(200);

    // Replayed after the lost-response grace window: treated as a copied token.
    await prisma.mobileSession.update({ where: { id: stored.id }, data: { rotatedAt: new Date(Date.now() - REFRESH_REUSE_GRACE_MS - 1_000) } });
    const replay = await refresh(post("/api/mobile/v1/auth/refresh", { refreshToken: first.refreshToken }), none);
    expect(replay.status).toBe(401);
    await expect(replay.json()).resolves.toMatchObject({ ok: false, error: { code: "UNAUTHENTICATED" } });
    expect((await prisma.mobileSession.findUniqueOrThrow({ where: { id: stored.id } })).revokedAt).not.toBeNull();
    expect((await me(get("/api/mobile/v1/me", second.accessToken), none)).status).toBe(401);
    expect((await refresh(post("/api/mobile/v1/auth/refresh", { refreshToken: second.refreshToken }), none)).status).toBe(401);
    await expect(prisma.auditEvent.count({ where: { action: "MOBILE_REFRESH_TOKEN_REUSED", actorUserId: ids.attendee } })).resolves.toBe(1);
  });

  it("uses the generic credential error and MFA/verification codes like web sign-in", async () => {
    const wrong = await login(post("/api/mobile/v1/auth/login", { email: email("attendee"), password: "nope nope nope" }), none);
    expect(wrong.status).toBe(400);
    await expect(wrong.json()).resolves.toEqual({ ok: false, error: { code: "INVALID_REQUEST", message: "Email or password is incorrect." } });
    const missing = await login(post("/api/mobile/v1/auth/login", { email: email("nobody"), password: PASSWORD }), none);
    await expect(missing.json()).resolves.toEqual({ ok: false, error: { code: "INVALID_REQUEST", message: "Email or password is incorrect." } });
  });

  it("sign out everywhere and a session-version bump kill every mobile session", async () => {
    const phone = await signIn("other", "Phone");
    const tablet = await signIn("other", "Tablet");
    expect((await logoutAll(post("/api/mobile/v1/auth/logout-all", {}, phone.accessToken), none)).status).toBe(200);
    expect((await me(get("/api/mobile/v1/me", tablet.accessToken), none)).status).toBe(401);
    expect((await me(get("/api/mobile/v1/me", phone.accessToken), none)).status).toBe(401);
    await expect(prisma.mobileSession.count({ where: { userId: ids.other, revokedAt: null } })).resolves.toBe(0);

    const fresh = await signIn("other", "Phone");
    expect((await me(get("/api/mobile/v1/me", fresh.accessToken), none)).status).toBe(200);
    // A password change/reset or MFA change bumps sessionVersion.
    await prisma.user.update({ where: { id: ids.other }, data: { sessionVersion: { increment: 1 } } });
    expect((await me(get("/api/mobile/v1/me", fresh.accessToken), none)).status).toBe(401);
    expect((await refresh(post("/api/mobile/v1/auth/refresh", { refreshToken: fresh.refreshToken }), none)).status).toBe(401);
  });

  it("returns NOT_FOUND for another organisation's events and guests", async () => {
    const owner = await signIn("owner");
    const pending = await prisma.rSVP.create({ data: { eventId: ids.eventB, attendeeKey: `guest:${email("b-pending")}`, guestEmail: email("b-pending"), guestName: "B", status: RsvpStatus.PENDING_APPROVAL } });
    expect((await eventDetail(get("/x", owner.accessToken), params({ orgSlug: slugs.orgA, eventId: ids.eventA }))).status).toBe(200);
    expect((await eventDetail(get("/x", owner.accessToken), params({ orgSlug: slugs.orgA, eventId: ids.eventB }))).status).toBe(404);
    expect((await eventDetail(get("/x", owner.accessToken), params({ orgSlug: slugs.orgB, eventId: ids.eventB }))).status).toBe(404);
    expect((await approve(post("/x", {}, owner.accessToken), params({ orgSlug: slugs.orgB, eventId: ids.eventB, rsvpId: pending.id }))).status).toBe(404);
    expect((await approve(post("/x", {}, owner.accessToken), params({ orgSlug: slugs.orgA, eventId: ids.eventB, rsvpId: pending.id }))).status).toBe(404);
    // An RSVP id from another event, addressed through the caller's own event.
    expect((await approve(post("/x", {}, owner.accessToken), params({ orgSlug: slugs.orgA, eventId: ids.eventA, rsvpId: pending.id }))).status).toBe(404);
    expect((await checkIn(post("/x", { rsvpId: pending.id }, owner.accessToken), params({ orgSlug: slugs.orgB, eventId: ids.eventB }))).status).toBe(404);
    expect((await prisma.rSVP.findUniqueOrThrow({ where: { id: pending.id } })).status).toBe(RsvpStatus.PENDING_APPROVAL);
  });

  it("shows every organiser the programme with speakers and effective times, never another organisation's", async () => {
    const start = new Date(Date.now() + 2 * 60 * 60_000);
    const at = (minutes: number) => new Date(start.getTime() + minutes * 60_000);
    const track = await prisma.eventScheduleTrack.create({ data: { eventId: ids.eventA, name: "Main stage" } });
    const speaker = await prisma.eventSpeaker.create({ data: { eventId: ids.eventA, name: "Ada Lovelace", slug: `ada-${suffix}`, headline: "Founder", photoUrl: "/api/uploads/speakers/ada.webp" } });
    const first = await prisma.eventSession.create({ data: {
      eventId: ids.eventA, trackId: track.id, title: "Keynote", slug: `keynote-${suffix}`, type: "Keynote", visibility: "PUBLISHED",
      startDateTime: at(0), endDateTime: at(45), delayMinutes: 10,
      speakers: { create: { speakerId: speaker.id } },
    } });
    const second = await prisma.eventSession.create({ data: {
      eventId: ids.eventA, trackId: track.id, title: "Draft panel", slug: `panel-${suffix}`, startDateTime: at(60), endDateTime: at(90),
    } });
    try {
      // A CHECK_IN-only collaborator has no `schedule` permission but still reads the programme.
      const collaborator = await signIn("collab");
      const response = await schedule(get("/x", collaborator.accessToken), params({ orgSlug: slugs.orgA, eventId: ids.eventA }));
      expect(response.status).toBe(200);
      const sessions = (await response.json()).data.tracks.find((entry: { id: string }) => entry.id === track.id).sessions;
      expect(sessions).toEqual([
        expect.objectContaining({
          id: first.id, type: "Keynote", visibility: "PUBLISHED", delayMinutes: 10,
          effectiveStartDateTime: at(0).toISOString(),
          speakers: [{ id: speaker.id, name: "Ada Lovelace", headline: "Founder", organisation: null, photoUrl: "https://yuyu.test/api/uploads/speakers/ada.webp" }],
        }),
        expect.objectContaining({
          id: second.id, visibility: "DRAFT", startDateTime: at(60).toISOString(),
          effectiveStartDateTime: at(70).toISOString(), effectiveEndDateTime: at(100).toISOString(), speakers: [],
        }),
      ]);

      const owner = await signIn("owner");
      expect((await schedule(get("/x", owner.accessToken), params({ orgSlug: slugs.orgB, eventId: ids.eventB }))).status).toBe(404);
      expect((await schedule(get("/x", owner.accessToken), params({ orgSlug: slugs.orgA, eventId: ids.eventB }))).status).toBe(404);
      const outsider = await signIn("other");
      expect((await schedule(get("/x", outsider.accessToken), params({ orgSlug: slugs.orgA, eventId: ids.eventA }))).status).toBe(404);
    } finally {
      await prisma.eventSession.deleteMany({ where: { id: { in: [first.id, second.id] } } });
      await prisma.eventSpeaker.delete({ where: { id: speaker.id } });
      await prisma.eventScheduleTrack.delete({ where: { id: track.id } });
    }
  });

  it("lets a CHECK_IN collaborator check in (through commitCheckInProjection) but not approve or email", async () => {
    const collaborator = await signIn("collab");
    const confirmed = await prisma.rSVP.create({ data: { eventId: ids.eventA, attendeeKey: `guest:${email("door")}`, guestEmail: email("door"), guestName: "Door guest", status: RsvpStatus.CONFIRMED } });
    const pending = await prisma.rSVP.create({ data: { eventId: ids.eventA, attendeeKey: `guest:${email("wait")}`, guestEmail: email("wait"), guestName: "Pending guest", status: RsvpStatus.PENDING_APPROVAL } });
    const target = { orgSlug: slugs.orgA, eventId: ids.eventA };

    const scanned = await checkIn(post("/x", { rawInput: `https://yuyu.test/ticket/${confirmed.checkInToken}` }, collaborator.accessToken), params(target));
    expect(scanned.status).toBe(200);
    const scannedBody = await scanned.json();
    expect(scannedBody.data).toMatchObject({ rsvpId: confirmed.id, alreadyCheckedIn: false });
    expect(JSON.stringify(scannedBody)).not.toContain(confirmed.checkInToken);
    expect(published).toHaveBeenCalledWith({ rsvpId: confirmed.id, checkedInAt: expect.any(Date) });
    await expect(prisma.checkInEvent.findFirstOrThrow({ where: { rsvpId: confirmed.id } })).resolves.toMatchObject({ source: "mobile-scan", actorUserId: ids.collaborator });

    const needsForce = await checkIn(post("/x", { rsvpId: pending.id }, collaborator.accessToken), params(target));
    expect(needsForce.status).not.toBe(200);

    expect((await approve(post("/x", {}, collaborator.accessToken), params({ ...target, rsvpId: pending.id }))).status).toBe(403);
    expect((await prisma.rSVP.findUniqueOrThrow({ where: { id: pending.id } })).status).toBe(RsvpStatus.PENDING_APPROVAL);
    expect((await broadcastsMeta(get("/x", collaborator.accessToken), params(target))).status).toBe(403);
    const send = await sendBroadcast(post("/x", { statuses: ["CONFIRMED"], subject: "Hi", body: "<p>Hello</p>" }, collaborator.accessToken), params(target));
    expect(send.status).toBe(403);
    await expect(prisma.eventBroadcast.count({ where: { eventId: ids.eventA } })).resolves.toBe(0);

    // The check-in desk sees guests, but never ticket tokens in the guest list.
    const guests = await guestList(get("/x", collaborator.accessToken), params(target));
    expect(guests.status).toBe(200);
    expect(JSON.stringify(await guests.json())).not.toContain(confirmed.checkInToken);

    const owner = await signIn("owner");
    const approved = await approve(post("/x", {}, owner.accessToken), params({ ...target, rsvpId: pending.id }));
    expect(approved.status).toBe(200);
    await expect(approved.json()).resolves.toMatchObject({ ok: true, data: { rsvpId: pending.id, status: "CONFIRMED" } });
    await expect(prisma.auditEvent.count({ where: { action: "RSVP_APPROVED", targetId: pending.id, actorUserId: ids.owner } })).resolves.toBe(1);
  });

  it("exposes a ticket token only to its owner and cancels only the caller's own RSVP", async () => {
    const mine = await prisma.rSVP.create({ data: { eventId: ids.eventA, userId: ids.attendee, attendeeKey: `user:${ids.attendee}`, status: RsvpStatus.CONFIRMED } });
    const theirs = await prisma.rSVP.create({ data: { eventId: ids.eventA, userId: ids.other, attendeeKey: `user:${ids.other}`, status: RsvpStatus.CONFIRMED } });
    const attendee = await signIn("attendee");
    const other = await signIn("other");

    const registrations = await (await myRegistrations(get("/x", attendee.accessToken), none)).json();
    expect(registrations.data.upcoming).toEqual([expect.objectContaining({ rsvpId: mine.id, ticketToken: mine.checkInToken, canCancel: true })]);
    expect(JSON.stringify(registrations)).not.toContain(theirs.checkInToken);

    const page = await (await publicEvent(get("/x", attendee.accessToken), params({ orgSlug: slugs.orgA, eventSlug: slugs.eventA }))).json();
    expect(page.data.registration.myRsvp).toEqual({ rsvpId: mine.id, status: "CONFIRMED", ticketToken: mine.checkInToken });
    expect(JSON.stringify(page)).not.toContain(theirs.checkInToken);
    const anonymous = await (await publicEvent(get("/x"), params({ orgSlug: slugs.orgA, eventSlug: slugs.eventA }))).json();
    expect(anonymous.data.registration.myRsvp).toBeNull();

    expect((await cancelMine(post("/x", {}, attendee.accessToken), params({ rsvpId: theirs.id }))).status).toBe(404);
    await expect(prisma.rSVP.findUnique({ where: { id: theirs.id } })).resolves.not.toBeNull();
    expect((await cancelMine(post("/x", {}, attendee.accessToken), params({ rsvpId: mine.id }))).status).toBe(200);
    await expect(prisma.rSVP.findUnique({ where: { id: mine.id } })).resolves.toBeNull();
    expect((await cancelMine(post("/x", {}, other.accessToken), params({ rsvpId: theirs.id }))).status).toBe(200);
  });
  it("treats a quick retry of the previous refresh token as a lost response, not theft", async () => {
    const first = await signIn("attendee", "Flaky Wi-Fi");
    const rotated = await refresh(post("/api/mobile/v1/auth/refresh", { refreshToken: first.refreshToken }), none);
    const second = (await rotated.json()).data as { accessToken: string; refreshToken: string };
    const retry = await refresh(post("/api/mobile/v1/auth/refresh", { refreshToken: first.refreshToken }), none);
    expect(retry.status).toBe(401);
    expect((await me(get("/api/mobile/v1/me", second.accessToken), none)).status).toBe(200);

    // After the grace window the same replay revokes the session.
    const session = await prisma.mobileSession.findFirstOrThrow({ where: { deviceName: "Flaky Wi-Fi", userId: ids.attendee }, orderBy: { createdAt: "desc" } });
    await prisma.mobileSession.update({ where: { id: session.id }, data: { rotatedAt: new Date(Date.now() - REFRESH_REUSE_GRACE_MS - 1_000) } });
    expect((await refresh(post("/api/mobile/v1/auth/refresh", { refreshToken: first.refreshToken }), none)).status).toBe(401);
    expect((await me(get("/api/mobile/v1/me", second.accessToken), none)).status).toBe(401);
  });

  it("closes sign-ups after the start without breaking the web cutoff rule", async () => {
    const owner = await signIn("owner");
    const started = await prisma.event.create({ data: {
      organisationId: ids.orgA, title: "Started", slug: `started-${suffix}`,
      startDateTime: new Date(Date.now() - 30 * 60_000), endDateTime: new Date(Date.now() + 2 * 60 * 60_000),
      timezone: "UTC", status: EventStatus.PUBLISHED, location: "Main hall", registrationLeadMinutes: 15,
      page: { create: { isPublished: true } },
    } });
    const closed = await registrationState(post("/x", { open: false }, owner.accessToken), params({ orgSlug: slugs.orgA, eventId: started.id }));
    expect(closed.status).toBe(200);
    await expect(closed.json()).resolves.toMatchObject({ ok: true, data: { registrationOpen: false, registrationManuallyClosed: true, registrationClosesAt: started.startDateTime.toISOString() } });
    const row = await prisma.event.findUniqueOrThrow({ where: { id: started.id } });
    expect(row.registrationClosesAt).toEqual(started.startDateTime);
    expect(row.registrationLeadMinutes).toBeNull();
    expect(row.registrationLeadBeforeManualClose).toBe(15);
    // What the dashboard form would submit for this event passes the cutoff rule.
    const issues = updateEventSchema.safeParse({
      organisationSlug: slugs.orgA, eventId: started.id, title: row.title, startDateTime: row.startDateTime, endDateTime: row.endDateTime,
      timezone: row.timezone, location: row.location, status: row.status, privacyType: row.privacyType, registrationClosesAt: row.registrationClosesAt?.toISOString(),
    }).error?.issues ?? [];
    expect(issues.filter((issue) => issue.path[0] === "registrationClosesAt")).toEqual([]);
  });

  it("reopens only after a manual close, restoring the organiser's lead time; a web save clears the snapshot", async () => {
    const owner = await signIn("owner");
    const upcoming = await prisma.event.create({ data: {
      organisationId: ids.orgA, title: "Upcoming", slug: `upcoming-${suffix}`,
      startDateTime: new Date(Date.now() + 5 * 24 * 60 * 60_000), endDateTime: new Date(Date.now() + 5 * 24 * 60 * 60_000 + 7_200_000),
      timezone: "UTC", status: EventStatus.PUBLISHED, location: "Main hall", registrationLeadMinutes: 60,
      page: { create: { isPublished: true } },
    } });
    const target = params({ orgSlug: slugs.orgA, eventId: upcoming.id });

    const premature = await registrationState(post("/x", { open: true }, owner.accessToken), target);
    expect(premature.status).toBe(409);
    await expect(premature.json()).resolves.toMatchObject({ ok: false, error: { code: "CONFLICT" } });

    expect((await registrationState(post("/x", { open: false }, owner.accessToken), target)).status).toBe(200);
    expect((await registrationState(post("/x", { open: false }, owner.accessToken), target)).status).toBe(200);
    const reopened = await registrationState(post("/x", { open: true }, owner.accessToken), target);
    await expect(reopened.json()).resolves.toMatchObject({ ok: true, data: { registrationOpen: true, registrationManuallyClosed: false, registrationClosedReason: null } });
    await expect(prisma.event.findUniqueOrThrow({ where: { id: upcoming.id } })).resolves.toMatchObject({
      registrationLeadMinutes: 60, registrationClosesAt: null, registrationManuallyClosedAt: null, registrationLeadBeforeManualClose: null,
    });

    // Close again, then save the dashboard form: its explicit cutoff wins and there is nothing to reopen.
    expect((await registrationState(post("/x", { open: false }, owner.accessToken), target)).status).toBe(200);
    authMock.mockResolvedValueOnce({ user: { id: ids.owner } });
    const saved = await updateEvent({
      organisationSlug: slugs.orgA, eventId: upcoming.id, title: "Upcoming", startDateTime: upcoming.startDateTime.toISOString(),
      endDateTime: upcoming.endDateTime.toISOString(), timezone: "UTC", location: "Main hall", status: "PUBLISHED", privacyType: "PUBLIC",
      registrationLeadMinutes: 30,
    });
    expect(saved).toEqual({ ok: true });
    await expect(prisma.event.findUniqueOrThrow({ where: { id: upcoming.id } })).resolves.toMatchObject({
      registrationLeadMinutes: 30, registrationClosesAt: null, registrationManuallyClosedAt: null, registrationLeadBeforeManualClose: null, registrationCutoffBeforeManualClose: null,
    });
    expect((await registrationState(post("/x", { open: true }, owner.accessToken), target)).status).toBe(409);
  });

  it("restores a deleted guest only through the event it was deleted from", async () => {
    const owner = await signIn("owner");
    const otherEvent = await createEvent(ids.orgA, `other-${suffix}`);
    const guest = await prisma.rSVP.create({ data: { eventId: ids.eventA, attendeeKey: `guest:${email("undo")}`, guestEmail: email("undo"), guestName: "Undo", status: RsvpStatus.WAITLISTED } });
    const deleted = await deleteGuest(new Request("https://yuyu.test/x", { method: "DELETE", headers: { authorization: `Bearer ${owner.accessToken}` } }), params({ orgSlug: slugs.orgA, eventId: ids.eventA, rsvpId: guest.id }));
    const { undoId } = (await deleted.json()).data as { undoId: string };
    expect((await restoreGuest(post("/x", { undoId }, owner.accessToken), params({ orgSlug: slugs.orgA, eventId: otherEvent }))).status).toBe(404);
    await expect(prisma.rSVP.findUnique({ where: { id: guest.id } })).resolves.toBeNull();
    expect((await restoreGuest(post("/x", { undoId }, owner.accessToken), params({ orgSlug: slugs.orgA, eventId: ids.eventA }))).status).toBe(200);
    await expect(prisma.rSVP.count({ where: { eventId: ids.eventA, guestEmail: email("undo") } })).resolves.toBe(1);
  });
});
