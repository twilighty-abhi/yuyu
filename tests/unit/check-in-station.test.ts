import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CHECK_IN_STATION_GRACE_MS, createCheckInStationProof, hasValidCheckInStationProof, stationExpiresAt } from "@/lib/checkInStation";

const originalSecret = process.env.AUTH_SECRET;
beforeEach(() => { process.env.AUTH_SECRET = "a".repeat(32); });

afterEach(() => { process.env.AUTH_SECRET = originalSecret; });

describe("check-in station proof", () => {
  const end = new Date("2026-08-30T10:00:00.000Z");
  const now = new Date("2026-08-30T09:00:00.000Z").getTime();

  it("is valid only for its event and current PIN version", () => {
    const proof = createCheckInStationProof("event_1", 4, end, now);
    expect(proof).toBeTruthy();
    expect(hasValidCheckInStationProof(proof!, "event_1", 4, end, now + 1)).toBe(true);
    expect(hasValidCheckInStationProof(proof!, "event_2", 4, end, now + 1)).toBe(false);
    expect(hasValidCheckInStationProof(proof!, "event_1", 5, end, now + 1)).toBe(false);
  });

  it("expires one hour after the event and cannot be created after that", () => {
    const proof = createCheckInStationProof("event_1", 1, end, now)!;
    const expiry = stationExpiresAt(end).getTime();
    expect(expiry - end.getTime()).toBe(CHECK_IN_STATION_GRACE_MS);
    expect(hasValidCheckInStationProof(proof, "event_1", 1, end, expiry - 1)).toBe(true);
    expect(hasValidCheckInStationProof(proof, "event_1", 1, end, expiry)).toBe(false);
    expect(createCheckInStationProof("event_1", 1, end, expiry)).toBeNull();
  });
});
