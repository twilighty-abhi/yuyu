import { describe, expect, it } from "vitest";
import { eventPhase, readinessHeading, readinessItems, signupTrend, type ReadinessInput } from "@/components/event-dashboard/overview/readiness";
import { eventCapabilities } from "@/lib/eventDashboard/capabilities";
import { busiestDay, capacityStatus, funnelSentence, funnelSteps, percentOf, signupsLastWeek, signupTimeline } from "@/components/event-dashboard/analytics/metrics";

const DAY = 86_400_000;
const admin = eventCapabilities("ADMIN", []);
const base: ReadinessInput = {
  published: true,
  hasCoverImage: true,
  hasAccent: false,
  isOnline: false,
  sessionCount: 4,
  registrationFieldCount: 2,
  stationPinSet: true,
  approvalRequired: false,
  pendingApprovals: 0,
  emailsSent: 1,
  permissions: admin,
};

describe("readinessItems", () => {
  it("marks everything done for a fully prepared event", () => {
    const items = readinessItems(base);
    expect(items.map((item) => item.key)).toEqual(["published", "look", "programme", "form", "pin", "email"]);
    expect(items.every((item) => item.done)).toBe(true);
    expect(items.find((item) => item.key === "programme")?.label).toBe("Programme · 4 sessions");
  });

  it("turns missing pieces into actions", () => {
    const items = readinessItems({ ...base, published: false, hasCoverImage: false, sessionCount: 0, registrationFieldCount: 0, stationPinSet: false, pendingApprovals: 3, emailsSent: 0 });
    const byKey = Object.fromEntries(items.map((item) => [item.key, item]));
    expect(byKey.published?.action).toEqual({ kind: "publish", label: "Publish" });
    expect(byKey.look?.action).toMatchObject({ tab: "page", sub: "details" });
    expect(byKey.programme?.action).toMatchObject({ tab: "page", sub: "page" });
    // Name and email are always collected, so a form without extra questions is not a to-do.
    expect(byKey.form).toMatchObject({ done: true });
    expect(byKey.pin?.action).toMatchObject({ tab: "check-in" });
    expect(byKey.approvals).toMatchObject({ label: "3 waiting for approval", done: false, action: { tab: "guests", sub: "people" } });
    expect(byKey.email?.action).toMatchObject({ tab: "emails" });
  });

  it("counts an accent colour as a finished look and skips the PIN for online events", () => {
    const items = readinessItems({ ...base, hasCoverImage: false, hasAccent: true, isOnline: true });
    expect(items.find((item) => item.key === "look")).toMatchObject({ label: "Page accent colour", done: true });
    expect(items.some((item) => item.key === "pin")).toBe(false);
  });

  it("shows approvals as done only when approval is required", () => {
    expect(readinessItems(base).some((item) => item.key === "approvals")).toBe(false);
    expect(readinessItems({ ...base, approvalRequired: true }).find((item) => item.key === "approvals")?.done).toBe(true);
  });

  it("shows collaborators only what they can act on", () => {
    const items = readinessItems({ ...base, permissions: eventCapabilities(null, ["PUBLISH_AND_SCHEDULE"]), pendingApprovals: 5 });
    expect(items.map((item) => item.key)).toEqual(["programme"]);
    expect(readinessItems({ ...base, permissions: eventCapabilities("MEMBER", []) })).toEqual([]);
    expect(readinessItems({ ...base, permissions: eventCapabilities(null, ["CHECK_IN", "EDIT_DETAILS", "MANAGE_INVITATIONS"]) })).toEqual([]);
  });

  it("never offers publishing to a collaborator, even with every grant", () => {
    const all = eventCapabilities(null, ["EDIT_DETAILS", "MANAGE_REGISTRATIONS", "MANAGE_INVITATIONS", "CHECK_IN", "PUBLISH_AND_SCHEDULE"]);
    const items = readinessItems({ ...base, published: false, pendingApprovals: 2, emailsSent: 0, permissions: all });
    expect(items.map((item) => item.key)).toEqual(["programme", "approvals"]);
    expect(items.some((item) => item.action?.kind === "publish")).toBe(false);
  });
});

