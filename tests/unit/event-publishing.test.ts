import { describe, expect, it } from "vitest";
import { EventPrivacyType, EventStatus } from "@prisma/client";
import { audienceFromPrivacy, closingSummary, formatLead, leadToParts, privacyFromAudience, publishingSummary } from "@/components/event/publishing";
import { isDiscoverableEvent, shouldIndexPublicEvent } from "@/lib/eventVisibility";

describe("event publishing helpers", () => {
  it("shows a lead time in the largest whole unit", () => {
    expect(leadToParts(90)).toEqual({ amount: 90, unit: "minutes" });
    expect(leadToParts(120)).toEqual({ amount: 2, unit: "hours" });
    expect(leadToParts(2880)).toEqual({ amount: 2, unit: "days" });
    expect(leadToParts(0)).toEqual({ amount: 0, unit: "minutes" });
    expect(formatLead(60)).toBe("1 hour");
    expect(formatLead(1440)).toBe("1 day");
  });

  it("explains each closing rule against the edited start time", () => {
    const base = { start: "2035-10-14T09:30", closesAt: "", leadMinutes: null, timeZone: "Asia/Kolkata" };
    expect(closingSummary({ ...base, mode: "end" }).long).toBe("Sign-ups stay open until the event ends.");
    const before = closingSummary({ ...base, mode: "before", leadMinutes: 120 });
    expect(before.long).toBe("Sign-ups close 2 hours before the start: Sun 14 Oct, 7:30 am (Kolkata time). Moves with the start time.");
    expect(before.short).toBe("closes 2 hours before");
    expect(closingSummary({ ...base, mode: "before" }).problem).toMatch(/how long/);
    expect(closingSummary({ ...base, mode: "at", closesAt: "2035-10-13T18:00" })).toMatchObject({ short: "closes Sat 13 Oct, 6:00 pm" });
    expect(closingSummary({ ...base, mode: "at", closesAt: "2035-10-14T10:00" }).problem).toMatch(/on or before the start/);
    expect(closingSummary({ ...base, mode: "at" }).problem).toMatch(/Choose/);
    // Just after midnight reads "12:15 am" on every ICU build, never "0:15 am".
    expect(closingSummary({ ...base, mode: "at", closesAt: "2035-10-13T00:15" }).short).toBe("closes Sat 13 Oct, 12:15 am");
  });

  it("sums up what guests experience", () => {
    expect(publishingSummary({ status: "DRAFT", privacyType: "PUBLIC", capacity: null, closing: "" }).headline).toBe("Draft.");
    expect(publishingSummary({ status: "PUBLISHED", privacyType: "HIDDEN_LINK", capacity: 120, closing: "closes 2 hours before" })).toEqual({
      headline: "Live.",
      detail: "Link only, anyone can sign up · 120 spots · closes 2 hours before.",
    });
    expect(publishingSummary({ status: "PUBLISHED", privacyType: "APPROVAL_REQUIRED", listedPublicly: true, capacity: null, closing: "open until it ends" }).detail).toBe(
      "Listed publicly, you approve each sign-up · unlimited spots · open until it ends.",
    );
  });

  it("maps who-can-find × approval to the stored mode, both ways", () => {
    const cases = [
      [{ reach: "listed", approve: false }, { privacyType: "PUBLIC", listedPublicly: false }],
      [{ reach: "listed", approve: true }, { privacyType: "APPROVAL_REQUIRED", listedPublicly: true }],
      [{ reach: "link", approve: false }, { privacyType: "HIDDEN_LINK", listedPublicly: false }],
      [{ reach: "link", approve: true }, { privacyType: "APPROVAL_REQUIRED", listedPublicly: false }],
      [{ reach: "invite", approve: false }, { privacyType: "INVITE_ONLY", listedPublicly: false }],
    ] as const;
    for (const [audience, stored] of cases) {
      expect(privacyFromAudience(audience)).toEqual(stored);
      expect(audienceFromPrivacy(stored.privacyType, stored.listedPublicly)).toEqual(audience);
    }
    // Invite only never asks for approval or lists, whatever the switch says.
    expect(privacyFromAudience({ reach: "invite", approve: true })).toEqual({ privacyType: "INVITE_ONLY", listedPublicly: false });
  });
});

describe("public listing rule", () => {
  it("lists public events and approval events only when listing is on", () => {
    const P = EventStatus.PUBLISHED;
    expect(isDiscoverableEvent(P, EventPrivacyType.PUBLIC)).toBe(true);
    expect(isDiscoverableEvent(P, EventPrivacyType.APPROVAL_REQUIRED)).toBe(false);
    expect(isDiscoverableEvent(P, EventPrivacyType.APPROVAL_REQUIRED, true)).toBe(true);
    expect(shouldIndexPublicEvent(P, EventPrivacyType.APPROVAL_REQUIRED, true)).toBe(true);
    // The flag never lists link-only or invite-only events, or unpublished ones.
    expect(isDiscoverableEvent(P, EventPrivacyType.HIDDEN_LINK, true)).toBe(false);
    expect(isDiscoverableEvent(P, EventPrivacyType.INVITE_ONLY, true)).toBe(false);
    expect(isDiscoverableEvent(EventStatus.DRAFT, EventPrivacyType.APPROVAL_REQUIRED, true)).toBe(false);
  });
});
