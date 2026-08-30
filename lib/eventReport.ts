import "server-only";

import type { RsvpStatus } from "@prisma/client";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { prisma } from "@/lib/db";
import { safeTimeZone } from "@/lib/timeZone";

export type ReportRsvp = { status: RsvpStatus; checkedInAt: Date | null };

export type ReportRsvpMetrics = {
  total: number;
  confirmed: number;
  waitlisted: number;
  pendingApproval: number;
  rejected: number;
  checkedIn: number;
  noShows: number;
};

export type EventReportMetrics = ReportRsvpMetrics & {
  targetType: "event" | "occurrence";
  targetId: string;
  organisationId: string;
  organisationName: string;
  title: string;
  startDateTime: Date;
  endDateTime: Date;
  timeZone: string;
  location: string;
  isOnline: boolean;
  capacity: number | null;
  invitationCount: number;
  feedbackResponseCount: number | null;
};

export function calculateReportRsvpMetrics(rsvps: ReportRsvp[]): ReportRsvpMetrics {
  const metrics: ReportRsvpMetrics = {
    total: rsvps.length,
    confirmed: 0,
    waitlisted: 0,
    pendingApproval: 0,
    rejected: 0,
    checkedIn: 0,
    noShows: 0,
  };

  for (const rsvp of rsvps) {
    if (rsvp.status === "CONFIRMED") {
      metrics.confirmed += 1;
      if (rsvp.checkedInAt) metrics.checkedIn += 1;
    } else if (rsvp.status === "WAITLISTED") {
      metrics.waitlisted += 1;
    } else if (rsvp.status === "PENDING_APPROVAL") {
      metrics.pendingApproval += 1;
    } else if (rsvp.status === "REJECTED") {
      metrics.rejected += 1;
    }
  }
  metrics.noShows = Math.max(0, metrics.confirmed - metrics.checkedIn);
  return metrics;
}

export function isReportAvailable(endDateTime: Date, now = new Date()) {
  return endDateTime.getTime() < now.getTime();
}

export async function getEventReportMetrics(eventId: string): Promise<EventReportMetrics | null> {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: {
      id: true,
      title: true,
      startDateTime: true,
      endDateTime: true,
      timezone: true,
      location: true,
      isOnline: true,
      capacity: true,
      organisation: { select: { id: true, name: true } },
      rsvps: { select: { status: true, checkedInAt: true } },
      _count: { select: { invites: true } },
      feedbackForm: { select: { _count: { select: { responses: true } } } },
    },
  });
  if (!event) return null;

  return {
    targetType: "event",
    targetId: event.id,
    organisationId: event.organisation.id,
    organisationName: event.organisation.name,
    title: event.title,
    startDateTime: event.startDateTime,
    endDateTime: event.endDateTime,
    timeZone: event.timezone,
    location: event.location,
    isOnline: event.isOnline,
    capacity: event.capacity,
    invitationCount: event._count.invites,
    feedbackResponseCount: event.feedbackForm?._count.responses ?? 0,
    ...calculateReportRsvpMetrics(event.rsvps),
  };
}

export async function getOccurrenceReportMetrics(instanceId: string): Promise<EventReportMetrics | null> {
  const instance = await prisma.eventInstance.findUnique({
    where: { id: instanceId },
    select: {
      id: true,
      startDateTime: true,
      endDateTime: true,
      rsvps: { select: { status: true, checkedInAt: true } },
      series: {
        select: {
          id: true,
          title: true,
          timezone: true,
          capacity: true,
          organisation: { select: { id: true, name: true } },
          _count: { select: { invites: true } },
        },
      },
    },
  });
  if (!instance) return null;

  return {
    targetType: "occurrence",
    targetId: instance.id,
    organisationId: instance.series.organisation.id,
    organisationName: instance.series.organisation.name,
    title: instance.series.title,
    startDateTime: instance.startDateTime,
    endDateTime: instance.endDateTime,
    timeZone: instance.series.timezone,
    location: "",
    isOnline: false,
    capacity: instance.series.capacity,
    invitationCount: instance.series._count.invites,
    feedbackResponseCount: null,
    ...calculateReportRsvpMetrics(instance.rsvps),
  };
}

function cleanPdfText(value: string) {
  return value.normalize("NFKD").replace(/[^\x20-\x7E]/g, "").trim() || "Not provided";
}

function shorten(value: string, maxLength = 80) {
  const clean = cleanPdfText(value);
  return clean.length > maxLength ? `${clean.slice(0, maxLength - 3)}...` : clean;
}

function dateTime(value: Date, timeZone: string) {
  return value.toLocaleString("en-US", {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: safeTimeZone(timeZone),
    timeZoneName: "short",
  });
}

function percentage(numerator: number, denominator: number) {
  if (denominator <= 0) return "-";
  return `${Math.round((numerator / denominator) * 100)}%`;
}

export function reportFilename(metrics: EventReportMetrics) {
  const slug = metrics.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 72) || "event";
  const date = metrics.startDateTime.toISOString().slice(0, 10);
  return `${slug}-${metrics.targetType}-report-${date}.pdf`;
}

