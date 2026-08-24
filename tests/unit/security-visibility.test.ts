import { describe, expect, it } from "vitest";
import { EventPrivacyType, EventStatus } from "@prisma/client";
import { isEventPublished, shouldIndexPublicEvent } from "@/lib/eventVisibility";
import { slugifyTitle, withSlugSuffix } from "@/lib/slug";
import { gateCheckInForStatus } from "@/lib/checkIn";

describe("public visibility and identifier utilities", () => {
  it("indexes only published public events", () => {
    expect(shouldIndexPublicEvent(EventStatus.PUBLISHED, EventPrivacyType.PUBLIC)).toBe(true);
    expect(shouldIndexPublicEvent(EventStatus.PUBLISHED, EventPrivacyType.HIDDEN_LINK)).toBe(false);
    expect(isEventPublished(EventStatus.DRAFT)).toBe(false);
  });
  it("creates bounded event slugs", () => {
    expect(slugifyTitle("  Hello, Secure World! ")).toBe("hello-secure-world");
    expect(withSlugSuffix("event", 3)).toBe("event-3");
  });
  it("blocks rejected check-ins and requires an override for waitlisted attendees", () => {
    expect(gateCheckInForStatus("REJECTED", false).ok).toBe(false);
    expect(gateCheckInForStatus("WAITLISTED", false)).toMatchObject({ ok: false, needsForce: true });
    expect(gateCheckInForStatus("WAITLISTED", true).ok).toBe(true);
  });
});
