import { describe, expect, it } from "vitest";
import { decodeCursor, encodeCursor } from "@/lib/api/v1/pagination";
import { collectionQuerySchema, emptyQuerySchema, eventDtoSchema, participantCollectionQuerySchema, participantDtoSchema } from "@/lib/api/v1/schemas";

describe("API v1 contracts", () => {
  it("round-trips a versioned cursor and rejects malformed cursors", () => {
    const value = encodeCursor(new Date("2030-01-01T00:00:00.000Z"), "item_1");
    expect(decodeCursor(value)).toEqual({ v: 1, timestamp: "2030-01-01T00:00:00.000Z", id: "item_1" });
    expect(decodeCursor("not-a-cursor")).toBeNull();
  });

  it("rejects accidental fields in event and participant DTOs", () => {
    const event = {
      id: "event_1", title: "Event", slug: "event", description: "", tags: [], coverImageUrl: null,
      startDateTime: "2030-01-01T00:00:00.000Z", endDateTime: "2030-01-01T01:00:00.000Z", timezone: "UTC",
      location: "", mapLinkUrl: null, isOnline: false, capacity: null, status: "PUBLISHED", privacyType: "PUBLIC",
      createdAt: "2029-01-01T00:00:00.000Z", organisationId: "must-not-leak",
    };
    expect(eventDtoSchema.safeParse(event).success).toBe(false);
    expect(participantDtoSchema.safeParse({ id: "rsvp_1", displayName: "Ada", registeredAt: "2030-01-01T00:00:00.000Z", email: "private@example.test" }).success).toBe(false);
  });

  it("rejects caller-supplied organisation IDs and unknown query parameters", () => {
    expect(collectionQuerySchema.safeParse({ organisationId: "other-org" }).success).toBe(false);
    expect(emptyQuerySchema.safeParse({ organisationId: "other-org" }).success).toBe(false);
    expect(emptyQuerySchema.safeParse({}).success).toBe(true);
  });

  it("validates attendance filters and the opt-in attendance field", () => {
    expect(participantCollectionQuerySchema.parse({})).toMatchObject({ limit: 50, attendance: "all" });
    expect(participantCollectionQuerySchema.parse({ attendance: "checked_in", include: "attendance" })).toMatchObject({ attendance: "checked_in", include: "attendance" });
    expect(participantCollectionQuerySchema.safeParse({ attendance: "late" }).success).toBe(false);
    expect(participantCollectionQuerySchema.safeParse({ include: "email" }).success).toBe(false);
  });
});
