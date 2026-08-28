import { describe, expect, it } from "vitest";
import { shouldRefreshCheckIn } from "@/lib/checkInRefresh";

describe("check-in refresh guard", () => {
  it("refreshes only while the online station is visible and idle", () => {
    expect(shouldRefreshCheckIn({ isVisible: true, isOnline: true, scanOpen: false, idCardOpen: false })).toBe(true);
    expect(shouldRefreshCheckIn({ isVisible: false, isOnline: true, scanOpen: false, idCardOpen: false })).toBe(false);
    expect(shouldRefreshCheckIn({ isVisible: true, isOnline: false, scanOpen: false, idCardOpen: false })).toBe(false);
    expect(shouldRefreshCheckIn({ isVisible: true, isOnline: true, scanOpen: true, idCardOpen: false })).toBe(false);
    expect(shouldRefreshCheckIn({ isVisible: true, isOnline: true, scanOpen: false, idCardOpen: true })).toBe(false);
  });
});
