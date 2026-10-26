import { afterAll, beforeEach, describe, expect, it } from "vitest";

/*
 * Each Intl.DateTimeFormat loads ICU data into native memory that Node keeps.
 * The Analytics panel used to build one per registration date (62k per open
 * of a 15k-registration event, about 1.2 GB of RSS). These tests count
 * constructions so that a per-date formatter in a hot path fails CI.
 */
const counter = { constructed: 0 };
const Original = Intl.DateTimeFormat;
class CountingDateTimeFormat extends Original {
  constructor(...args: ConstructorParameters<typeof Intl.DateTimeFormat>) {
    super(...args);
    counter.constructed += 1;
  }
}
Intl.DateTimeFormat = CountingDateTimeFormat as unknown as typeof Intl.DateTimeFormat;
afterAll(() => {
  Intl.DateTimeFormat = Original;
});

const { busiestDay, signupTimeline, signupsLastWeek } = await import("@/components/event-dashboard/analytics/metrics");
const { formatDate, formatDayShort, formatTime, formatTimeRange, formatTimeZoneName } = await import("@/lib/format/datetime");
const { cachedDateTimeFormat } = await import("@/lib/format/intlCache");
const { isValidTimeZone, safeTimeZone } = await import("@/lib/timeZone");

const start = Date.UTC(2026, 8, 1);
const dates = Array.from({ length: 5_000 }, (_, index) => new Date(start + index * 9 * 60_000));
const until = new Date(start + 40 * 86_400_000);

describe("Intl formatter reuse", () => {
  beforeEach(() => {
    // Warm the cache for the shapes under test, then count only new work.
    signupTimeline(dates.slice(0, 2), until, "Asia/Kolkata");
    signupsLastWeek(dates.slice(0, 2), until, "Asia/Kolkata");
    busiestDay(dates.slice(0, 2), "Asia/Kolkata");
    counter.constructed = 0;
  });

  it("buckets thousands of sign-ups without building a formatter per date", () => {
    const timeline = signupTimeline(dates, until, "Asia/Kolkata");
    const lastWeek = signupsLastWeek(dates, until, "Asia/Kolkata");
    const busiest = busiestDay(dates, "Asia/Kolkata");
    expect(timeline?.total).toBe(5_000);
    expect(lastWeek).toBe(0);
    expect(busiest?.count).toBeGreaterThan(0);
    expect(counter.constructed).toBe(0);
  });

  it("reuses formatters across the UI date helpers", () => {
    for (const date of dates.slice(0, 500)) {
      formatDate(date, "Europe/London");
      formatDayShort(date, "Europe/London", until);
      formatTime(date, "Europe/London");
      formatTimeRange(date, until, "Europe/London");
      formatTimeZoneName(date, "Europe/London");
    }
    // One per distinct option shape at most, never one per call.
    expect(counter.constructed).toBeLessThan(15);
  });

  it("returns the same formatter for the same locale and options, and a different one otherwise", () => {
    const a = cachedDateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric" });
    expect(cachedDateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric" })).toBe(a);
    expect(cachedDateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", day: "numeric" })).not.toBe(a);
    expect(cachedDateTimeFormat("en-US", { timeZone: "UTC", day: "numeric" })).not.toBe(a);
  });

  it("still rejects unknown zones, without caching them as valid", () => {
    expect(() => cachedDateTimeFormat("en-GB", { timeZone: "Not/AZone" })).toThrow(RangeError);
    expect(isValidTimeZone("Not/AZone")).toBe(false);
    expect(isValidTimeZone("Not/AZone")).toBe(false);
    expect(safeTimeZone("Not/AZone")).toBe("UTC");
    expect(isValidTimeZone("Europe/Paris")).toBe(true);
  });
});
