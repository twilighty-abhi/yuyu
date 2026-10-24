import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rsvps: vi.fn(),
  responses: vi.fn(),
  user: vi.fn(),
  eventInvites: vi.fn(),
  seriesInvites: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: {
  rSVP: { findMany: mocks.rsvps },
  eventFeedbackResponse: { findMany: mocks.responses },
  user: { findUnique: mocks.user },
  eventInvite: { findMany: mocks.eventInvites },
  seriesInvite: { findMany: mocks.seriesInvites },
} }));

import {
  ACCOUNT_REGISTRATIONS_LIMIT,
  canCancelRegistration,
  isEventPageReachable,
  loadAccountRegistrations,
  registrationStatus,
  splitRegistrations,
} from "@/lib/accountRegistrations";

const now = new Date("2030-06-15T12:00:00.000Z");
const at = (iso: string) => new Date(iso);

describe("registration status labels", () => {
  it("maps every RSVP status to an attendee-facing label", () => {
    expect(registrationStatus("CONFIRMED", null)).toEqual({ label: "Confirmed", tone: "success" });
    expect(registrationStatus("WAITLISTED", null)).toEqual({ label: "Waitlisted", tone: "warning" });
    expect(registrationStatus("PENDING_APPROVAL", null)).toEqual({ label: "Waiting for approval", tone: "warning" });
    expect(registrationStatus("REJECTED", null)).toEqual({ label: "Declined", tone: "danger" });
  });

  it("shows a check-in ahead of the RSVP status", () => {
    expect(registrationStatus("CONFIRMED", now).label).toBe("Checked in");
  });
});

describe("upcoming and past split", () => {
  const rows = [
    { id: "past-old", start: at("2030-01-01T10:00:00Z"), end: at("2030-01-01T12:00:00Z") },
    { id: "later", start: at("2030-08-01T10:00:00Z"), end: at("2030-08-01T12:00:00Z") },
    { id: "ongoing", start: at("2030-06-15T11:00:00Z"), end: at("2030-06-15T13:00:00Z") },
    { id: "past-recent", start: at("2030-06-10T10:00:00Z"), end: at("2030-06-10T12:00:00Z") },
    { id: "soon", start: at("2030-06-20T10:00:00Z"), end: at("2030-06-20T12:00:00Z") },
  ];

  it("splits by end time, soonest upcoming first and most recent past first", () => {
    const { upcoming, past } = splitRegistrations(rows, now);
    expect(upcoming.map((row) => row.id)).toEqual(["ongoing", "soon", "later"]);
    expect(past.map((row) => row.id)).toEqual(["past-recent", "past-old"]);
  });

  it("caps each section", () => {
    const { upcoming, past } = splitRegistrations(rows, now, 1);
    expect(upcoming.map((row) => row.id)).toEqual(["ongoing"]);
    expect(past.map((row) => row.id)).toEqual(["past-recent"]);
  });
});

describe("cancellation and event-page rules", () => {
  const future = at("2030-07-01T00:00:00Z");
  it("offers cancellation only for upcoming, unchecked, non-declined registrations", () => {
    expect(canCancelRegistration({ status: "CONFIRMED", checkedInAt: null, end: future }, now)).toBe(true);
    expect(canCancelRegistration({ status: "WAITLISTED", checkedInAt: null, end: future }, now)).toBe(true);
    expect(canCancelRegistration({ status: "PENDING_APPROVAL", checkedInAt: null, end: future }, now)).toBe(true);
    expect(canCancelRegistration({ status: "REJECTED", checkedInAt: null, end: future }, now)).toBe(false);
    expect(canCancelRegistration({ status: "CONFIRMED", checkedInAt: now, end: future }, now)).toBe(false);
    expect(canCancelRegistration({ status: "CONFIRMED", checkedInAt: null, end: at("2030-06-01T00:00:00Z") }, now)).toBe(false);
  });

  it("links an event page only when an attendee could open it", () => {
    const base = { status: "PUBLISHED", privacyType: "PUBLIC", websiteReleased: true, invited: false } as const;
    expect(isEventPageReachable(base)).toBe(true);
    expect(isEventPageReachable({ ...base, status: "DRAFT" })).toBe(false);
    expect(isEventPageReachable({ ...base, status: "CANCELLED" })).toBe(false);
    expect(isEventPageReachable({ ...base, websiteReleased: false })).toBe(false);
    expect(isEventPageReachable({ ...base, privacyType: "HIDDEN_LINK" })).toBe(true);
    expect(isEventPageReachable({ ...base, privacyType: "INVITE_ONLY" })).toBe(false);
    expect(isEventPageReachable({ ...base, privacyType: "INVITE_ONLY", invited: true })).toBe(true);
  });
});

