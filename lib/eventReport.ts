import "server-only";

import type { EventPrivacyType, RegistrationFieldType, RsvpStatus, SponsorTier } from "@prisma/client";
import { prisma } from "@/lib/db";

export { createEventReportPdf } from "@/lib/eventReportPdf";

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

/** One question from a registration or feedback form, reduced to counts. */
export type ReportQuestion = {
  label: string;
  type: RegistrationFieldType;
  /** People who answered it. */
  answered: number;
  /** Per-option counts for choice questions; null for free-text, number, date, email and phone. */
  choices: Array<{ label: string; count: number }> | null;
};

export type ReportSession = { title: string; type: string; track: string; start: Date; end: Date; delayMinutes: number; speakers: string[] };
export type ReportSpeaker = { name: string; detail: string };
export type ReportSponsor = { name: string; tier: SponsorTier };
export type ReportBroadcast = { subject: string; sentAt: Date; recipientCount: number };
export type ReportCheckInSources = { organiser: number; offline: number; station: number };

/**
 * TEAM events (docs/TEAMS.md): team and solo counts only. Never team names,
 * members or "looking for a team" profiles.
 */
export type ReportTeamMetrics = {
  /** Teams with at least one registration. */
  teams: number;
  /** Teams that had a place (confirmed). */
  confirmedTeams: number;
  /** Registrations without a team. */
  soloRegistrants: number;
  /** Solo registrants who had a place; with `confirmedTeams`, the units filled. */
  confirmedSoloRegistrants: number;
  /** Average people per team, one decimal; 0 with no teams. */
  averageTeamSize: number;
};

/**
 * Everything the PDF shows. Attendee data is reduced to counts and timestamps
 * before it gets here: no names, emails, tickets or written answers.
 */
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
  accentColor?: string | null;
  privacyType?: EventPrivacyType;
  tags?: string[];
  tagline?: string;
  venueName?: string;
  registrationClosesAt?: Date | null;
  /** When each registration was made, for the sign-up timeline. */
  signupDates?: Date[];
  /** When each confirmed guest was checked in. */
  checkInTimes?: Date[];
  checkInSources?: ReportCheckInSources | null;
  registrationQuestions?: ReportQuestion[];
  feedbackTitle?: string;
  feedbackQuestions?: ReportQuestion[];
  certificatesEnabled?: boolean;
  sessions?: ReportSession[];
  speakers?: ReportSpeaker[];
  sponsors?: ReportSponsor[];
  resourceCount?: number;
  broadcasts?: ReportBroadcast[];
  coOrganiserCount?: number;
  /** Set for TEAM events only. */
  teams?: ReportTeamMetrics | null;
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

/** Team counts from each registration's team and status. Rejected registrations are left out. */
export function calculateReportTeamMetrics(rsvps: Array<{ status: RsvpStatus; teamId: string | null }>): ReportTeamMetrics {
  const sizes = new Map<string, number>();
  const confirmed = new Set<string>();
  let soloRegistrants = 0;
  let confirmedSoloRegistrants = 0;
  for (const rsvp of rsvps) {
    if (rsvp.status === "REJECTED") continue;
    if (!rsvp.teamId) {
      soloRegistrants += 1;
      if (rsvp.status === "CONFIRMED") confirmedSoloRegistrants += 1;
      continue;
    }
    sizes.set(rsvp.teamId, (sizes.get(rsvp.teamId) ?? 0) + 1);
    if (rsvp.status === "CONFIRMED") confirmed.add(rsvp.teamId);
  }
  const members = [...sizes.values()].reduce((sum, size) => sum + size, 0);
  return {
    teams: sizes.size,
    confirmedTeams: confirmed.size,
    soloRegistrants,
    confirmedSoloRegistrants,
    averageTeamSize: sizes.size ? Math.round((members / sizes.size) * 10) / 10 : 0,
  };
}

export function isReportAvailable(endDateTime: Date, now = new Date()) {
  return endDateTime.getTime() < now.getTime();
}

const CHOICE_TYPES = new Set<RegistrationFieldType>(["SELECT", "RADIO", "MULTI_SELECT", "CHECKBOX"]);

function optionsFromJson(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((option): option is string => typeof option === "string" && option.trim().length > 0) : [];
}

