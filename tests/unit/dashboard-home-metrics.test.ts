import { describe, expect, it } from "vitest";
import {
  dailyCounts,
  eventFillStatus,
  forwardDailyCounts,
  homeSummary,
  intervalCounts,
  monthGrid,
  monthKey,
  nowAndNext,
  parseMonth,
  relativeDayPhrase,
  shiftMonth,
  toDotLevels,
  turnout,
  weekOverWeek,
  windowCounts,
} from "@/lib/dashboardHomeMetrics";

const now = new Date("2026-10-14T06:00:00Z"); // 11:30 AM in Asia/Kolkata
const hours = (h: number) => new Date(now.getTime() + h * 3_600_000);

describe("dashboard home charts", () => {
  it("buckets the last seven rolling days, oldest first, ignoring the future and older dates", () => {
    expect(dailyCounts([hours(-1), hours(-2), hours(-25), hours(-24 * 6.5), hours(-24 * 8), hours(2)], now)).toEqual([1, 0, 0, 0, 0, 1, 2]);
  });

  it("buckets the next seven days, soonest first", () => {
    expect(forwardDailyCounts([hours(1), hours(30), hours(-1), hours(24 * 8)], now)).toEqual([1, 1, 0, 0, 0, 0, 0]);
  });

  it("buckets check-ins into fixed intervals", () => {
    const start = hours(-2);
    expect(intervalCounts([hours(-2), hours(-1.9), hours(-1.5), hours(1)], start, 15 * 60_000, 8)).toEqual([2, 0, 1, 0, 0, 0, 0, 0]);
  });

  it("scales counts to dot levels and keeps quiet days visible", () => {
    expect(toDotLevels([0, 1, 10, 5])).toEqual([0, 1, 4, 2]);
    expect(toDotLevels([0, 0])).toEqual([0, 0]);
  });

  it("describes week-over-week change only from real numbers", () => {
    expect(weekOverWeek(0, 0)).toBeNull();
    expect(weekOverWeek(4, 0)).toBe("New this week");
    expect(weekOverWeek(5, 5)).toBe("Same as last week");
    expect(weekOverWeek(12, 10)).toBe("+20% on last week");
    expect(weekOverWeek(5, 10)).toBe("-50% on last week");
    expect(weekOverWeek(3, 0, { previous: "the 30 days before", current: "this month" })).toBe("New this month");
    expect(weekOverWeek(6, 4, { previous: "the 30 days before", current: "this month" })).toBe("+50% on the 30 days before");
  });
});

describe("dashboard home event status", () => {
  it("puts approvals first, then full and waitlist, then going", () => {
    expect(eventFillStatus({ confirmed: 3, waitlisted: 0, pending: 2 }, 10)).toEqual({ label: "2 to approve", tone: "warning" });
    expect(eventFillStatus({ confirmed: 10, waitlisted: 6, pending: 0 }, 10)).toEqual({ label: "Full · 6 waiting", tone: "warning" });
    expect(eventFillStatus({ confirmed: 10, waitlisted: 0, pending: 0 }, 10)).toEqual({ label: "Full", tone: "warning" });
    expect(eventFillStatus({ confirmed: 7, waitlisted: 0, pending: 0 }, 10)).toEqual({ label: "7 / 10 going", tone: "success" });
    expect(eventFillStatus({ confirmed: 0, waitlisted: 0, pending: 0 }, null)).toEqual({ label: "0 going", tone: "neutral" });
  });

  it("compares team units, not people, with capacity on TEAM events", () => {
    // 6 people in 3 confirmed teams fill a capacity of 3 units.
    expect(eventFillStatus({ confirmed: 6, waitlisted: 0, pending: 0 }, 3, { used: 3, noun: "places" })).toEqual({ label: "Full", tone: "warning" });
    // 4 people in 2 teams are not over a capacity of 3.
    expect(eventFillStatus({ confirmed: 4, waitlisted: 0, pending: 0 }, 3, { used: 2, noun: "teams" })).toEqual({ label: "2 / 3 teams", tone: "success" });
    expect(eventFillStatus({ confirmed: 4, waitlisted: 0, pending: 0 }, null, { used: 2, noun: "places" })).toEqual({ label: "4 going", tone: "success" });
  });

  it("finds the session on stage now and next, honouring live delays", () => {
    const sessions = [
      { id: "a", title: "Keynote", startDateTime: hours(-1), endDateTime: hours(-0.25), delayMinutes: 30 },
      { id: "b", title: "Panel", startDateTime: hours(0.5), endDateTime: hours(1.5), delayMinutes: 0 },
    ];
    const stage = nowAndNext(sessions, now);
    expect(stage.now?.title).toBe("Keynote");
    expect(stage.next?.title).toBe("Panel");
    expect(nowAndNext([], now)).toEqual({ now: null, next: null });
  });
});

