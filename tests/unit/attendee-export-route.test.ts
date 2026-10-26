import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  audit: vi.fn(),
  event: vi.fn(),
  rsvps: vi.fn(),
  collaborator: vi.fn(),
  membership: vi.fn(),
  isAdmin: vi.fn(),
  origin: vi.fn(),
  attendanceAsked: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/audit", () => ({ recordAuditEvent: mocks.audit }));
vi.mock("@/lib/db", () => ({ prisma: {
  event: { findUnique: mocks.event },
  rSVP: { findMany: mocks.rsvps },
  attendanceCheck: { findFirst: mocks.attendanceAsked },
  eventCollaborator: { findFirst: mocks.collaborator },
} }));
vi.mock("@/lib/permissions", () => ({ getMembership: mocks.membership, isOrgAdmin: mocks.isAdmin }));
vi.mock("@/lib/publicUrl", () => ({ getRequestOrigin: mocks.origin }));

import { GET } from "@/app/api/exports/events/[eventId]/attendees/route";

const routeContext = { params: Promise.resolve({ eventId: "event_1" }) };

describe("full attendee CSV export route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ user: { id: "user_1" } });
    mocks.event.mockResolvedValue({
      id: "event_1",
      title: "Test Event",
      organisationId: "org_1",
      registrationForm: { fields: [{ id: "field_1", label: "Company" }] },
      checkInLists: [],
    });
    mocks.membership.mockResolvedValue({ role: "ADMIN" });
    mocks.isAdmin.mockReturnValue(true);
    mocks.origin.mockResolvedValue("https://events.example.test");
    mocks.attendanceAsked.mockResolvedValue({ id: "check_1" });
    mocks.rsvps
      .mockResolvedValueOnce([{
        id: "rsvp_1",
        status: "CONFIRMED",
        guestName: "Ada Lovelace",
        guestEmail: "ada@example.test",
        createdAt: new Date("2030-01-02T03:04:05.000Z"),
        checkedInAt: null,
        checkInToken: "secret-token",
        user: null,
        answers: [{ fieldId: "field_1", valueText: "Analytical Engines", valueBool: null, valueNumber: null, valueDate: null }],
        checkInListRecords: [],
      }])
      .mockResolvedValueOnce([]);
  });

  it("does not disclose an attendee list to an unauthorized user", async () => {
    mocks.membership.mockResolvedValue({ role: "MEMBER" });
    mocks.isAdmin.mockReturnValue(false);
    mocks.collaborator.mockResolvedValue(null);

    const response = await GET(new Request("https://events.example.test/api/exports/events/event_1/attendees"), routeContext);

    expect(response.status).toBe(404);
    expect(mocks.rsvps).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("lets an organisation member who holds the MANAGE_REGISTRATIONS grant export", async () => {
    mocks.membership.mockResolvedValue({ role: "MEMBER" });
    mocks.isAdmin.mockReturnValue(false);
    mocks.collaborator.mockResolvedValue({ id: "grant_1" });

    const response = await GET(new Request("https://events.example.test/api/exports/events/event_1/attendees"), routeContext);

    expect(response.status).toBe(200);
    expect(mocks.collaborator).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ eventId: "event_1", permissions: { has: "MANAGE_REGISTRATIONS" } }) }));
  });

  it("returns an audited, private CSV containing every fetched page", async () => {
    const response = await GET(new Request("https://events.example.test/api/exports/events/event_1/attendees"), routeContext);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toMatch(/^attachment; filename="attendees_Test_Event_\d{4}-\d{2}-\d{2}\.csv"$/);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    await expect(response.text()).resolves.toContain("Ada Lovelace,ada@example.test,CONFIRMED,2030-01-02T03:04:05.000Z,,https://events.example.test/ticket/secret-token,Analytical Engines");
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "ATTENDEE_LIST_EXPORTED", organisationId: "org_1", targetId: "event_1" }));
    expect(mocks.rsvps).toHaveBeenCalledTimes(2);
  });

  it("adds one column per check-in list after the answers, with the time or blank", async () => {
    mocks.event.mockResolvedValue({
      id: "event_1",
      title: "Test Event",
      organisationId: "org_1",
      registrationForm: { fields: [{ id: "field_1", label: "Company" }] },
      checkInLists: [
        { id: "list_swag", name: "Swag", archived: false },
        { id: "list_lunch", name: "Lunch", archived: false },
        { id: "list_old", name: "=Old", archived: true },
      ],
    });
    mocks.rsvps.mockReset();
    mocks.rsvps
      .mockResolvedValueOnce([{
        id: "rsvp_1",
        status: "CONFIRMED",
        guestName: "Ada Lovelace",
        guestEmail: "ada@example.test",
        createdAt: new Date("2030-01-02T03:04:05.000Z"),
        checkedInAt: null,
        checkInToken: "secret-token",
        user: null,
        answers: [],
        checkInListRecords: [{ listId: "list_lunch", checkedInAt: new Date("2030-01-03T12:00:00.000Z") }],
      }])
      .mockResolvedValueOnce([]);

    const response = await GET(new Request("https://events.example.test/api/exports/events/event_1/attendees"), routeContext);
    const [header, row] = (await response.text()).replace(/^\uFEFF/, "").split("\n");

    expect(header).toBe("Name,Email,Status,Registration Date,Checked In At,Ticket URL,Company,Check-in: Swag,Check-in: Lunch,Check-in: =Old (archived),Attendance confirmation,Attendance note");
    expect(row).toBe("Ada Lovelace,ada@example.test,CONFIRMED,2030-01-02T03:04:05.000Z,,https://events.example.test/ticket/secret-token,,,2030-01-03T12:00:00.000Z,,Not asked,");
  });

  it("narrows the export to the People list's filters with the same columns, auditing filter names only", async () => {
    const unfiltered = await GET(new Request("https://events.example.test/api/exports/events/event_1/attendees"), routeContext);
    const unfilteredHeader = (await unfiltered.text()).replace(/^\uFEFF/, "").split("\n")[0];
    expect(mocks.rsvps.mock.calls[0]![0]).toMatchObject({ where: { eventId: "event_1" } });

    mocks.rsvps.mockReset();
    mocks.rsvps.mockResolvedValueOnce([]);
    const response = await GET(new Request("https://events.example.test/api/exports/events/event_1/attendees?status=waitlist&kind=guests&q=Ada%20Lovelace"), routeContext);
    expect(response.status).toBe(200);
    expect((await response.text()).replace(/^\uFEFF/, "").split("\n")[0]).toBe(unfilteredHeader);
    const where = JSON.stringify(mocks.rsvps.mock.calls[0]![0].where);
    expect(where).toContain('"status":"WAITLISTED"');
    expect(where).toContain('"userId":null');
    expect(where).toContain('"organisationId":"org_1"');
    expect(where).toContain("Ada Lovelace");
    expect(mocks.audit).toHaveBeenLastCalledWith(expect.objectContaining({ metadata: { surface: "people", filters: "status,kind,search" } }));
    expect(JSON.stringify(mocks.audit.mock.calls)).not.toContain("Ada");
  });

  it("ends every row with the attendance reply and a formula-safe note, reading no token hash", async () => {
    mocks.rsvps.mockReset();
    const base = { guestEmail: null, createdAt: new Date("2030-01-02T03:04:05.000Z"), checkedInAt: null, checkInToken: "t", user: null, answers: [], checkInListRecords: [] };
    mocks.rsvps
      .mockResolvedValueOnce([
        { ...base, id: "r1", status: "CONFIRMED", guestName: "Coming", attendanceCheck: { response: "ATTENDING", note: "" } },
        { ...base, id: "r2", status: "CONFIRMED", guestName: "Declined", attendanceCheck: { response: "NOT_ATTENDING", note: "=HYPERLINK(\"http://x\")" } },
        { ...base, id: "r3", status: "CONFIRMED", guestName: "Silent", attendanceCheck: { response: null, note: null } },
        { ...base, id: "r4", status: "CONFIRMED", guestName: "Unasked", attendanceCheck: null },
        { ...base, id: "r5", status: "WAITLISTED", guestName: "Waiting", attendanceCheck: null },
      ])
      .mockResolvedValueOnce([]);

    const response = await GET(new Request("https://events.example.test/api/exports/events/event_1/attendees"), routeContext);
    const lines = (await response.text()).replace(/^\uFEFF/, "").split("\n");

    expect(lines[0]!.endsWith(",Attendance confirmation,Attendance note")).toBe(true);
    expect(lines[1]!.endsWith(",Coming,")).toBe(true);
    expect(lines[2]!.endsWith(`,Not coming,"'=HYPERLINK(""http://x"")"`)).toBe(true);
    expect(lines[3]!.endsWith(",No reply,")).toBe(true);
    expect(lines[4]!.endsWith(",Not asked,")).toBe(true);
    expect(lines[5]!.endsWith(",,")).toBe(true);
    const include = mocks.rsvps.mock.calls[0]![0].include;
    expect(include.attendanceCheck).toEqual({ select: { response: true, note: true } });
  });

  it("leaves the reply blank for unasked guests while nobody at the event has been asked", async () => {
    mocks.attendanceAsked.mockResolvedValue(null);
    const response = await GET(new Request("https://events.example.test/api/exports/events/event_1/attendees"), routeContext);
    const [, row] = (await response.text()).replace(/^\uFEFF/, "").split("\n");
    expect(row!.endsWith(",Analytical Engines,,")).toBe(true);
    expect(mocks.attendanceAsked).toHaveBeenCalledWith({ where: { eventId: "event_1" }, select: { id: true } });
  });

  it("filters the export by the attendance reply and audits the filter name", async () => {
    mocks.rsvps.mockReset();
    mocks.rsvps.mockResolvedValueOnce([]);
    const response = await GET(new Request("https://events.example.test/api/exports/events/event_1/attendees?attendance=notComing"), routeContext);
    expect(response.status).toBe(200);
    await response.text();
    expect(JSON.stringify(mocks.rsvps.mock.calls[0]![0].where)).toContain('"attendanceCheck":{"is":{"response":"NOT_ATTENDING"}}');
    expect(mocks.audit).toHaveBeenLastCalledWith(expect.objectContaining({ metadata: { surface: "people", filters: "attendance" } }));
  });

  it("answers a malformed filter with the same empty 404, before reading the event", async () => {
    for (const query of ["status=everyone", "kind=robots", "attendance=maybe", `q=${"x".repeat(101)}`]) {
      const response = await GET(new Request(`https://events.example.test/api/exports/events/event_1/attendees?${query}`), routeContext);
      expect(response.status).toBe(404);
      expect(await response.text()).toBe("");
    }
    expect(mocks.event).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });
});
