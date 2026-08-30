import { describe, expect, it } from "vitest";
import { buildRecurrenceIcs, materializeInstances } from "@/lib/recurrence";
import { createSeriesSchema } from "@/lib/validators";

describe("recurrence safety", () => {
  it("bounds dense infinite rules while preserving chronological windows", () => {
    const start = new Date("2030-01-01T00:00:00.000Z");
    const windows = materializeInstances(buildRecurrenceIcs(start, "FREQ=SECONDLY"), 1_000, {
      from: start,
      until: new Date("2031-01-01T00:00:00.000Z"),
    });
    expect(windows).toHaveLength(48);
    expect(windows[0]?.startDateTime).toEqual(start);
    expect(windows[47]?.startDateTime).toEqual(new Date("2030-01-01T00:00:47.000Z"));
  });

  it("clamps caller-provided expansion limits", () => {
    const start = new Date("2030-01-01T00:00:00.000Z");
    const windows = materializeInstances(buildRecurrenceIcs(start, "FREQ=SECONDLY"), 1_000, {
      maxInstances: 10_000,
      from: start,
      until: new Date("2031-01-01T00:00:00.000Z"),
    });
    expect(windows).toHaveLength(500);
  });

  it("rejects multiline rule injection and durations Prisma Int cannot store", () => {
    const base = {
      organisationSlug: "org",
      title: "Series",
      description: "",
      anchorStartDateTime: new Date("2030-01-01T00:00:00.000Z"),
      anchorEndDateTime: new Date("2030-01-01T01:00:00.000Z"),
      rruleLine: "FREQ=DAILY",
      timezone: "UTC",
      status: "DRAFT",
      privacyType: "PUBLIC",
    };
    expect(createSeriesSchema.safeParse({ ...base, rruleLine: "FREQ=DAILY\nRDATE:20300102T000000Z" }).success).toBe(false);
    expect(createSeriesSchema.safeParse({ ...base, anchorEndDateTime: new Date("2030-02-01T00:00:00.000Z") }).success).toBe(false);
  });
});
