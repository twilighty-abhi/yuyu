import { describe, expect, it } from "vitest";
import {
  createEventSchema,
  deleteRsvpSchema,
  restoreRsvpSchema,
  rsvpGuestSchema,
} from "@/lib/validators";

describe("RSVP validation", () => {
  it("requires exactly one RSVP target when deleting", () => {
    const base = { organisationSlug: "demo", rsvpId: "rsvp_1" };

    expect(deleteRsvpSchema.safeParse({ ...base, eventId: "event_1" }).success).toBe(true);
    expect(deleteRsvpSchema.safeParse({ ...base, eventInstanceId: "instance_1" }).success).toBe(true);
    expect(deleteRsvpSchema.safeParse(base).success).toBe(false);
    expect(deleteRsvpSchema.safeParse({ ...base, eventId: "event_1", eventInstanceId: "instance_1" }).success).toBe(false);
  });

  it("does not accept client supplied RSVP data for undo", () => {
    expect(restoreRsvpSchema.safeParse({ organisationSlug: "demo", undoId: "undo_1" }).success).toBe(true);
    expect(restoreRsvpSchema.safeParse({ organisationSlug: "demo", rsvpId: "rsvp_1" }).success).toBe(false);
  });

  it("normalizes guest email input and requires an event target", () => {
    const result = rsvpGuestSchema.parse({
      orgSlug: "demo",
      eventSlug: "launch-night",
      guestEmail: "  guest@example.com ",
      name: "Jamie",
    });
    expect(result.guestEmail).toBe("guest@example.com");
    expect(rsvpGuestSchema.safeParse({ guestEmail: "guest@example.com", name: "Jamie", orgSlug: "demo" }).success).toBe(false);
  });
});

describe("event validation", () => {
  const baseEvent = {
    organisationSlug: "demo",
    title: "Launch night",
    startDateTime: "2026-10-01T18:00:00.000Z",
    endDateTime: "2026-10-01T20:00:00.000Z",
    timezone: "UTC",
    isOnline: false,
  };

  it("rejects an event that ends before it begins", () => {
    expect(createEventSchema.safeParse({ ...baseEvent, endDateTime: "2026-10-01T17:00:00.000Z" }).success).toBe(false);
  });

  it("deduplicates and normalizes event tags", () => {
    const result = createEventSchema.parse({ ...baseEvent, tags: " Design, design\nCommunity " });
    expect(result.tags).toEqual(["design", "community"]);
  });
});
