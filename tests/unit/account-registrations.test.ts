import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rsvps: vi.fn(),
  queryRaw: vi.fn(),
  responses: vi.fn(),
  responseCount: vi.fn(),
  user: vi.fn(),
  eventInvites: vi.fn(),
  seriesInvites: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: {
  $queryRaw: mocks.queryRaw,
  rSVP: { findMany: mocks.rsvps },
  eventFeedbackResponse: { findMany: mocks.responses, count: mocks.responseCount },
  user: { findUnique: mocks.user },
  eventInvite: { findMany: mocks.eventInvites },
  seriesInvite: { findMany: mocks.seriesInvites },
} }));

import { Prisma } from "@prisma/client";
import {
  ACCOUNT_REGISTRATIONS_LIMIT,
  MAX_ACCOUNT_PAGE,
  accountPageParam,
  accountSectionHref,
  accountSectionPagination,
  canCancelRegistration,
  isEventPageReachable,
  loadAccountRegistrations,
  registrationStatus,
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

describe("section paging helpers", () => {
  it("reads a page number from the URL and ignores anything malformed", () => {
    expect(accountPageParam(undefined)).toBe(1);
    expect(accountPageParam("3")).toBe(3);
    expect(accountPageParam(["4", "9"])).toBe(4);
    for (const bad of ["", "0", "-2", "1.5", "abc", "2e3", "99999"]) expect(accountPageParam(bad), bad).toBe(1);
    expect(accountPageParam(String(MAX_ACCOUNT_PAGE))).toBe(MAX_ACCOUNT_PAGE);
  });

  it("clamps a page past the end and keeps an empty section on page 1", () => {
    expect(accountSectionPagination(1, 0, 50)).toEqual({ page: 1, totalPages: 1, total: 0, pageSize: 50 });
    expect(accountSectionPagination(2, 101, 50)).toEqual({ page: 2, totalPages: 3, total: 101, pageSize: 50 });
    expect(accountSectionPagination(9, 101, 50)).toMatchObject({ page: 3, totalPages: 3 });
  });

  it("links a section page while keeping the other sections' pages", () => {
    const pages = { upcoming: 1, past: 2, certificates: 1 };
    expect(accountSectionHref(pages, "upcoming", 3)).toBe("/account/registrations?upcoming=3&past=2#upcoming");
    expect(accountSectionHref(pages, "past", 1)).toBe("/account/registrations#past");
    expect(accountSectionHref(pages, "certificates", 2)).toBe("/account/registrations?past=2&certificates=2#certificates");
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

type RawCall = { sql: string; values: unknown[] };

/** The SQL text and bound values of each `$queryRaw` call. */
function rawCalls(): RawCall[] {
  return mocks.queryRaw.mock.calls.map(([strings, ...values]) => {
    const sql = Prisma.sql(strings as TemplateStringsArray, ...(values as Prisma.Sql[]));
    return { sql: sql.sql, values: sql.values };
  });
}

/** Serve each section from `sections` like the database would: count, then one page of ids. */
function serveSections(sections: { upcoming: Array<{ id: string }>; past: Array<{ id: string }> }) {
  const all = [...sections.upcoming, ...sections.past];
  mocks.queryRaw.mockImplementation(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const sql = Prisma.sql(strings, ...(values as Prisma.Sql[]));
    const rows = sql.sql.includes(">=") ? sections.upcoming : sections.past;
    if (sql.sql.includes("count(*)")) return [{ count: BigInt(rows.length) }];
    const [limit, offset] = sql.values.slice(-2) as [number, number];
    return rows.slice(offset, offset + limit).map((row) => ({ id: row.id }));
  });
  mocks.rsvps.mockImplementation(async (args: { where: { id: { in: string[] } } }) => all.filter((row) => args.where.id.in.includes(row.id)));
}

describe("account registrations loader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    serveSections({ upcoming: [], past: [] });
    mocks.responses.mockResolvedValue([]);
    mocks.responseCount.mockResolvedValue(0);
    mocks.user.mockResolvedValue({ email: "ada@example.test", emailVerified: now });
    mocks.eventInvites.mockResolvedValue([]);
    mocks.seriesInvites.mockResolvedValue([]);
  });

  it("queries only the given user's RSVPs and certificates, one bounded page each", async () => {
    serveSections({ upcoming: Array.from({ length: 120 }, (_, n) => ({ id: `u${n}` })), past: [] });
    const { pagination } = await loadAccountRegistrations("user_1", now, { upcoming: 2 });

    const calls = rawCalls();
    expect(calls).toHaveLength(3); // two counts, one page (the empty past section reads no ids)
    for (const call of calls) {
      expect(call.values).toContain("user_1");
      expect(call.sql).toContain(`r."userId" =`);
      expect(call.sql).not.toMatch(/email/i);
    }
    const page = calls.find((call) => call.sql.includes("LIMIT"));
    expect(page?.values.slice(-2)).toEqual([ACCOUNT_REGISTRATIONS_LIMIT, ACCOUNT_REGISTRATIONS_LIMIT]);
    expect(page?.sql).toMatch(/ORDER BY COALESCE\(e\."startDateTime", i\."startDateTime"\) ASC, r\."id" ASC/);
    for (const [args] of mocks.rsvps.mock.calls) expect(args.where.userId).toBe("user_1");
    expect(pagination.upcoming).toEqual({ page: 2, totalPages: 3, total: 120, pageSize: ACCOUNT_REGISTRATIONS_LIMIT });
    expect(pagination.past).toMatchObject({ page: 1, totalPages: 1, total: 0 });

    const [countArgs] = mocks.responseCount.mock.calls[0];
    expect(countArgs.where.rsvp.is.userId).toBe("user_1");
    expect(countArgs.where.rsvp.is.status).toBe("CONFIRMED");
    expect(mocks.responses).not.toHaveBeenCalled();
  });

  it("orders Past most recent first and clamps a page past the end", async () => {
    serveSections({ upcoming: [], past: [{ id: "p1" }] });
    const { pagination } = await loadAccountRegistrations("user_1", now, { past: 7 });
    const page = rawCalls().find((call) => call.sql.includes("LIMIT"));
    expect(page?.sql).toContain(`COALESCE(e."startDateTime", i."startDateTime") DESC, r."id" ASC`);
    expect(page?.values.slice(-2)).toEqual([ACCOUNT_REGISTRATIONS_LIMIT, 0]);
    expect(pagination.past).toMatchObject({ page: 1, totalPages: 1, total: 1 });
  });

  it("pages certificates with a separate count", async () => {
    mocks.responseCount.mockResolvedValue(51);
    await loadAccountRegistrations("user_1", now, { certificates: 2 });
    const [args] = mocks.responses.mock.calls[0];
    expect(args.where.rsvp.is.userId).toBe("user_1");
    expect(args).toMatchObject({ skip: 50, take: 50, orderBy: [{ submittedAt: "desc" }, { id: "asc" }] });
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
    serveSections({
      upcoming: [
        { id: "r1", status: "CONFIRMED", checkedInAt: null, checkInToken: "tok_confirmed_1", event: event("e1", "2030-06-20T10:00:00Z", "2030-06-20T12:00:00Z"), eventInstance: null },
        { id: "r2", status: "REJECTED", checkedInAt: null, checkInToken: "tok_rejected_2", event: event("e2", "2030-06-21T10:00:00Z", "2030-06-21T12:00:00Z"), eventInstance: null },
      ] as never,
      past: [],
    });

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
    serveSections({
      upcoming: [
        { id: "r1", status: "CONFIRMED", checkedInAt: null, checkInToken: "tok_lead_1", team: { id: "t1", name: "Owls", leaderRsvpId: "r1" }, event, eventInstance: null },
        { id: "r2", status: "CONFIRMED", checkedInAt: null, checkInToken: "tok_member_2", team: { id: "t2", name: "Larks", leaderRsvpId: "someone" }, event, eventInstance: null },
      ] as never,
      past: [],
    });

    const { upcoming } = await loadAccountRegistrations("user_1", now);

    expect(upcoming[0]?.team).toEqual({ name: "Owls", isLeader: true, manageHref: "/account/teams/t1" });
    expect(upcoming[1]?.team).toEqual({ name: "Larks", isLeader: false, manageHref: null });
  });
});