/** Generates a concise aggregate-only PDF; it never writes report data to disk. */
export async function createEventReportPdf(metrics: EventReportMetrics): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const pageSize: [number, number] = [595.28, 841.89];
  const ink = rgb(0.07, 0.1, 0.16);
  const navy = rgb(0.06, 0.18, 0.34);
  const blue = rgb(0.08, 0.43, 0.8);
  const teal = rgb(0.0, 0.57, 0.53);
  const amber = rgb(0.92, 0.57, 0.07);
  const coral = rgb(0.84, 0.25, 0.25);
  const muted = rgb(0.36, 0.42, 0.5);
  const line = rgb(0.86, 0.89, 0.93);
  const paleBlue = rgb(0.93, 0.97, 1);
  const paleTeal = rgb(0.91, 0.98, 0.96);
  const margin = 44;

  const footer = (page: ReturnType<typeof pdf.addPage>, pageNumber: number) => {
    page.drawLine({ start: { x: margin, y: 46 }, end: { x: pageSize[0] - margin, y: 46 }, thickness: 0.8, color: line });
    page.drawText("Aggregate metrics only - no attendee data included", { x: margin, y: 30, size: 8, font: regular, color: muted });
    page.drawText(`${pageNumber} / 2`, { x: pageSize[0] - margin - 20, y: 30, size: 8, font: bold, color: muted });
  };
  const label = (page: ReturnType<typeof pdf.addPage>, value: string, x: number, y: number) =>
    page.drawText(value.toUpperCase(), { x, y, size: 8, font: bold, color: muted });
  const metricCard = (page: ReturnType<typeof pdf.addPage>, x: number, y: number, width: number, heading: string, value: string, detail: string, background: ReturnType<typeof rgb>) => {
    page.drawRectangle({ x, y, width, height: 92, color: background, borderColor: line, borderWidth: 0.6 });
    label(page, heading, x + 15, y + 68);
    page.drawText(value, { x: x + 15, y: y + 39, size: 25, font: bold, color: ink });
    page.drawText(shorten(detail, 30), { x: x + 15, y: y + 18, size: 8.5, font: regular, color: muted });
  };
  const progress = (page: ReturnType<typeof pdf.addPage>, x: number, y: number, width: number, ratio: number, color: ReturnType<typeof rgb>) => {
    page.drawRectangle({ x, y, width, height: 8, color: line });
    page.drawRectangle({ x, y, width: Math.max(0, Math.min(width, width * ratio)), height: 8, color });
  };

  const overview = pdf.addPage(pageSize);
  overview.drawRectangle({ x: 0, y: 0, width: pageSize[0], height: pageSize[1], color: rgb(1, 1, 1) });
  overview.drawRectangle({ x: 0, y: 670, width: pageSize[0], height: 171.89, color: navy });
  overview.drawRectangle({ x: 0, y: 650, width: pageSize[0], height: 20, color: blue });
  overview.drawText(cleanPdfText(metrics.organisationName), { x: margin, y: 797, size: 11, font: bold, color: rgb(0.82, 0.91, 1) });
  overview.drawText("POST-EVENT REPORT", { x: margin, y: 756, size: 24, font: bold, color: rgb(1, 1, 1) });
  overview.drawText(shorten(metrics.title, 52), { x: margin, y: 726, size: 14, font: regular, color: rgb(0.9, 0.95, 1) });
  overview.drawText(`Completed ${dateTime(metrics.endDateTime, metrics.timeZone)}`, { x: margin, y: 696, size: 9, font: regular, color: rgb(0.77, 0.87, 0.98) });

  const attendanceRate = metrics.confirmed ? metrics.checkedIn / metrics.confirmed : 0;
  const capacityRate = metrics.capacity ? metrics.confirmed / metrics.capacity : 0;
  metricCard(overview, margin, 530, 156, "Registrations", String(metrics.total), `${metrics.confirmed} confirmed`, paleBlue);
  metricCard(overview, 219, 530, 156, "Attendance", percentage(metrics.checkedIn, metrics.confirmed), `${metrics.checkedIn} checked in`, paleTeal);
  metricCard(overview, 408, 530, 143, "Feedback", metrics.feedbackResponseCount == null ? "-" : String(metrics.feedbackResponseCount), metrics.feedbackResponseCount == null ? "Not collected" : "responses received", rgb(1, 0.97, 0.9));

  label(overview, "Event overview", margin, 486);
  overview.drawLine({ start: { x: margin, y: 476 }, end: { x: 551, y: 476 }, thickness: 1, color: line });
  const details: Array<[string, string]> = [
    ["When", `${dateTime(metrics.startDateTime, metrics.timeZone)} - ${dateTime(metrics.endDateTime, metrics.timeZone)}`],
    ["Format", metrics.isOnline ? "Online event" : metrics.location ? shorten(metrics.location, 62) : "Location not provided"],
    ["Capacity", metrics.capacity == null ? "No capacity limit" : `${metrics.confirmed} of ${metrics.capacity} confirmed (${percentage(metrics.confirmed, metrics.capacity)})`],
    ["Invitations", `${metrics.invitationCount} recorded invitation${metrics.invitationCount === 1 ? "" : "s"}`],
  ];
  let detailY = 445;
  for (const [name, value] of details) {
    overview.drawText(name, { x: margin, y: detailY, size: 9, font: bold, color: muted });
    overview.drawText(shorten(value, 62), { x: 167, y: detailY, size: 10, font: regular, color: ink });
    detailY -= 35;
  }

  label(overview, "At a glance", margin, 286);
  overview.drawRectangle({ x: margin, y: 174, width: 507, height: 92, color: rgb(0.98, 0.99, 1), borderColor: line, borderWidth: 0.6 });
  overview.drawText("Capacity filled", { x: 60, y: 237, size: 10, font: bold, color: ink });
  overview.drawText(metrics.capacity == null ? "No capacity limit" : percentage(metrics.confirmed, metrics.capacity), { x: 60, y: 214, size: 15, font: bold, color: blue });
  progress(overview, 60, 195, 189, metrics.capacity == null ? 0 : capacityRate, blue);
  overview.drawText("Check-in rate", { x: 292, y: 237, size: 10, font: bold, color: ink });
  overview.drawText(percentage(metrics.checkedIn, metrics.confirmed), { x: 292, y: 214, size: 15, font: bold, color: teal });
  progress(overview, 292, 195, 189, attendanceRate, teal);
  footer(overview, 1);

  const analytics = pdf.addPage(pageSize);
  analytics.drawRectangle({ x: 0, y: 0, width: pageSize[0], height: pageSize[1], color: rgb(1, 1, 1) });
  analytics.drawRectangle({ x: 0, y: 754, width: pageSize[0], height: 87.89, color: navy });
  analytics.drawText("ANALYTICS", { x: margin, y: 794, size: 22, font: bold, color: rgb(1, 1, 1) });
  analytics.drawText("Registration, attendance and engagement snapshot", { x: margin, y: 771, size: 10, font: regular, color: rgb(0.8, 0.89, 0.98) });

  label(analytics, "Registration outcome", margin, 718);
  analytics.drawText(`${metrics.total} total registrations`, { x: 385, y: 718, size: 9, font: regular, color: muted });
  const outcome = [
    ["Confirmed", metrics.confirmed, blue],
    ["Waitlisted", metrics.waitlisted, amber],
    ["Pending approval", metrics.pendingApproval, rgb(0.43, 0.34, 0.78)],
    ["Rejected", metrics.rejected, coral],
  ] as const;
  let chartY = 668;
  for (const [name, value, color] of outcome) {
    analytics.drawText(name, { x: margin, y: chartY + 4, size: 10, font: regular, color: ink });
    progress(analytics, 174, chartY, 270, metrics.total ? value / metrics.total : 0, color);
    analytics.drawText(`${value}  (${percentage(value, metrics.total)})`, { x: 458, y: chartY + 1, size: 9, font: bold, color: ink });
    chartY -= 38;
  }

  label(analytics, "Attendance conversion", margin, 480);
  analytics.drawRectangle({ x: margin, y: 337, width: 507, height: 116, color: rgb(0.97, 0.99, 0.99), borderColor: line, borderWidth: 0.6 });
  analytics.drawText("Confirmed attendees", { x: 67, y: 418, size: 10, font: bold, color: ink });
  analytics.drawText(String(metrics.confirmed), { x: 67, y: 378, size: 30, font: bold, color: blue });
  analytics.drawText("Checked in", { x: 253, y: 418, size: 10, font: bold, color: ink });
  analytics.drawText(String(metrics.checkedIn), { x: 253, y: 378, size: 30, font: bold, color: teal });
  analytics.drawText("No-shows", { x: 413, y: 418, size: 10, font: bold, color: ink });
  analytics.drawText(String(metrics.noShows), { x: 413, y: 378, size: 30, font: bold, color: coral });
  progress(analytics, 67, 352, 413, attendanceRate, teal);
  analytics.drawText(`${percentage(metrics.checkedIn, metrics.confirmed)} of confirmed attendees checked in`, { x: 67, y: 341, size: 9, font: regular, color: muted });

  label(analytics, "Engagement", margin, 296);
  const feedbackRate = metrics.feedbackResponseCount == null || metrics.confirmed === 0 ? 0 : metrics.feedbackResponseCount / metrics.confirmed;
  analytics.drawText("Feedback response rate", { x: margin, y: 258, size: 11, font: bold, color: ink });
  analytics.drawText(metrics.feedbackResponseCount == null ? "Not available for this occurrence" : `${metrics.feedbackResponseCount} responses from ${metrics.confirmed} confirmed attendees`, { x: margin, y: 238, size: 9, font: regular, color: muted });
  if (metrics.feedbackResponseCount != null) {
    progress(analytics, margin, 209, 400, feedbackRate, amber);
    analytics.drawText(percentage(metrics.feedbackResponseCount, metrics.confirmed), { x: 460, y: 205, size: 12, font: bold, color: ink });
  }
  analytics.drawText("Interpret charts alongside event context; counts are aggregates and do not identify attendees.", { x: margin, y: 139, size: 8.5, font: regular, color: muted });
  footer(analytics, 2);
  return pdf.save();
}
