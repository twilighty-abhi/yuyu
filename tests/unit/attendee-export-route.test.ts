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
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/audit", () => ({ recordAuditEvent: mocks.audit }));
vi.mock("@/lib/db", () => ({ prisma: {
  event: { findUnique: mocks.event },
  rSVP: { findMany: mocks.rsvps },
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

    expect(header).toBe("Name,Email,Status,Registration Date,Checked In At,Ticket URL,Company,Check-in: Swag,Check-in: Lunch,Check-in: =Old (archived)");
    expect(row).toBe("Ada Lovelace,ada@example.test,CONFIRMED,2030-01-02T03:04:05.000Z,,https://events.example.test/ticket/secret-token,,,2030-01-03T12:00:00.000Z,");
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

  it("answers a malformed filter with the same empty 404, before reading the event", async () => {
    for (const query of ["status=everyone", "kind=robots", `q=${"x".repeat(101)}`]) {
      const response = await GET(new Request(`https://events.example.test/api/exports/events/event_1/attendees?${query}`), routeContext);
      expect(response.status).toBe(404);
      expect(await response.text()).toBe("");
    }
    expect(mocks.event).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });
});
