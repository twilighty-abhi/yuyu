import { describe, expect, it } from "vitest";
import { parseDiscoveryDateRange } from "@/lib/dateFilter";

describe("discovery date filters", () => {
  it("treats the selected to date as an inclusive calendar day", () => {
    const range = parseDiscoveryDateRange("2026-08-30", "2026-08-31");
    expect(range.error).toBeNull();
    expect(range.fromDate?.toISOString()).toBe("2026-08-30T00:00:00.000Z");
    expect(range.toExclusive?.toISOString()).toBe("2026-09-01T00:00:00.000Z");
  });

  it("rejects invalid and reversed ranges", () => {
    expect(parseDiscoveryDateRange("2026-02-30", undefined).error).toMatch(/valid/i);
    expect(parseDiscoveryDateRange("2026-09-01", "2026-08-31").error).toMatch(/before/i);
  });
});
