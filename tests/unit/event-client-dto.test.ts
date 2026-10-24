import { describe, expect, it } from "vitest";
import { EventPrivacyType, EventStatus, JudgingStatus, RegistrationMode, SoloPolicy, type Event } from "@prisma/client";
import { toEventClientDto } from "@/lib/eventDto";

describe("event browser DTO", () => {
  it("never serializes station hashes, encrypted PINs, versions, or included relations", () => {
    const event = {
      id: "event_1",
      organisationId: "org_1",
      title: "Event",
      slug: "event",
      description: "Description",
      tags: [],
      showRegistrationCount: true,
      coverImageUrl: null,
      startDateTime: new Date("2035-01-01T10:00:00Z"),
      endDateTime: new Date("2035-01-01T12:00:00Z"),
      timezone: "UTC",
      location: "Venue",
      mapLinkUrl: null,
      isOnline: false,
      capacity: null,
      status: EventStatus.PUBLISHED,
      privacyType: EventPrivacyType.PUBLIC,
      listedPublicly: false,
      registrationClosesAt: null,
      registrationLeadMinutes: null,
      registrationManuallyClosedAt: new Date("2034-01-01T00:00:00Z"),
      registrationCutoffBeforeManualClose: null,
      registrationLeadBeforeManualClose: 90,
      registrationMode: RegistrationMode.INDIVIDUAL,
      teamMinSize: null,
      teamMaxSize: null,
      soloPolicy: SoloPolicy.SOLO_ALLOWED,
      submissionsEnabled: true,
      submissionsOpenAt: null,
      submissionsCloseAt: null,
      judgingStatus: JudgingStatus.OPEN,
      judgesSeeAll: false,
      projectGalleryPublic: false,
      resultsPublishedAt: null,
      resultsAnnouncedAt: new Date("2034-01-03T00:00:00Z"),
      shortCode: null,
      checkInStationPinHash: "bcrypt-secret",
      checkInStationPinEncrypted: "encrypted-secret",
      checkInStationSecretVersion: 7,
      createdAt: new Date("2034-01-01T00:00:00Z"),
      rsvps: [{ checkInToken: "ticket-secret" }],
    } as Event & { rsvps: Array<{ checkInToken: string }> };

    const serialized = JSON.stringify(toEventClientDto(event));
    expect(serialized).not.toContain("bcrypt-secret");
    expect(serialized).not.toContain("encrypted-secret");
    expect(serialized).not.toContain("ticket-secret");
    expect(serialized).not.toContain("checkInStation");
    expect(serialized).not.toContain("ManualClose");
    expect(serialized).not.toContain("registrationManuallyClosedAt");
    expect(serialized).not.toContain("judgingStatus");
    expect(serialized).not.toContain("judgesSeeAll");
    expect(serialized).not.toContain("resultsAnnouncedAt");
  });
});
