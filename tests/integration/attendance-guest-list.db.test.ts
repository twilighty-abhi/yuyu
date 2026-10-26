import { createHash, randomUUID } from "node:crypto";
import { AttendanceResponse, EventPermission, EventPrivacyType, EventStatus, MembershipRole, RsvpStatus, type Event } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock("@/lib/auth", () => ({ auth: async () => (session.userId ? { user: { id: session.userId } } : null) }));
vi.mock("@/lib/actionRateLimit", () => ({ isActionRateLimited: async () => false }));
vi.mock("@/lib/audit", () => ({ recordAuditEvent: async () => undefined }));
vi.mock("@/lib/publicUrl", () => ({ getRequestOrigin: async () => "https://events.example.test" }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { prisma } from "@/lib/db";
import { listAttendeesPage } from "@/lib/eventDashboard/attendees";
import { loadAttendeesPage } from "@/app/actions/guest-list";
import { downloadOfflineCheckInRosterForUser, lookupAttendeesForCheckInForUser, previewCheckInByRsvpIdForUser } from "@/lib/core/checkin";
import { buildAccountDataExport, loadAccountExportSource } from "@/lib/accountDataExport";
import { GET as exportAttendees } from "@/app/api/exports/events/[eventId]/attendees/route";

/*
 * Attendance confirmation in Guests · People, the attendee CSV, the check-in
 * desk and the personal data export: server-side filters and counts agree
 * with the stored replies, nothing leaks across events, and the check's
 * token hash never leaves the database.
 */

const suffix = randomUUID().replaceAll("-", "");
const orgSlug = `attend-list-${suffix}`;
let organisationId = "";
let adminId = "";
let guestUserId = "";
let checkInHelperId = "";
let event: Event;
let otherEvent: Event;
const rsvpIds: Record<string, string> = {};
const tokenHashes: string[] = [];

async function createEvent(title: string) {
  return prisma.event.create({ data: {
    organisationId,
    title,
    slug: `attend-${suffix}-${randomUUID().slice(0, 8)}`,
    startDateTime: new Date("2035-01-01T10:00:00.000Z"),
    endDateTime: new Date("2035-01-01T12:00:00.000Z"),
    timezone: "UTC",
    status: EventStatus.PUBLISHED,
    privacyType: EventPrivacyType.PUBLIC,
    page: { create: { isPublished: true } },
  } });
}

async function addGuest(target: Event, name: string, status: RsvpStatus, userId: string | null = null) {
  const email = `${name.toLowerCase()}-${suffix}@example.test`;
  const rsvp = await prisma.rSVP.create({ data: {
    eventId: target.id,
    guestName: userId ? null : name,
    guestEmail: userId ? null : email,
    userId,
    attendeeKey: userId ? `user:${userId}` : `guest:${email}`,
    status,
  } });
  return rsvp.id;
}

async function ask(rsvpId: string, eventId: string, response: AttendanceResponse | null, note: string | null = null) {
  const tokenHash = createHash("sha256").update(randomUUID()).digest("hex");
  tokenHashes.push(tokenHash);
  await prisma.attendanceCheck.create({ data: {
    rsvpId,
    eventId,
    tokenHash,
    sentAt: new Date("2034-12-30T09:00:00.000Z"),
    response,
    respondedAt: response ? new Date("2034-12-30T10:00:00.000Z") : null,
    note,
  } });
}

beforeAll(async () => {
  const org = await prisma.organisation.create({ data: { name: `Attend ${suffix}`, slug: orgSlug } });
  organisationId = org.id;
  const [admin, guestUser, helper] = await Promise.all(
    ["admin", "guest-user", "checkin-helper"].map((label) => prisma.user.create({ data: { name: `Attend ${label}`, email: `${label}-${suffix}@example.test` } })),
  );
  adminId = admin!.id;
  guestUserId = guestUser!.id;
  checkInHelperId = helper!.id;
  await prisma.membership.create({ data: { userId: adminId, organisationId, role: MembershipRole.ADMIN } });

  event = await createEvent(`Attend ${suffix}`);
  otherEvent = await createEvent(`Attend other ${suffix}`);
  await prisma.eventCollaborator.create({ data: { eventId: event.id, userId: checkInHelperId, permissions: [EventPermission.CHECK_IN] } });

  rsvpIds.coming = await addGuest(event, "Coming", RsvpStatus.CONFIRMED, guestUserId);
  rsvpIds.declined = await addGuest(event, "Declined", RsvpStatus.CONFIRMED);
  rsvpIds.silent = await addGuest(event, "Silent", RsvpStatus.CONFIRMED);
  rsvpIds.unasked = await addGuest(event, "Unasked", RsvpStatus.CONFIRMED);
  rsvpIds.waiting = await addGuest(event, "Waiting", RsvpStatus.WAITLISTED);
  rsvpIds.elsewhere = await addGuest(otherEvent, "Elsewhere", RsvpStatus.CONFIRMED);
  await ask(rsvpIds.coming, event.id, AttendanceResponse.ATTENDING, "See you there");
  await ask(rsvpIds.declined, event.id, AttendanceResponse.NOT_ATTENDING, "=1+1 cannot come");
  await ask(rsvpIds.silent, event.id, null);
  await ask(rsvpIds.elsewhere, otherEvent.id, AttendanceResponse.NOT_ATTENDING);
});

afterAll(async () => {
  session.userId = null;
  if (organisationId) await prisma.organisation.delete({ where: { id: organisationId } });
  await prisma.user.deleteMany({ where: { email: { endsWith: `-${suffix}@example.test` } } });
});

const scope = () => ({ kind: "event" as const, eventId: event.id, organisationId });
const options = { origin: "https://events.example.test", teamMode: false };

describe("Guests · People attendance filter", () => {
  it("counts and filters replies on the server, inside the event", async () => {
    const page = await listAttendeesPage(scope(), {}, options);
    expect(page.attendanceCounts).toEqual({ all: 5, coming: 1, notComing: 1, noReply: 1, notAsked: 1 });
    const byId = new Map(page.rows.map((row) => [row.id, row.attendance]));
    expect(byId.get(rsvpIds.coming)).toMatchObject({ state: "coming", note: "See you there" });
    expect(byId.get(rsvpIds.declined)).toMatchObject({ state: "notComing", note: "=1+1 cannot come" });
    expect(byId.get(rsvpIds.silent)).toMatchObject({ state: "noReply", note: null });
    expect(byId.get(rsvpIds.unasked)).toMatchObject({ state: "notAsked" });
    expect(byId.get(rsvpIds.waiting)).toMatchObject({ state: null });
    expect(JSON.stringify(page)).not.toContain(tokenHashes[0]!);

    for (const [filter, expected] of [["coming", "coming"], ["notComing", "declined"], ["noReply", "silent"], ["notAsked", "unasked"]] as const) {
      const filtered = await listAttendeesPage(scope(), { attendance: filter }, options);
      expect(filtered.rows.map((row) => row.id)).toEqual([rsvpIds[expected]]);
      // The status chips describe the attendance filter too.
      expect(filtered.counts?.all).toBe(1);
    }
    // The attendance counts follow the status chip.
    const waitlisted = await listAttendeesPage(scope(), { status: "waitlist" }, options);
    expect(waitlisted.attendanceCounts).toEqual({ all: 1, coming: 0, notComing: 0, noReply: 0, notAsked: 0 });
  });

  it("keeps the filter behind the registration-manager check in the paging action", async () => {
    session.userId = adminId;
    const ok = await loadAttendeesPage({ organisationSlug: orgSlug, eventId: event.id, attendance: "notComing" });
    expect(ok.ok && ok.data?.rows.map((row) => row.id)).toEqual([rsvpIds.declined]);
    expect(await loadAttendeesPage({ organisationSlug: orgSlug, eventId: event.id, attendance: "maybe" })).toMatchObject({ ok: false });
    session.userId = checkInHelperId;
    expect(await loadAttendeesPage({ organisationSlug: orgSlug, eventId: event.id, attendance: "coming" })).toMatchObject({ ok: false });
    session.userId = null;
  });
});

describe("attendee CSV attendance columns", () => {
  it("ends each row with the reply and a formula-safe note, and filters by reply", async () => {
    session.userId = adminId;
    const response = await exportAttendees(new Request(`https://events.example.test/api/exports/events/${event.id}/attendees`), { params: Promise.resolve({ eventId: event.id }) });
    const text = (await response.text()).replace(/^﻿/, "");
    const [header, ...rows] = text.split("\n").filter(Boolean);
    expect(header!.endsWith(",Attendance confirmation,Attendance note")).toBe(true);
    expect(rows.find((row) => row.startsWith("Declined,"))!.endsWith(",Not coming,'=1+1 cannot come")).toBe(true);
    expect(rows.find((row) => row.startsWith("Unasked,"))!.endsWith(",Not asked,")).toBe(true);
    expect(rows.find((row) => row.startsWith("Waiting,"))!.endsWith(",,")).toBe(true);
    expect(rows.some((row) => row.startsWith("Elsewhere,"))).toBe(false);
    for (const hash of tokenHashes) expect(text).not.toContain(hash);

    const filtered = await exportAttendees(new Request(`https://events.example.test/api/exports/events/${event.id}/attendees?attendance=noReply`), { params: Promise.resolve({ eventId: event.id }) });
    const filteredRows = (await filtered.text()).replace(/^﻿/, "").split("\n").filter(Boolean).slice(1);
    expect(filteredRows).toHaveLength(1);
    expect(filteredRows[0]!.startsWith("Silent,")).toBe(true);
    session.userId = null;
  });
});

describe("check-in desk attendance badge", () => {
  it("shows the reply (never the note) in lookup, preview and the offline roster", async () => {
    const lookup = await lookupAttendeesForCheckInForUser(checkInHelperId, { organisationSlug: orgSlug, eventId: event.id, query: suffix.slice(0, 12) });
    expect(lookup.ok).toBe(true);
    const lookupRows = lookup.ok ? lookup.data!.rows : [];
    expect(new Map(lookupRows.map((row) => [row.rsvpId, row.attendance]))).toEqual(new Map([
      [rsvpIds.coming, "coming"],
      [rsvpIds.declined, "notComing"],
      [rsvpIds.silent, "noReply"],
      [rsvpIds.unasked, null],
      [rsvpIds.waiting, null],
    ]));

    const preview = await previewCheckInByRsvpIdForUser(checkInHelperId, { organisationSlug: orgSlug, eventId: event.id, rsvpId: rsvpIds.coming });
    expect(preview).toMatchObject({ ok: true, data: { attendance: "coming" } });

    const roster = await downloadOfflineCheckInRosterForUser(checkInHelperId, { organisationSlug: orgSlug, eventId: event.id });
    expect(roster.ok).toBe(true);
    const rosterRows = roster.ok ? roster.data!.rows : [];
    expect(new Map(rosterRows.map((row) => [row.rsvpId, row.attendance]))).toEqual(new Map([
      [rsvpIds.coming, "coming"],
      [rsvpIds.declined, "notComing"],
      [rsvpIds.silent, "noReply"],
      [rsvpIds.unasked, null],
      [rsvpIds.waiting, null],
    ]));
    expect(JSON.stringify(rosterRows)).not.toContain("cannot come");
  });
});

describe("personal data export", () => {
  it("includes the user's own reply and nothing else of the check", async () => {
    const source = await loadAccountExportSource(guestUserId);
    const data = buildAccountDataExport(source!);
    expect(data.registrations).toHaveLength(1);
    expect(data.registrations[0]!.attendanceConfirmation).toEqual({
      askedAt: "2034-12-30T09:00:00.000Z",
      response: "ATTENDING",
      respondedAt: "2034-12-30T10:00:00.000Z",
      note: "See you there",
    });
    for (const hash of tokenHashes) expect(JSON.stringify(data)).not.toContain(hash);
  });
});
