import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CHECK_IN_STATION_EARLY_ACCESS_MS, CHECK_IN_STATION_GRACE_MS, createCheckInStationProof, decryptStationPin, encryptStationPin, hasValidCheckInStationProof, stationExpiresAt, stationOpensAt } from "@/lib/checkInStation";

const originalSecret = process.env.AUTH_SECRET;
const originalEncryptionKey = process.env.MFA_ENCRYPTION_KEY;
beforeEach(() => {
  process.env.AUTH_SECRET = "a".repeat(32);
  process.env.MFA_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
});

afterEach(() => {
  process.env.AUTH_SECRET = originalSecret;
  process.env.MFA_ENCRYPTION_KEY = originalEncryptionKey;
});

describe("check-in station proof", () => {
  const end = new Date("2026-08-30T10:00:00.000Z");
  const start = new Date("2026-08-30T08:00:00.000Z");
  const now = new Date("2026-08-30T09:00:00.000Z").getTime();

  it("is valid only for its event and current PIN version", () => {
    const proof = createCheckInStationProof("event_1", 4, start, end, now);
    expect(proof).toBeTruthy();
    expect(hasValidCheckInStationProof(proof!, "event_1", 4, start, end, now + 1)).toBe(true);
    expect(hasValidCheckInStationProof(proof!, "event_2", 4, start, end, now + 1)).toBe(false);
    expect(hasValidCheckInStationProof(proof!, "event_1", 5, start, end, now + 1)).toBe(false);
  });

  it("expires one hour after the event and cannot be created after that", () => {
    const proof = createCheckInStationProof("event_1", 1, start, end, now)!;
    const expiry = stationExpiresAt(end).getTime();
    expect(expiry - end.getTime()).toBe(CHECK_IN_STATION_GRACE_MS);
    expect(hasValidCheckInStationProof(proof, "event_1", 1, start, end, expiry - 1)).toBe(true);
    expect(hasValidCheckInStationProof(proof, "event_1", 1, start, end, expiry)).toBe(false);
    expect(createCheckInStationProof("event_1", 1, start, end, expiry)).toBeNull();
  });

  it("does not expose the roster before the event-day operating window", () => {
    const opens = stationOpensAt(start).getTime();
    expect(start.getTime() - opens).toBe(CHECK_IN_STATION_EARLY_ACCESS_MS);
    expect(createCheckInStationProof("event_1", 1, start, end, opens - 1)).toBeNull();
    expect(createCheckInStationProof("event_1", 1, start, end, opens)).toBeTruthy();
  });

  it("uses a domain-separated authenticated-encryption format for recoverable PINs", () => {
    const encrypted = encryptStationPin("12345678");
    expect(encrypted.startsWith("v2.")).toBe(true);
    expect(encrypted).not.toContain("12345678");
    expect(decryptStationPin(encrypted)).toBe("12345678");
  });
});
