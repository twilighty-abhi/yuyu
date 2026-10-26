import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  compareWindows,
  credentialState,
  fillDailySeries,
  formatBytes,
  formatChange,
  formatShare,
  minutesAgo,
  outboxByKind,
  percentChange,
  readPageParam,
  readSearchParam,
  SECURITY_AUDIT_ACTIONS,
  shortDayLabel,
  utcDayKeys,
  windowStart,
} from "@/lib/superAdminInsights";

const now = new Date("2026-10-15T09:30:00.000Z");

describe("super-admin insight helpers", () => {
  it("builds UTC day keys ending today, oldest first", () => {
    expect(utcDayKeys(3, now)).toEqual(["2026-10-13", "2026-10-14", "2026-10-15"]);
    expect(utcDayKeys(2, new Date("2026-03-01T00:10:00.000Z"))).toEqual(["2026-02-28", "2026-03-01"]);
    expect(windowStart(3, now).toISOString()).toBe("2026-10-13T00:00:00.000Z");
  });

  it("subtracts minutes from a fixed instant", () => {
    expect(minutesAgo(15, now).toISOString()).toBe("2026-10-15T09:15:00.000Z");
  });

  it("labels days without locale dependence", () => {
    expect(shortDayLabel("2026-10-05")).toBe("Oct 5");
  });

  it("zero-fills sparse grouped rows per series and ignores rows outside the window", () => {
    const series = fillDailySeries(
      [
        { series: "rsvps", day: "2026-10-15", n: BigInt(4) },
        { series: "rsvps", day: "2026-10-13", n: 2 },
        { series: "events", day: "2026-10-14", n: 1 },
        { series: "rsvps", day: "2026-09-01", n: 99 },
      ],
      ["rsvps", "events", "signups"] as const,
      3,
      now,
    );
    expect(series.rsvps.map((point) => point.y)).toEqual([2, 0, 4]);
    expect(series.events.map((point) => point.y)).toEqual([0, 1, 0]);
    expect(series.signups.map((point) => point.y)).toEqual([0, 0, 0]);
    expect(series.rsvps[0]).toMatchObject({ day: "2026-10-13", xLabel: "Oct 13" });
  });

  it("compares the previous and current halves of a series", () => {
    const points = [1, 2, 3, 4, 5, 6].map((y, index) => ({ day: String(index), xLabel: String(index), y }));
    expect(compareWindows(points)).toEqual({ previous: 6, current: 15 });
  });

  it("formats change and share safely around zero", () => {
    expect(percentChange(15, 10)).toBe(50);
    expect(percentChange(5, 0)).toBeNull();
    expect(formatChange(15, 10)).toBe("+50%");
    expect(formatChange(5, 10)).toBe("-50%");
    expect(formatChange(5, 0)).toBe("New");
    expect(formatChange(0, 0)).toBe("—");
    expect(formatShare(1, 3)).toBe("33%");
    expect(formatShare(3, 0)).toBe("0%");
  });

  it("formats byte sizes", () => {
    expect(formatBytes(null)).toBe("—");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.50 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.00 MB");
  });

  it("derives credential lifecycle from timestamps only", () => {
    expect(credentialState({ revokedAt: null, expiresAt: null }, now)).toBe("active");
    expect(credentialState({ revokedAt: null, expiresAt: new Date("2026-10-16T00:00:00Z") }, now)).toBe("active");
    expect(credentialState({ revokedAt: null, expiresAt: new Date("2026-10-01T00:00:00Z") }, now)).toBe("expired");
    expect(credentialState({ revokedAt: new Date("2026-09-01T00:00:00Z"), expiresAt: new Date("2026-10-01T00:00:00Z") }, now)).toBe("revoked");
  });

  it("pivots outbox counts by kind, busiest first", () => {
    const rows = outboxByKind([
      { kind: "password-reset", status: "SENT", count: 2 },
      { kind: "rsvp-confirmation", status: "SENT", count: 10 },
      { kind: "rsvp-confirmation", status: "FAILED", count: 1 },
      { kind: "rsvp-confirmation", status: "PENDING", count: 3 },
      { kind: "password-reset", status: "PROCESSING", count: 1 },
    ]);
    expect(rows).toEqual([
      { kind: "rsvp-confirmation", pending: 3, processing: 0, sent: 10, failed: 1, total: 14 },
      { kind: "password-reset", pending: 0, processing: 1, sent: 2, failed: 0, total: 3 },
    ]);
  });

  it("keeps the security action list explicit and free of duplicates", () => {
    expect(new Set(SECURITY_AUDIT_ACTIONS).size).toBe(SECURITY_AUDIT_ACTIONS.length);
    expect(SECURITY_AUDIT_ACTIONS).toContain("MFA_DISABLED");
    expect(SECURITY_AUDIT_ACTIONS).toContain("ATTENDEE_LIST_EXPORTED");
  });

  it("lists every audit action a data-export route records", () => {
    const root = join(process.cwd(), "app/api/exports");
    const routes = readdirSync(root, { recursive: true, encoding: "utf8" }).filter((file) => file.endsWith("route.ts"));
    const actions = new Set(routes.flatMap((file) => [...readFileSync(join(root, file), "utf8").matchAll(/action: "([A-Z_]+)"/g)].map((match) => match[1])));
    expect(actions).toContain("TEAM_LIST_EXPORTED");
    expect(actions).toContain("JUDGING_SUBMISSIONS_EXPORTED");
    for (const action of actions) expect(SECURITY_AUDIT_ACTIONS as readonly string[]).toContain(action);
  });

  it("reads list search params defensively", () => {
    expect(readSearchParam(undefined)).toBe("");
    expect(readSearchParam("  ada  ")).toBe("ada");
    expect(readSearchParam(["first", "second"])).toBe("first");
    expect(readSearchParam("x".repeat(500))).toHaveLength(120);
    expect(readSearchParam("abcdef", 3)).toBe("abc");
  });

  it("clamps page numbers to a bounded, non-negative integer", () => {
    expect(readPageParam(undefined)).toBe(0);
    expect(readPageParam("3")).toBe(3);
    expect(readPageParam(["2", "9"])).toBe(2);
    expect(readPageParam("-4")).toBe(0);
    expect(readPageParam("1e9")).toBe(0);
    expect(readPageParam("abc")).toBe(0);
    expect(readPageParam("99999999999999")).toBe(0);
    expect(readPageParam("5000")).toBe(1000);
  });
});
