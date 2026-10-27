import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  count: vi.fn(),
  groupBy: vi.fn(),
  checkFindFirst: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    rSVP: { findMany: mocks.findMany, count: mocks.count, groupBy: mocks.groupBy },
    attendanceCheck: { findFirst: mocks.checkFindFirst },
  },
}));

import {
  ATTENDEE_ATTENDANCE_FILTERS,
  attendanceBadgeState,
  attendanceCsvCells,
  attendeeAttendanceWhere,
  attendeeBaseWhere,
} from "@/lib/attendeeListQuery";
import { buildCsv } from "@/lib/csv";
import { sanitizeViewParams, viewParamsFromSearchParams } from "@/lib/savedViews";
import { listAttendeesPage } from "@/lib/eventDashboard/attendees";

const eventScope = { kind: "event" as const, eventId: "event_1", organisationId: "org_1" };
const instanceScope = { kind: "instance" as const, eventInstanceId: "inst_1", organisationId: "org_1" };
const plainView = { query: "", kind: "all" as const, team: "all" as const };

describe("Guests · People attendance filter", () => {
  it("maps each reply filter to a server-side RSVP condition", () => {
    expect(attendeeAttendanceWhere("all")).toEqual({});
    expect(attendeeAttendanceWhere("coming")).toEqual({ attendanceCheck: { is: { response: "ATTENDING" } } });
    expect(attendeeAttendanceWhere("notComing")).toEqual({ attendanceCheck: { is: { response: "NOT_ATTENDING" } } });
    // Waiting for a reply and never asked only describe going guests, like the Emails card.
    expect(attendeeAttendanceWhere("noReply")).toEqual({ status: "CONFIRMED", attendanceCheck: { is: { response: null } } });
    expect(attendeeAttendanceWhere("notAsked")).toEqual({ status: "CONFIRMED", attendanceCheck: { is: null } });
  });

  it("adds the filter to a one-off event's base condition, inside the scope", () => {
    const where = attendeeBaseWhere(eventScope, { ...plainView, attendance: "notComing" }, { teamMode: false });
    expect(where).toEqual({
      AND: [
        { eventId: "event_1", event: { organisationId: "org_1" } },
        { attendanceCheck: { is: { response: "NOT_ATTENDING" } } },
      ],
    });
    expect(attendeeBaseWhere(eventScope, { ...plainView, attendance: "all" }, { teamMode: false })).toEqual({ AND: [{ eventId: "event_1", event: { organisationId: "org_1" } }] });
  });

  it("ignores the filter on a series occurrence, which is never asked", () => {
    const where = attendeeBaseWhere(instanceScope, { ...plainView, attendance: "coming" }, { teamMode: false });
    expect(JSON.stringify(where)).not.toContain("attendanceCheck");
  });

  it("is a saved-view allow-listed parameter with defaults dropped", () => {
    expect(sanitizeViewParams("GUESTS_PEOPLE", { attendance: "noReply" })).toEqual({ attendance: "noReply" });
    expect(sanitizeViewParams("GUESTS_PEOPLE", { attendance: "all" })).toEqual({});
    expect(sanitizeViewParams("GUESTS_PEOPLE", { attendance: "maybe" })).toEqual({});
    expect(sanitizeViewParams("GUESTS_TEAMS", { attendance: "coming" })).toEqual({});
    expect(viewParamsFromSearchParams("GUESTS_PEOPLE", new URLSearchParams("attendance=coming&status=going"))).toEqual({ attendance: "coming", status: "going" });
    for (const filter of ATTENDEE_ATTENDANCE_FILTERS) {
      expect(sanitizeViewParams("GUESTS_PEOPLE", { attendance: filter })).toEqual(filter === "all" ? {} : { attendance: filter });
    }
  });
});

describe("attendance badge and CSV cells", () => {
  it("labels asked guests by their reply whatever their status", () => {
    expect(attendanceBadgeState({ status: "CONFIRMED", attendanceCheck: { response: "ATTENDING" } })).toBe("coming");
    expect(attendanceBadgeState({ status: "CONFIRMED", attendanceCheck: { response: "NOT_ATTENDING" } })).toBe("notComing");
    expect(attendanceBadgeState({ status: "CONFIRMED", attendanceCheck: { response: null } })).toBe("noReply");
    expect(attendanceBadgeState({ status: "REJECTED", attendanceCheck: { response: "NOT_ATTENDING" } })).toBe("notComing");
  });

  it("says Not asked only for going guests, and only when asked to", () => {
    expect(attendanceBadgeState({ status: "CONFIRMED", attendanceCheck: null })).toBe("notAsked");
    expect(attendanceBadgeState({ status: "CONFIRMED", attendanceCheck: null }, { showNotAsked: false })).toBeNull();
    for (const status of ["WAITLISTED", "PENDING_APPROVAL", "REJECTED"]) {
      expect(attendanceBadgeState({ status, attendanceCheck: null })).toBeNull();
    }
  });

  it("writes the reply label and note, with formula-like notes neutralised by the CSV writer", () => {
    expect(attendanceCsvCells({ status: "CONFIRMED", attendanceCheck: { response: "ATTENDING", note: null } })).toEqual(["Coming", ""]);
    expect(attendanceCsvCells({ status: "CONFIRMED", attendanceCheck: null })).toEqual(["Not asked", ""]);
    expect(attendanceCsvCells({ status: "WAITLISTED", attendanceCheck: null })).toEqual(["", ""]);
    expect(attendanceCsvCells({ status: "CONFIRMED", attendanceCheck: null }, { showNotAsked: false })).toEqual(["", ""]);
    const cells = attendanceCsvCells({ status: "CONFIRMED", attendanceCheck: { response: "NOT_ATTENDING", note: "@SUM(A1), sorry" } });
    expect(cells).toEqual(["Not coming", "@SUM(A1), sorry"]);
    expect(buildCsv([cells])).toBe(`Not coming,"'@SUM(A1), sorry"`);
    expect(buildCsv([attendanceCsvCells({ status: "CONFIRMED", attendanceCheck: { response: null, note: " =1+1" } })])).toBe("No reply,' =1+1");
  });
});

