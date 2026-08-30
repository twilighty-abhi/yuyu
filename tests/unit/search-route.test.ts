import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ findMany: vi.fn() }));

vi.mock("@/lib/db", () => ({ prisma: { event: { findMany: mocks.findMany } } }));

import { GET } from "@/app/api/search/route";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("public search API", () => {
  it("returns an explicit public DTO and never serializes event secrets", async () => {
    mocks.findMany.mockResolvedValue([{
      id: "event_1",
      organisationId: "org_private_id",
      title: "Public event",
      slug: "public-event",
      description: "Description",
      tags: ["community"],
      coverImageUrl: null,
      startDateTime: new Date("2026-09-01T09:00:00.000Z"),
      endDateTime: new Date("2026-09-01T10:00:00.000Z"),
      timezone: "UTC",
      location: "Town Hall",
      mapLinkUrl: null,
      isOnline: false,
      checkInStationPinHash: "sensitive-hash",
      checkInStationPinEncrypted: "sensitive-ciphertext",
      checkInStationSecretVersion: 7,
      organisation: { slug: "public-org", name: "Public Org" },
    }]);

    const response = await GET(new Request("https://events.example.test/api/search?q=public"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.events).toEqual([{
      id: "event_1",
      title: "Public event",
      slug: "public-event",
      description: "Description",
      tags: ["community"],
      coverImageUrl: null,
      startDateTime: "2026-09-01T09:00:00.000Z",
      endDateTime: "2026-09-01T10:00:00.000Z",
      timezone: "UTC",
      location: "Town Hall",
      mapLinkUrl: null,
      isOnline: false,
      organisation: { slug: "public-org", name: "Public Org" },
    }]);
    expect(JSON.stringify(body)).not.toContain("sensitive-hash");
    expect(JSON.stringify(body)).not.toContain("sensitive-ciphertext");

    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ page: { is: { isPublished: true } } }),
      select: expect.objectContaining({
        id: true,
        title: true,
        organisation: { select: { slug: true, name: true } },
      }),
    }));
  });
});
