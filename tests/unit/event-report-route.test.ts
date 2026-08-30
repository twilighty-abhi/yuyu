import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  metrics: vi.fn(),
  pdf: vi.fn(),
  membership: vi.fn(),
  isAdmin: vi.fn(),
  audit: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/audit", () => ({ recordAuditEvent: mocks.audit }));
vi.mock("@/lib/permissions", () => ({ getMembership: mocks.membership, isOrgAdmin: mocks.isAdmin }));
vi.mock("@/lib/eventReport", () => ({
  getEventReportMetrics: mocks.metrics,
  createEventReportPdf: mocks.pdf,
  isReportAvailable: () => true,
  reportFilename: () => "safe-report.pdf",
}));

import { GET } from "@/app/api/reports/event/[eventId]/route";

const metrics = {
  targetId: "event_1",
  organisationId: "org_1",
  endDateTime: new Date("2030-01-01T00:00:00Z"),
};

describe("event report route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ user: { id: "user_1" } });
    mocks.metrics.mockResolvedValue(metrics);
    mocks.membership.mockResolvedValue({ role: "MEMBER" });
    mocks.isAdmin.mockReturnValue(false);
    mocks.pdf.mockResolvedValue(new Uint8Array([37, 80, 68, 70]));
  });

  it("returns a generic not-found response and never generates data for a non-admin", async () => {
    const response = await GET(new Request("https://events.example.test/api/reports/event/event_1"), { params: Promise.resolve({ eventId: "event_1" }) });
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.pdf).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("serves an audited, non-cacheable attachment to an organisation admin", async () => {
    mocks.isAdmin.mockReturnValue(true);
    const response = await GET(new Request("https://events.example.test/api/reports/event/event_1"), { params: Promise.resolve({ eventId: "event_1" }) });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="safe-report.pdf"');
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "EVENT_REPORT_DOWNLOADED", organisationId: "org_1" }));
  });
});
