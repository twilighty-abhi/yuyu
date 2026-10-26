import { describe, expect, it } from "vitest";
import {
  formatDate,
  formatDateBlock,
  formatDayLong,
  formatDayShort,
  formatDayTime,
  formatRelativeDay,
  formatRelativeTime,
  formatTime,
  formatTimeRange,
} from "@/lib/format/datetime";

const start = new Date("2026-10-14T04:00:00.000Z"); // 9:30 AM IST, Wednesday
const end = new Date("2026-10-14T12:00:00.000Z"); // 5:30 PM IST
const tz = "Asia/Kolkata";
const now = new Date("2026-10-13T06:00:00.000Z");

describe("date formatter", () => {
  it("renders the named styles from the design system", () => {
    expect(formatDateBlock(start, tz)).toEqual({ month: "OCT", day: "14" });
    expect(formatDayLong(start, tz, now)).toBe("Wednesday, 14 October");
    expect(formatDayShort(start, tz, now)).toBe("Wed 14 Oct");
    expect(formatTime(start, tz)).toBe("9:30 AM");
    expect(formatTimeRange(start, end, tz)).toBe("9:30 AM – 5:30 PM IST");
    expect(formatDayTime(start, tz)).toBe("Wed 14 Oct · 9:30 AM");
    expect(formatDate(start, tz)).toBe("14 Oct 2026");
  });

  it("shows the hour after midnight as 12, not 0, on every ICU build", () => {
    const pastMidnight = new Date("2026-10-25T00:05:00.000Z");
    expect(formatTime(pastMidnight, "UTC")).toBe("12:05 AM");
    expect(formatTime(new Date("2026-10-25T12:05:00.000Z"), "UTC")).toBe("12:05 PM");
  });

  it("adds the year only when it differs", () => {
    expect(formatDayShort(new Date("2027-01-05T04:00:00Z"), tz, now)).toBe("Tue 5 Jan 2027");
  });

  it("uses the event timezone, not the server's", () => {
    const lateUtc = new Date("2026-10-14T20:30:00.000Z");
    expect(formatDayShort(lateUtc, tz, now)).toBe("Thu 15 Oct");
    expect(formatDayShort(lateUtc, "UTC", now)).toBe("Wed 14 Oct");
  });

  it("spans days when start and end differ", () => {
    expect(formatTimeRange(start, new Date("2026-10-15T12:00:00Z"), tz, { withZone: false })).toBe("Wed 14 Oct, 9:30 AM – Thu 15 Oct, 5:30 PM");
  });

  it("describes relative days and times", () => {
    expect(formatRelativeDay(start, tz, now)).toBe("Tomorrow");
    expect(formatRelativeDay(now, tz, now)).toBe("Today");
    expect(formatRelativeDay(new Date("2026-10-22T04:00:00Z"), tz, now)).toBe("In 9 days");
    expect(formatRelativeTime(new Date(now.getTime() - 120_000), tz, now)).toBe("2 min ago");
    expect(formatRelativeTime(new Date(now.getTime() - 30_000), tz, now)).toBe("Just now");
    expect(formatRelativeTime(new Date("2026-10-12T06:00:00Z"), tz, now)).toBe("Yesterday");
    const older = new Date("2026-09-01T06:00:00Z");
    expect(formatRelativeTime(older, tz, now)).toBe(formatDate(older, tz));
    expect(formatRelativeTime(older, tz, now)).toMatch(/^1 Sept? 2026$/);
  });

  it("never shows seconds or US-style dates", () => {
    const all = [formatDayLong(start, tz), formatDayShort(start, tz), formatTime(start, tz), formatTimeRange(start, end, tz), formatDate(start, tz)].join(" ");
    expect(all).not.toMatch(/\d{1,2}\/\d{1,2}\/\d{4}/);
    expect(all).not.toMatch(/\d:\d\d:\d\d/);
  });
});
