import { afterEach, describe, expect, it } from "vitest";
import { createEventSchema, createSeriesSchema, updateEventSchema } from "@/lib/validators";

// The Create Event and Create Series dialogs post `datetime-local` wall-clock
// values. They must be read in the event's timezone, never the server's clock.

const originalTz = process.env.TZ;
afterEach(() => {
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
});

const event = {
  organisationSlug: "demo",
  title: "Launch",
  aboutHtml: "<p>Hello</p>",
  startDateTime: "2030-12-01T19:00",
  endDateTime: "2030-12-01T21:00",
  timezone: "Asia/Kolkata",
  isOnline: false,
  location: "Main hall",
};

const series = {
  organisationSlug: "demo",
  title: "Weekly",
  description: "",
  anchorStartDateTime: "2030-12-01T18:00",
  anchorEndDateTime: "2030-12-01T19:00",
  rruleLine: "FREQ=WEEKLY;COUNT=4",
  timezone: "UTC",
  status: "DRAFT",
  privacyType: "PUBLIC",
};

describe("create forms read wall-clock times in the chosen timezone", () => {
  for (const serverTz of ["UTC", "Asia/Kolkata", "America/Los_Angeles"]) {
    it(`stores the same instant on a server in ${serverTz}`, () => {
      process.env.TZ = serverTz;
      const created = createEventSchema.parse(event);
      expect(created.startDateTime.toISOString()).toBe("2030-12-01T13:30:00.000Z");
      expect(created.endDateTime.toISOString()).toBe("2030-12-01T15:30:00.000Z");

      const updated = updateEventSchema.parse({ ...event, eventId: "evt_1", status: "DRAFT", privacyType: "PUBLIC" });
      expect(updated.startDateTime.toISOString()).toBe("2030-12-01T13:30:00.000Z");

      const createdSeries = createSeriesSchema.parse(series);
      expect(createdSeries.anchorStartDateTime.toISOString()).toBe("2030-12-01T18:00:00.000Z");
      expect(createdSeries.anchorEndDateTime.toISOString()).toBe("2030-12-01T19:00:00.000Z");
    });
  }

  it("reads the registration cutoff in the event timezone too", () => {
    process.env.TZ = "UTC";
    const parsed = createEventSchema.parse({ ...event, registrationClosesAt: "2030-12-01T18:00" });
    expect(parsed.registrationClosesAt?.toISOString()).toBe("2030-12-01T12:30:00.000Z");
  });

  it("leaves explicit instants unchanged", () => {
    process.env.TZ = "UTC";
    const parsed = createEventSchema.parse({ ...event, startDateTime: "2030-12-01T13:30:00.000Z", endDateTime: "2030-12-01T15:30:00+00:00" });
    expect(parsed.startDateTime.toISOString()).toBe("2030-12-01T13:30:00.000Z");
    expect(parsed.endDateTime.toISOString()).toBe("2030-12-01T15:30:00.000Z");
  });

  it("rejects a local time that does not exist in the timezone", () => {
    // 02:30 on 2030-03-10 is skipped by the US spring-forward change.
    const result = createEventSchema.safeParse({
      ...event,
      timezone: "America/New_York",
      startDateTime: "2030-03-10T02:30",
      endDateTime: "2030-03-10T04:00",
    });
    expect(result.success).toBe(false);
  });
});