describe("readinessHeading", () => {
  const now = new Date("2026-10-14T06:00:00Z");
  const tomorrow = new Date("2026-10-15T13:00:00Z");
  const later = new Date(tomorrow.getTime() + 3 * 3_600_000);

  it("names a near day and counts what is left", () => {
    const items = readinessItems({ ...base, emailsSent: 0, stationPinSet: false });
    const heading = readinessHeading({ items, start: tomorrow, end: later, now, timeZone: "Asia/Kolkata" });
    expect(heading.title).toBe("Almost ready for tomorrow");
    expect(heading.summary).toBe("4 of 6 done. 2 things left · starts tomorrow.");
    expect(heading.complete).toBe(false);
  });

  it("says ready when complete, and stays generic for distant dates", () => {
    const items = readinessItems(base);
    const far = new Date(now.getTime() + 20 * DAY);
    const heading = readinessHeading({ items, start: far, end: new Date(far.getTime() + 3_600_000), now, timeZone: "UTC" });
    expect(heading.title).toBe("Ready");
    expect(heading.complete).toBe(true);
  });

  it("reports a live event as happening now", () => {
    expect(readinessHeading({ items: readinessItems(base), start: new Date(now.getTime() - 1000), end: later, now, timeZone: "UTC" }).title).toBe("Happening now");
  });
});

describe("eventPhase", () => {
  it("classifies upcoming, live and ended", () => {
    const now = new Date("2026-10-14T12:00:00Z");
    expect(eventPhase(new Date("2026-10-15T00:00:00Z"), new Date("2026-10-15T02:00:00Z"), now)).toBe("upcoming");
    expect(eventPhase(new Date("2026-10-14T11:00:00Z"), new Date("2026-10-14T13:00:00Z"), now)).toBe("live");
    expect(eventPhase(new Date("2026-10-13T11:00:00Z"), new Date("2026-10-13T13:00:00Z"), now)).toBe("ended");
  });
});

describe("signupTrend", () => {
  it("counts rolling days and compares the two weeks", () => {
    const now = new Date("2026-10-14T12:00:00Z");
    const dates = [
      new Date(now.getTime() - 1000), // last day
      new Date(now.getTime() - 2000),
      new Date(now.getTime() - 3 * DAY), // this week
      new Date(now.getTime() - 10 * DAY), // the week before
      new Date(now.getTime() - 20 * DAY), // outside the window
    ];
    const trend = signupTrend(dates, now);
    expect(trend.counts).toHaveLength(14);
    expect(trend.lastDay).toBe(2);
    expect(trend.total).toBe(4);
    expect(trend.change).toBe("+200% on the week before");
    expect(trend.levels[13]).toBe(6);
  });

  it("has no change hint when nothing happened", () => {
    expect(signupTrend([], new Date()).change).toBeNull();
  });
});

describe("percentOf", () => {
  it("rounds to a whole percentage and is null for an empty whole", () => {
    expect(percentOf(62, 80)).toBe(78);
    expect(percentOf(3, 0)).toBeNull();
  });
});

describe("funnelSteps", () => {
  it("shows after-the-event steps as pending before the event ends", () => {
    const steps = funnelSteps({ responded: 44, going: 34, checkedIn: 0, feedback: 0, ended: false });
    expect(steps.map((step) => step.value)).toEqual([44, 34, null, null]);
    expect(steps[0]).toMatchObject({ share: 1, percent: null });
    expect(steps[1]).toMatchObject({ percent: 77, of: "responses" });
    expect(steps[1]!.share).toBeCloseTo(34 / 44);
    expect(steps[2]).toMatchObject({ percent: null, share: 0 });
  });

  it("uses real zeros once the event has ended", () => {
    const steps = funnelSteps({ responded: 10, going: 8, checkedIn: 6, feedback: 0, ended: true });
    expect(steps.map((step) => step.value)).toEqual([10, 8, 6, 0]);
    expect(steps[2]).toMatchObject({ percent: 75, of: "going" });
    expect(steps[3]).toMatchObject({ percent: 0, of: "checked in" });
  });

  it("never shows a share over 100% — feedback can outnumber check-ins", () => {
    const steps = funnelSteps({ responded: 54, going: 5, checkedIn: 2, feedback: 15, ended: true });
    expect(steps[1]).toMatchObject({ value: 5, percent: 9, of: "responses", note: null });
    expect(steps[2]).toMatchObject({ value: 2, percent: 40, of: "going" });
    expect(steps[3]).toMatchObject({ value: 15, percent: null, of: null, note: "includes people who didn't check in" });
  });

  it("caps bar length at everyone who responded", () => {
    const steps = funnelSteps({ responded: 4, going: 4, checkedIn: 4, feedback: 9, ended: true });
    expect(steps[3]!.share).toBe(1);
  });

  it("shows check-ins already recorded during a live event", () => {
    const steps = funnelSteps({ responded: 10, going: 8, checkedIn: 3, feedback: 0, ended: false });
    expect(steps[2]?.value).toBe(3);
    expect(steps[3]?.value).toBeNull();
  });
});

