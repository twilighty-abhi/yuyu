import { describe, expect, it } from "vitest";
import { isRegistrationClosed, registrationClosesAt } from "@/lib/registrationCutoff";

describe("registration cutoffs", () => {
  const event = { startDateTime: new Date("2030-01-02T12:00:00Z"), registrationClosesAt: null, registrationLeadMinutes: 60 };
  it("resolves a relative cutoff from the event start", () => {
    expect(registrationClosesAt(event)?.toISOString()).toBe("2030-01-02T11:00:00.000Z");
  });
  it("closes at and after the configured deadline", () => {
    expect(isRegistrationClosed(event, new Date("2030-01-02T10:59:59Z"))).toBe(false);
    expect(isRegistrationClosed(event, new Date("2030-01-02T11:00:00Z"))).toBe(true);
  });
});
