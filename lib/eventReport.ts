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
  const page = pdf.addPage([595.28, 841.89]);
  page.drawRectangle({ x: 0, y: 0, width: 595.28, height: 841.89, color: rgb(1, 1, 1) });
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const navy = rgb(0.08, 0.16, 0.3);
  const muted = rgb(0.34, 0.39, 0.46);
  const line = rgb(0.84, 0.87, 0.91);
  let y = 786;

  const text = (value: string, size = 10, font = regular, color = rgb(0.1, 0.12, 0.15), x = 48) => {
    page.drawText(shorten(value, 92), { x, y, size, font, color });
  };
  const section = (title: string) => {
    y -= 23;
    page.drawLine({ start: { x: 48, y: y + 8 }, end: { x: 547, y: y + 8 }, thickness: 0.8, color: line });
    text(title.toUpperCase(), 9, bold, navy);
    y -= 17;
  };
  const pair = (label: string, value: string) => {
    text(label, 9, bold, muted);
    text(value, 10, regular, rgb(0.1, 0.12, 0.15), 205);
    y -= 18;
  };

  text(cleanPdfText(metrics.organisationName), 11, bold, navy);
  y -= 29;
  text("POST-EVENT REPORT", 20, bold, navy);
  y -= 24;
  text(shorten(metrics.title, 62), 13, bold);
  y -= 23;
  text(`Generated ${dateTime(new Date(), metrics.timeZone)}`, 9, regular, muted);

  section("Event details");
  pair("When", `${dateTime(metrics.startDateTime, metrics.timeZone)} - ${dateTime(metrics.endDateTime, metrics.timeZone)}`);
  pair("Timezone", safeTimeZone(metrics.timeZone));
  pair("Format", metrics.isOnline ? "Online event" : metrics.location ? shorten(metrics.location, 56) : "Location not provided");

  section("Registration");
  pair("Capacity", metrics.capacity == null ? "No capacity limit" : `${metrics.confirmed} of ${metrics.capacity} confirmed (${percentage(metrics.confirmed, metrics.capacity)})`);
  pair("Total registrations", String(metrics.total));
  pair("Confirmed", String(metrics.confirmed));
  pair("Waitlisted", String(metrics.waitlisted));
  pair("Pending approval", String(metrics.pendingApproval));
  pair("Rejected", String(metrics.rejected));

  section("Attendance and engagement");
  pair("Checked in", `${metrics.checkedIn} of ${metrics.confirmed} confirmed (${percentage(metrics.checkedIn, metrics.confirmed)})`);
  pair("No-shows", String(metrics.noShows));
  pair("Recorded invitations", String(metrics.invitationCount));
  pair("Feedback responses", metrics.feedbackResponseCount == null ? "Not collected per recurring occurrence" : String(metrics.feedbackResponseCount));

  page.drawLine({ start: { x: 48, y: 52 }, end: { x: 547, y: 52 }, thickness: 0.8, color: line });
  page.drawText("This report contains aggregate event metrics only.", { x: 48, y: 36, size: 8, font: regular, color: muted });
  return pdf.save();
}