describe("funnelSentence", () => {
  it("reads the live funnel in plain words", () => {
    expect(funnelSentence({ responded: 80, going: 62, checkedIn: null, ended: false })).toBe("Of 80 responses, 62 are going.");
    expect(funnelSentence({ responded: 1, going: 1, checkedIn: null, ended: false })).toBe("Of 1 response, 1 is going.");
  });

  it("adds turnout once people check in", () => {
    expect(funnelSentence({ responded: 80, going: 62, checkedIn: 40, ended: true })).toBe("Of 80 responses, 62 had places and 40 checked in (65% turnout).");
    expect(funnelSentence({ responded: 5, going: 2, checkedIn: 3, ended: true })).toBe("Of 5 responses, 2 had places and 3 checked in.");
  });
});

describe("capacityStatus", () => {
  it("is null without a limit", () => {
    expect(capacityStatus(10, null)).toBeNull();
  });

  it("reports places left and fullness", () => {
    expect(capacityStatus(30, 40)).toEqual({ left: 10, percent: 75, full: false });
    expect(capacityStatus(45, 40)).toEqual({ left: 0, percent: 100, full: true });
  });
});

describe("signupTimeline", () => {
  const until = new Date("2026-10-14T12:00:00Z");

  it("is null without sign-ups", () => {
    expect(signupTimeline([], until, "UTC")).toBeNull();
  });

  it("uses one column per calendar day and ends on today", () => {
    const timeline = signupTimeline([new Date("2026-10-12T23:00:00Z"), new Date("2026-10-14T01:00:00Z"), until], until, "UTC")!;
    expect(timeline.intervalDays).toBe(1);
    expect(timeline.columns).toEqual([
      { label: "12 Oct", count: 1 },
      { label: "13 Oct", count: 0 },
      { label: "14 Oct", count: 2 },
    ]);
    expect(timeline).toMatchObject({ total: 3, largest: 2, spanDays: 3 });
  });

  it("buckets by the event's timezone", () => {
    // 20:00 UTC on 13 Oct is 01:30 on 14 Oct in Kolkata.
    const timeline = signupTimeline([new Date("2026-10-13T20:00:00Z")], until, "Asia/Kolkata")!;
    expect(timeline.columns).toEqual([{ label: "14 Oct", count: 1 }]);
  });

  it("groups days to stay within the column limit", () => {
    const dates = Array.from({ length: 60 }, (_, index) => new Date(until.getTime() - index * DAY));
    const timeline = signupTimeline(dates, until, "UTC", 14)!;
    expect(timeline.columns.length).toBeLessThanOrEqual(14);
    expect(timeline.intervalDays).toBe(5);
    expect(timeline.columns.at(-1)!.label).toBe("10 Oct – 14 Oct");
    expect(timeline.columns.reduce((sum, column) => sum + column.count, 0)).toBe(60);
  });

  it("ignores sign-ups after the cut-off", () => {
    const timeline = signupTimeline([until, new Date(until.getTime() + DAY)], until, "UTC")!;
    expect(timeline.total).toBe(1);
  });
});

describe("signupsLastWeek", () => {
  it("counts the seven calendar days up to today", () => {
    const until = new Date("2026-10-14T12:00:00Z");
    const dates = [new Date("2026-10-08T00:30:00Z"), new Date("2026-10-07T23:30:00Z"), until, new Date("2026-10-15T00:00:00Z")];
    expect(signupsLastWeek(dates, until, "UTC")).toBe(2);
  });
});

describe("busiestDay", () => {
  it("groups by calendar day in the event's timezone", () => {
    // 20:00 UTC on 13 Oct is 01:30 on 14 Oct in Kolkata.
    const dates = [new Date("2026-10-13T20:00:00Z"), new Date("2026-10-14T05:00:00Z"), new Date("2026-10-13T08:00:00Z")];
    expect(busiestDay(dates, "Asia/Kolkata")).toEqual({ day: "14 Oct 2026", count: 2 });
    expect(busiestDay(dates, "UTC")).toEqual({ day: "13 Oct 2026", count: 2 });
  });

  it("is null without dates", () => {
    expect(busiestDay([], "UTC")).toBeNull();
  });
});
