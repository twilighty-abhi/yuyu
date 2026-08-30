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
});