type QuestionField = { id: string; label: string; type: RegistrationFieldType; options: unknown };
type QuestionAnswer = { fieldId: string | null; respondentId: string; valueText: string | null; valueBool: boolean | null };

/**
 * Reduces form answers to counts. Choice questions get per-option counts;
 * anything typed in ("Other", free text, email, phone) is only counted, never
 * copied, so the report cannot leak what someone wrote.
 */
export function summariseQuestions(fields: QuestionField[], answers: QuestionAnswer[]): ReportQuestion[] {
  return fields.map((field) => {
    const own = answers.filter((answer) => answer.fieldId === field.id);
    const answered = new Set(own.filter((answer) => answer.valueBool !== null || (answer.valueText ?? "").trim()).map((answer) => answer.respondentId)).size;
    if (!CHOICE_TYPES.has(field.type)) return { label: field.label, type: field.type, answered, choices: null };

    if (field.type === "CHECKBOX") {
      const yes = own.filter((answer) => answer.valueBool === true).length;
      const no = own.filter((answer) => answer.valueBool === false).length;
      return { label: field.label, type: field.type, answered, choices: [{ label: "Yes", count: yes }, { label: "No", count: no }] };
    }

    const options = optionsFromJson(field.options);
    const counts = new Map(options.map((option) => [option, 0]));
    let other = 0;
    for (const answer of own) {
      const value = (answer.valueText ?? "").trim();
      if (!value) continue;
      if (counts.has(value)) counts.set(value, counts.get(value)! + 1);
      else other += 1;
    }
    const choices = [...counts].map(([label, count]) => ({ label, count }));
    if (other > 0) choices.push({ label: "Other", count: other });
    return { label: field.label, type: field.type, answered, choices };
  });
}

/** Counts each checked-in guest once, by the device that last checked them in. */
export function countCheckInSources(sources: Array<string | null>): ReportCheckInSources {
  const result: ReportCheckInSources = { organiser: 0, offline: 0, station: 0 };
  for (const source of sources) {
    if (source === "venue-station") result.station += 1;
    else if (source === "offline-sync") result.offline += 1;
    else result.organiser += 1;
  }
  return result;
}

function speakerDetail(headline: string, organisation: string) {
  return [headline.trim(), organisation.trim()].filter(Boolean).join(" · ");
}