function record(id: string, status: string, attendanceCheck: { response: "ATTENDING" | "NOT_ATTENDING" | null; respondedAt: Date | null; note: string | null } | null) {
  return {
    id,
    status,
    createdAt: new Date("2030-01-01T00:00:00Z"),
    guestEmail: `${id}@example.test`,
    guestName: id,
    user: null,
    checkedInAt: null,
    checkInToken: `token-${id}`,
    checkInListRecords: [],
    team: null,
    answers: [],
    attendanceCheck,
  };
}

describe("Guests · People loader with attendance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.groupBy.mockResolvedValue([{ status: "CONFIRMED", _count: { _all: 3 } }]);
    mocks.count.mockResolvedValue(1);
  });

  it("carries the badge and note, selects no token hash, and counts replies once someone was asked", async () => {
    mocks.checkFindFirst.mockResolvedValue({ id: "check_1" });
    mocks.findMany.mockResolvedValue([
      record("a", "CONFIRMED", { response: "NOT_ATTENDING", respondedAt: new Date("2030-01-02T00:00:00Z"), note: "Ill" }),
      record("b", "CONFIRMED", null),
      record("c", "WAITLISTED", null),
    ]);

    const page = await listAttendeesPage(eventScope, { attendance: "all" }, { origin: "https://events.example.test", teamMode: false });

    expect(page.rows.map((row) => row.attendance)).toEqual([
      { state: "notComing", note: "Ill", respondedAt: "2030-01-02T00:00:00.000Z" },
      { state: "notAsked", note: null, respondedAt: null },
      { state: null, note: null, respondedAt: null },
    ]);
    expect(mocks.findMany.mock.calls[0]![0].include.attendanceCheck).toEqual({ select: { response: true, respondedAt: true, note: true } });
    expect(page.attendanceCounts).toEqual({ all: 1, coming: 1, notComing: 1, noReply: 1, notAsked: 1 });
    expect(mocks.checkFindFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { eventId: "event_1", event: { organisationId: "org_1" } } }));
  });

  it("hides Not asked and the reply counts before anyone has been asked", async () => {
    mocks.checkFindFirst.mockResolvedValue(null);
    mocks.findMany.mockResolvedValue([record("b", "CONFIRMED", null)]);

    const page = await listAttendeesPage(eventScope, {}, { origin: "https://events.example.test", teamMode: false });

    expect(page.rows[0]!.attendance.state).toBeNull();
    expect(page.attendanceCounts).toBeNull();
  });

  it("filters on the server and never asks about a series occurrence", async () => {
    mocks.checkFindFirst.mockResolvedValue({ id: "check_1" });
    mocks.findMany.mockResolvedValue([]);
    await listAttendeesPage(eventScope, { attendance: "noReply", status: "going" }, { origin: "https://events.example.test", teamMode: false });
    expect(JSON.stringify(mocks.findMany.mock.calls[0]![0].where)).toContain('"attendanceCheck":{"is":{"response":null}}');

    vi.clearAllMocks();
    mocks.groupBy.mockResolvedValue([]);
    mocks.count.mockResolvedValue(0);
    mocks.findMany.mockResolvedValue([]);
    const page = await listAttendeesPage(instanceScope, { attendance: "coming" }, { origin: "https://events.example.test", teamMode: false });
    expect(mocks.checkFindFirst).not.toHaveBeenCalled();
    expect(page.attendanceCounts).toBeNull();
    expect(JSON.stringify(mocks.findMany.mock.calls[0]![0].where)).not.toContain('"response"');
  });

  it("rejects an unknown attendance filter with an empty page", async () => {
    const page = await listAttendeesPage(eventScope, { attendance: "maybe" }, { origin: "https://events.example.test", teamMode: false });
    expect(page).toEqual({ rows: [], nextCursor: null, counts: null, total: null, matching: null, attendanceCounts: null });
    expect(mocks.findMany).not.toHaveBeenCalled();
  });
});
