import { describe, expect, it } from "vitest";
import { EventPrivacyType, RsvpStatus } from "@prisma/client";
import { decideRsvpStatus } from "@/lib/rsvpCore";

describe("RSVP admission status", () => {
  it("never bypasses approval merely because capacity is currently full", () => {
    expect(decideRsvpStatus({ capacity: 1, confirmedCount: 1, privacyType: EventPrivacyType.APPROVAL_REQUIRED }))
      .toBe(RsvpStatus.PENDING_APPROVAL);
  });

  it("waitlists full non-approval events", () => {
    expect(decideRsvpStatus({ capacity: 1, confirmedCount: 1, privacyType: EventPrivacyType.PUBLIC }))
      .toBe(RsvpStatus.WAITLISTED);
  });
});
