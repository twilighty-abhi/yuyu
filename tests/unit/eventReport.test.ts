import { describe, expect, it } from "vitest";
import { calculateReportRsvpMetrics, createEventReportPdf, isReportAvailable, reportFilename, type EventReportMetrics } from "@/lib/eventReport";

describe("event reports", () => {
  it("calculates RSVP funnel and attendance metrics without capacity assumptions", () => {
    const metrics = calculateReportRsvpMetrics([
      { status: "CONFIRMED", checkedInAt: new Date("2030-01-01T10:00:00Z") },
      { status: "CONFIRMED", checkedInAt: null },
      { status: "WAITLISTED", checkedInAt: null },
      { status: "PENDING_APPROVAL", checkedInAt: null },
      { status: "REJECTED", checkedInAt: null },
    ]);

    expect(metrics).toEqual({ total: 5, confirmed: 2, waitlisted: 1, pendingApproval: 1, rejected: 1, checkedIn: 1, noShows: 1 });
  });

  it("requires the end time to have passed", () => {
    const now = new Date("2030-01-01T12:00:00Z");
    expect(isReportAvailable(new Date("2030-01-01T11:59:59Z"), now)).toBe(true);
    expect(isReportAvailable(new Date("2030-01-01T12:00:00Z"), now)).toBe(false);
  });

  it("generates a non-empty PDF with a safe attachment filename", async () => {
    const report: EventReportMetrics = {
      targetType: "event",
      targetId: "event-1",
      organisationId: "org-1",
      organisationName: "Yuyu Events",
      title: "Community Meetup",
      startDateTime: new Date("2030-01-01T10:00:00Z"),
      endDateTime: new Date("2030-01-01T12:00:00Z"),
      timeZone: "UTC",
      location: "Main hall",
      isOnline: false,
      capacity: 40,
      invitationCount: 6,
      feedbackResponseCount: 3,
      total: 24,
      confirmed: 20,
      waitlisted: 2,
      pendingApproval: 1,
      rejected: 1,
      checkedIn: 16,
      noShows: 4,
    };

    const pdf = await createEventReportPdf(report);
    expect(Buffer.from(pdf).subarray(0, 4).toString()).toBe("%PDF");
    expect(pdf.byteLength).toBeGreaterThan(500);
    expect(reportFilename(report)).toBe("community-meetup-event-report-2030-01-01.pdf");
  });
});