describe("dashboard home summary", () => {
  it("phrases days in the event's timezone", () => {
    expect(relativeDayPhrase(hours(2), "Asia/Kolkata", now)).toBe("today");
    expect(relativeDayPhrase(hours(24), "Asia/Kolkata", now)).toBe("tomorrow");
    expect(relativeDayPhrase(hours(24 * 5), "Asia/Kolkata", now)).toBe("in 5 days");
    expect(relativeDayPhrase(hours(24 * 30), "Asia/Kolkata", now)).toBe("on Fri 13 Nov");
  });

  it("builds one sentence from live, next and sign-up numbers", () => {
    const next = { title: "Demo Summit", startDateTime: hours(24), timezone: "Asia/Kolkata" };
    expect(homeSummary({ live: { title: "Meetup" }, next, signupsLastDay: 0, now })).toBe("Meetup is happening now.");
    expect(homeSummary({ live: null, next, signupsLastDay: 12, now })).toBe("Demo Summit is tomorrow, and 12 people signed up in the last day.");
    expect(homeSummary({ live: null, next, signupsLastDay: 1, now })).toBe("Demo Summit is tomorrow, and 1 person signed up in the last day.");
    expect(homeSummary({ live: null, next: null, signupsLastDay: 0, now })).toBe("Nothing on the calendar yet. Your next event starts here.");
  });
});

describe("organisation workspace helpers", () => {
  it("buckets dates into rolling windows", () => {
    const fiveDays = 5 * 86_400_000;
    expect(windowCounts([hours(-1), hours(-24 * 6), hours(-24 * 29), hours(-24 * 31)], now, 6, fiveDays)).toEqual([1, 0, 0, 0, 1, 1]);
  });

  it("computes turnout as checked in over going, ignoring over-counted check-ins", () => {
    expect(turnout([{ confirmed: 10, checkedIn: 8 }, { confirmed: 10, checkedIn: 12 }])).toEqual({ percent: 90, levels: [3, 4] });
    expect(turnout([{ confirmed: 0, checkedIn: 0 }])).toEqual({ percent: null, levels: [0] });
    expect(turnout([])).toEqual({ percent: null, levels: [] });
  });

  it("parses and shifts months safely", () => {
    const fallback = { year: 2026, month: 10 };
    expect(parseMonth("2026-12", fallback)).toEqual({ year: 2026, month: 12 });
    expect(parseMonth("2026-13", fallback)).toEqual(fallback);
    expect(parseMonth("<script>", fallback)).toEqual(fallback);
    expect(shiftMonth({ year: 2026, month: 12 }, 1)).toEqual({ year: 2027, month: 1 });
    expect(shiftMonth({ year: 2026, month: 1 }, -1)).toEqual({ year: 2025, month: 12 });
    expect(monthKey({ year: 2027, month: 3 })).toBe("2027-03");
  });

  it("builds a Monday-first month grid", () => {
    const october = monthGrid({ year: 2026, month: 10 }); // 1 Oct 2026 is a Thursday
    expect(october.slice(0, 4)).toEqual([null, null, null, 1]);
    expect(october.filter((day) => day !== null)).toHaveLength(31);
  });
});
