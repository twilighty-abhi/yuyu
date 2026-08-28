import { describe, expect, it } from "vitest";
import { effectiveSchedule } from "@/lib/schedule";

describe("effectiveSchedule", () => {
  it("cascades a session delay to later sessions", () => {
    const rows = effectiveSchedule([
      { id: "one", title: "One", description: "", startDateTime: new Date("2030-01-01T10:00:00Z"), endDateTime: new Date("2030-01-01T11:00:00Z"), sortOrder: 1, delayMinutes: 15 },
      { id: "two", title: "Two", description: "", startDateTime: new Date("2030-01-01T11:00:00Z"), endDateTime: new Date("2030-01-01T12:00:00Z"), sortOrder: 2, delayMinutes: 0 },
    ]);
    expect(rows[1]?.effectiveStart.toISOString()).toBe("2030-01-01T11:15:00.000Z");
  });
});