describe("account registrations loader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rsvps.mockResolvedValue([]);
    mocks.responses.mockResolvedValue([]);
    mocks.user.mockResolvedValue({ email: "ada@example.test", emailVerified: now });
    mocks.eventInvites.mockResolvedValue([]);
    mocks.seriesInvites.mockResolvedValue([]);
  });

  it("queries only the given user's RSVPs and certificates, each bounded", async () => {
    await loadAccountRegistrations("user_1", now);

    expect(mocks.rsvps).toHaveBeenCalledTimes(4);
    for (const [args] of mocks.rsvps.mock.calls) {
      expect(args.where.userId).toBe("user_1");
      expect(JSON.stringify(args.where)).not.toMatch(/email/i);
      expect(args.take).toBe(ACCOUNT_REGISTRATIONS_LIMIT);
    }
    const [certificateArgs] = mocks.responses.mock.calls[0];
    expect(certificateArgs.where.rsvp.is.userId).toBe("user_1");
    expect(certificateArgs.where.rsvp.is.status).toBe("CONFIRMED");
    expect(certificateArgs.take).toBeGreaterThan(0);
  });

  it("builds rows with ticket and cancel affordances, without exposing declined tokens", async () => {
    const event = (id: string, start: string, end: string) => ({
      id,
      title: `Event ${id}`,
      slug: `event-${id}`,
      startDateTime: at(start),
      endDateTime: at(end),
      timezone: "Asia/Kolkata",
      location: "Hall A",
      isOnline: false,
      status: "PUBLISHED",
      privacyType: "PUBLIC",
      page: { isPublished: true },
      organisation: { name: "Org", slug: "org" },
    });
    mocks.rsvps
      .mockResolvedValueOnce([
        { id: "r1", status: "CONFIRMED", checkedInAt: null, checkInToken: "tok_confirmed_1", event: event("e1", "2030-06-20T10:00:00Z", "2030-06-20T12:00:00Z"), eventInstance: null },
        { id: "r2", status: "REJECTED", checkedInAt: null, checkInToken: "tok_rejected_2", event: event("e2", "2030-06-21T10:00:00Z", "2030-06-21T12:00:00Z"), eventInstance: null },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const { upcoming, past } = await loadAccountRegistrations("user_1", now);

    expect(past).toEqual([]);
    expect(upcoming.map((row) => row.id)).toEqual(["r1", "r2"]);
    expect(upcoming[0]).toMatchObject({ ticketHref: "/ticket/tok_confirmed_1", cancelToken: "tok_confirmed_1", eventHref: "/org/event-e1", status: { label: "Confirmed" } });
    expect(upcoming[1]).toMatchObject({ ticketHref: null, cancelToken: null, status: { label: "Declined" } });
    expect(JSON.stringify(upcoming[1])).not.toContain("tok_rejected_2");
    expect(mocks.eventInvites).not.toHaveBeenCalled();
  });

  it("names the team and links only its leader to the signed-in team page", async () => {
    const event = {
      id: "e1",
      title: "Jam",
      slug: "jam",
      startDateTime: at("2030-06-20T10:00:00Z"),
      endDateTime: at("2030-06-20T12:00:00Z"),
      timezone: "Asia/Kolkata",
      location: "",
      isOnline: true,
      status: "PUBLISHED",
      privacyType: "PUBLIC",
      page: { isPublished: true },
      organisation: { name: "Org", slug: "org" },
    };
    mocks.rsvps
      .mockResolvedValueOnce([
        { id: "r1", status: "CONFIRMED", checkedInAt: null, checkInToken: "tok_lead_1", team: { id: "t1", name: "Owls", leaderRsvpId: "r1" }, event, eventInstance: null },
        { id: "r2", status: "CONFIRMED", checkedInAt: null, checkInToken: "tok_member_2", team: { id: "t2", name: "Larks", leaderRsvpId: "someone" }, event, eventInstance: null },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const { upcoming } = await loadAccountRegistrations("user_1", now);

    expect(upcoming[0]?.team).toEqual({ name: "Owls", isLeader: true, manageHref: "/account/teams/t1" });
    expect(upcoming[1]?.team).toEqual({ name: "Larks", isLeader: false, manageHref: null });
  });
});
