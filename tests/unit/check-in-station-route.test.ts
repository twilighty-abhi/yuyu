import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  eventFind: vi.fn(),
  rsvpFindFirst: vi.fn(),
  rsvpFindUnique: vi.fn(),
  rsvpFindMany: vi.fn(),
  updateMany: vi.fn(),
  checkInEventCreate: vi.fn(),
  transaction: vi.fn(),
  rateLimit: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: {
  event: { findFirst: mocks.eventFind },
  rSVP: { findFirst: mocks.rsvpFindFirst, findUnique: mocks.rsvpFindUnique, findMany: mocks.rsvpFindMany },
  checkInEvent: { create: mocks.checkInEventCreate },
  $transaction: mocks.transaction,
} }));
vi.mock("@/lib/rateLimit", () => ({
  getClientIpFromHeaders: () => "203.0.113.9",
  checkRateLimitById: mocks.rateLimit,
}));
vi.mock("@/lib/checkInStation", () => ({
  CHECK_IN_STATION_COOKIE: "station-proof",
  createCheckInStationProof: () => "proof",
  hasValidCheckInStationProof: () => true,
  stationExpiresAt: () => new Date("2035-01-01T13:00:00.000Z"),
  verifyStationPin: vi.fn().mockResolvedValue(true),
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: "proof" }) }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { POST } from "@/app/api/check-in/station/route";

const event = {
  id: "event_1",
  title: "Production event",
  slug: "event",
  organisationId: "org_1",
  startDateTime: new Date("2035-01-01T10:00:00.000Z"),
  endDateTime: new Date("2035-01-01T12:00:00.000Z"),
  checkInStationPinHash: "hash",
  checkInStationSecretVersion: 2,
  organisation: { slug: "org", name: "Org", logoUrl: null },
};

const rsvp = {
  id: "rsvp_1",
  eventId: "event_1",
  status: "CONFIRMED",
  checkedInAt: null,
  checkInToken: "opaque-token-123",
  guestName: "Guest",
  guestEmail: "guest@example.test",
  user: null,
  answers: [],
};

function request(action: string, extra: Record<string, unknown> = {}) {
  return new Request("https://events.example.test/api/check-in/station", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ organisationSlug: "org", eventSlug: "event", action, ...extra }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.eventFind.mockResolvedValue(event);
  mocks.rsvpFindFirst.mockResolvedValue(rsvp);
  mocks.rateLimit.mockResolvedValue(true);
  mocks.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback({
    rSVP: { updateMany: mocks.updateMany, findUnique: mocks.rsvpFindUnique },
    checkInEvent: { create: mocks.checkInEventCreate },
  }));
});

describe("venue check-in station route", () => {
  it("rejects action-specific payloads before querying attendee data", async () => {
    const response = await POST(request("lookup"));
    expect(response.status).toBe(400);
    expect(mocks.eventFind).not.toHaveBeenCalled();
  });

  it("does not record a false undo when the attendee is already unchecked", async () => {
    mocks.updateMany.mockResolvedValue({ count: 0 });
    const response = await POST(request("undo", { rsvpId: rsvp.id }));
    expect(response.status).toBe(409);
    expect(mocks.checkInEventCreate).not.toHaveBeenCalled();
  });

  it("cannot check in an attendee whose status changes after preview", async () => {
    mocks.updateMany.mockResolvedValue({ count: 0 });
    mocks.rsvpFindUnique.mockResolvedValue({ status: "REJECTED", checkedInAt: null });
    const response = await POST(request("checkInRsvp", { rsvpId: rsvp.id }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ ok: false, error: "This registration was rejected." });
    expect(mocks.checkInEventCreate).not.toHaveBeenCalled();
  });

  it("shows the attendance confirmation reply in previews and lookups, never the note", async () => {
    mocks.rsvpFindFirst.mockResolvedValue({ ...rsvp, attendanceCheck: { response: "NOT_ATTENDING" } });
    const preview = await POST(request("previewRsvp", { rsvpId: rsvp.id }));
    expect(await preview.json()).toMatchObject({ ok: true, data: { attendance: "notComing" } });
    expect(mocks.rsvpFindFirst.mock.calls[0]![0].include.attendanceCheck).toEqual({ select: { response: true } });

    mocks.rsvpFindMany.mockResolvedValue([{ ...rsvp, team: null, attendanceCheck: null }, { ...rsvp, id: "rsvp_2", team: null, attendanceCheck: { response: null } }]);
    const lookup = await POST(request("lookup", { query: "guest" }));
    const body = await lookup.json();
    expect(body.data.rows.map((row: { attendance: unknown }) => row.attendance)).toEqual([null, "noReply"]);
  });

  it("makes eligibility part of the atomic check-in write", async () => {
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.checkInEventCreate.mockResolvedValue({ id: "history_1" });
    const response = await POST(request("checkInRsvp", { rsvpId: rsvp.id }));
    expect(response.status).toBe(200);
    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: rsvp.id,
        checkedInAt: null,
        status: { in: ["CONFIRMED"] },
      }),
    }));
    expect(mocks.checkInEventCreate).toHaveBeenCalledTimes(1);
  });

  it("pages Recent check-ins for this station's event only, newest first", async () => {
    const at = new Date("2035-01-01T11:00:00.000Z");
    mocks.rsvpFindMany.mockResolvedValue([{ id: "rsvp_2", checkedInAt: at, guestName: "Grace", guestEmail: "grace@example.test", user: null }]);
    const response = await POST(request("recent", { cursor: `${at.getTime() + 1000}.rsvp_9` }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, data: { rows: [{ rsvpId: "rsvp_2", displayName: "Grace", email: "grace@example.test", checkedInAt: at.toISOString() }], nextCursor: null } });
    expect(mocks.rsvpFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ eventId: "event_1", checkedInAt: { not: null } }),
      orderBy: [{ checkedInAt: "desc" }, { id: "desc" }],
      take: 26,
    }));
    // Names, emails and times only: never the ticket token.
    expect(mocks.rsvpFindMany.mock.calls[0]![0].select).not.toHaveProperty("checkInToken");
  });

  it("answers a malformed Recent check-ins cursor with an empty page", async () => {
    const response = await POST(request("recent", { cursor: "not-a-cursor" }));
    expect(await response.json()).toEqual({ ok: true, data: { rows: [], nextCursor: null } });
    expect(mocks.rsvpFindMany).not.toHaveBeenCalled();
  });
});