export async function getEventReportMetrics(eventId: string): Promise<EventReportMetrics | null> {
  const published = { visibility: "PUBLISHED" } as const;
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
      privacyType: true,
      tags: true,
      registrationClosesAt: true,
      registrationMode: true,
      organisation: { select: { id: true, name: true } },
      page: { select: { accentColor: true, tagline: true } },
      venue: { select: { name: true, visibility: true } },
      rsvps: {
        select: {
          id: true,
          status: true,
          checkedInAt: true,
          createdAt: true,
          teamId: true,
          answers: { select: { fieldId: true, valueText: true, valueBool: true } },
          checkInEvents: { where: { action: "CHECKED_IN" }, orderBy: { occurredAt: "desc" }, take: 1, select: { source: true } },
        },
      },
      registrationForm: { select: { fields: { orderBy: { sortOrder: "asc" }, select: { id: true, label: true, type: true, options: true } } } },
      feedbackForm: {
        select: {
          title: true,
          certificateEnabled: true,
          fields: { orderBy: { sortOrder: "asc" }, select: { id: true, label: true, type: true, options: true } },
          responses: { select: { id: true, answers: { select: { fieldId: true, valueText: true, valueBool: true } } } },
        },
      },
      sessions: {
        where: published,
        orderBy: [{ startDateTime: "asc" }, { sortOrder: "asc" }],
        select: {
          title: true,
          type: true,
          startDateTime: true,
          endDateTime: true,
          delayMinutes: true,
          track: { select: { name: true } },
          speakers: { orderBy: { sortOrder: "asc" }, select: { speaker: { select: { name: true, visibility: true } } } },
        },
      },
      speakers: { where: published, orderBy: { sortOrder: "asc" }, select: { name: true, headline: true, organisation: true } },
      sponsors: { where: published, orderBy: [{ tier: "asc" }, { sortOrder: "asc" }], select: { name: true, tier: true } },
      resources: { where: published, select: { id: true } },
      broadcasts: { orderBy: { createdAt: "asc" }, select: { subject: true, createdAt: true, recipientCount: true } },
      _count: { select: { invites: true, collaborators: true } },
    },
  });
  if (!event) return null;

  const confirmed = event.rsvps.filter((rsvp) => rsvp.status === "CONFIRMED");
  const checkedIn = confirmed.filter((rsvp) => rsvp.checkedInAt);
  const registrationAnswers = confirmed.flatMap((rsvp) => rsvp.answers.map((answer) => ({ ...answer, respondentId: rsvp.id })));
  const feedbackAnswers = event.feedbackForm?.responses.flatMap((response) => response.answers.map((answer) => ({ ...answer, respondentId: response.id }))) ?? [];

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
    feedbackResponseCount: event.feedbackForm?.responses.length ?? 0,
    accentColor: event.page?.accentColor ?? null,
    privacyType: event.privacyType,
    tags: event.tags,
    tagline: event.page?.tagline ?? "",
    venueName: event.venue?.visibility === "PUBLISHED" ? event.venue.name : "",
    registrationClosesAt: event.registrationClosesAt,
    signupDates: event.rsvps.map((rsvp) => rsvp.createdAt),
    checkInTimes: checkedIn.map((rsvp) => rsvp.checkedInAt!),
    checkInSources: countCheckInSources(checkedIn.map((rsvp) => rsvp.checkInEvents[0]?.source ?? null)),
    registrationQuestions: summariseQuestions(event.registrationForm?.fields ?? [], registrationAnswers),
    feedbackTitle: event.feedbackForm?.title ?? "",
    feedbackQuestions: summariseQuestions(event.feedbackForm?.fields ?? [], feedbackAnswers),
    certificatesEnabled: event.feedbackForm?.certificateEnabled ?? false,
    sessions: event.sessions.map((session) => ({
      title: session.title,
      type: session.type,
      track: session.track.name,
      start: session.startDateTime,
      end: session.endDateTime,
      delayMinutes: session.delayMinutes,
      speakers: session.speakers.filter(({ speaker }) => speaker.visibility === "PUBLISHED").map(({ speaker }) => speaker.name),
    })),
    speakers: event.speakers.map((speaker) => ({ name: speaker.name, detail: speakerDetail(speaker.headline, speaker.organisation) })),
    sponsors: event.sponsors,
    resourceCount: event.resources.length,
    broadcasts: event.broadcasts.map((broadcast) => ({ subject: broadcast.subject, sentAt: broadcast.createdAt, recipientCount: broadcast.recipientCount })),
    coOrganiserCount: event._count.collaborators,
    teams: event.registrationMode === "TEAM" ? calculateReportTeamMetrics(event.rsvps) : null,
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
      rsvps: {
        select: {
          status: true,
          checkedInAt: true,
          createdAt: true,
          checkInEvents: { where: { action: "CHECKED_IN" }, orderBy: { occurredAt: "desc" }, take: 1, select: { source: true } },
        },
      },
      series: {
        select: {
          id: true,
          title: true,
          timezone: true,
          capacity: true,
          privacyType: true,
          organisation: { select: { id: true, name: true } },
          _count: { select: { invites: true, collaborators: true } },
        },
      },
    },
  });
  if (!instance) return null;

  const checkedIn = instance.rsvps.filter((rsvp) => rsvp.status === "CONFIRMED" && rsvp.checkedInAt);

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
    privacyType: instance.series.privacyType,
    signupDates: instance.rsvps.map((rsvp) => rsvp.createdAt),
    checkInTimes: checkedIn.map((rsvp) => rsvp.checkedInAt!),
    checkInSources: countCheckInSources(checkedIn.map((rsvp) => rsvp.checkInEvents[0]?.source ?? null)),
    coOrganiserCount: instance.series._count.collaborators,
    ...calculateReportRsvpMetrics(instance.rsvps),
  };
}

export function reportFilename(metrics: EventReportMetrics) {
  const slug = metrics.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 72) || "event";
  const date = metrics.startDateTime.toISOString().slice(0, 10);
  return `${slug}-${metrics.targetType}-report-${date}.pdf`;
}
