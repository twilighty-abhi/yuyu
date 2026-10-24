import "server-only";

import type { EventPermission, MembershipRole, RsvpStatus } from "@prisma/client";
import { prisma } from "@/lib/db";

/**
 * Per-collection safety cap. A personal export is the user's own data, so the
 * caps are generous; `truncated` tells the reader when one was reached.
 */
export const ACCOUNT_EXPORT_LIMIT = 2000;

export const ACCOUNT_EXPORT_FORMAT_VERSION = 1;

type AnswerValue = { valueText: string | null; valueBool: boolean | null; valueNumber: number | null; valueDate: Date | null };

/* ---------- Raw input shapes (exactly what the loader selects) ---------- */

export type AccountExportSource = {
  user: {
    name: string | null;
    email: string | null;
    emailVerified: Date | null;
    createdAt: Date;
    mfaEnabledAt: Date | null;
  };
  signInProviders: Array<{ provider: string }>;
  memberships: Array<{ role: MembershipRole; createdAt: Date; organisation: { name: string; slug: string } }>;
  registrations: Array<{
    /** Used only to tell whether the user leads their team; never exported. */
    id?: string;
    status: RsvpStatus;
    createdAt: Date;
    checkedInAt: Date | null;
    event: { title: string; startDateTime: Date; endDateTime: Date; timezone: string; organisation: { name: string } } | null;
    eventInstance: { startDateTime: Date; endDateTime: Date; series: { title: string; timezone: string; organisation: { name: string } } } | null;
    answers: Array<AnswerValue & { field: { label: string } }>;
    /** TEAM events: the user's team (name and who leads it). */
    team?: { name: string; leaderRsvpId: string | null } | null;
  }>;
  feedback: Array<{
    submittedAt: Date;
    certificateToken: string | null;
    form: { event: { title: string; organisation: { name: string } } };
    answers: Array<AnswerValue & { fieldLabel: string }>;
  }>;
  collaborations: Array<{
    permissions: EventPermission[];
    createdAt: Date;
    event: { title: string; organisation: { name: string } } | null;
    series: { title: string; organisation: { name: string } } | null;
  }>;
};

function iso(value: Date | null | undefined) {
  return value ? value.toISOString() : null;
}

function answerValue(answer: AnswerValue): string | boolean | number | null {
  if (answer.valueText != null) return answer.valueText;
  if (answer.valueBool != null) return answer.valueBool;
  if (answer.valueNumber != null) return answer.valueNumber;
  if (answer.valueDate != null) return answer.valueDate.toISOString().slice(0, 10);
  return null;
}

/**
 * Shape the export with explicit allow-listed fields only. Never spread a
 * source object: password hashes, MFA seeds, recovery codes, OAuth tokens,
 * session data and ticket/certificate/invite tokens must not reach the file.
 */
export function buildAccountDataExport(source: AccountExportSource, generatedAt: Date = new Date()) {
  const cap = <T,>(list: T[]) => list.slice(0, ACCOUNT_EXPORT_LIMIT);
  return {
    formatVersion: ACCOUNT_EXPORT_FORMAT_VERSION,
    generatedAt: generatedAt.toISOString(),
    profile: {
      name: source.user.name,
      email: source.user.email,
      emailVerified: Boolean(source.user.emailVerified),
      emailVerifiedAt: iso(source.user.emailVerified),
      accountCreatedAt: source.user.createdAt.toISOString(),
      twoFactorAuthenticationEnabled: Boolean(source.user.mfaEnabledAt),
      linkedSignInProviders: [...new Set(source.signInProviders.map((account) => account.provider))].sort(),
    },
    memberships: cap(source.memberships).map((membership) => ({
      organisation: membership.organisation.name,
      organisationSlug: membership.organisation.slug,
      role: membership.role,
      joinedAt: membership.createdAt.toISOString(),
    })),
    registrations: cap(source.registrations).flatMap((rsvp) => {
      const occurrence = rsvp.event
        ? { kind: "event" as const, title: rsvp.event.title, organisation: rsvp.event.organisation.name, start: rsvp.event.startDateTime, end: rsvp.event.endDateTime, timeZone: rsvp.event.timezone }
        : rsvp.eventInstance
          ? { kind: "series_occurrence" as const, title: rsvp.eventInstance.series.title, organisation: rsvp.eventInstance.series.organisation.name, start: rsvp.eventInstance.startDateTime, end: rsvp.eventInstance.endDateTime, timeZone: rsvp.eventInstance.series.timezone }
          : null;
      if (!occurrence) return [];
      return [{
        event: occurrence.title,
        organisation: occurrence.organisation,
        type: occurrence.kind,
        startsAt: occurrence.start.toISOString(),
        endsAt: occurrence.end.toISOString(),
        timeZone: occurrence.timeZone,
        status: rsvp.status,
        registeredAt: rsvp.createdAt.toISOString(),
        checkedInAt: iso(rsvp.checkedInAt),
        team: rsvp.team?.name ?? null,
        teamRole: rsvp.team ? (rsvp.id != null && rsvp.team.leaderRsvpId === rsvp.id ? "leader" : "member") : null,
        answers: rsvp.answers.map((answer) => ({ question: answer.field.label, answer: answerValue(answer) })),
      }];
    }),
    feedback: cap(source.feedback).map((response) => ({
      event: response.form.event.title,
      organisation: response.form.event.organisation.name,
      submittedAt: response.submittedAt.toISOString(),
      certificateIssued: Boolean(response.certificateToken),
      answers: response.answers.map((answer) => ({ question: answer.fieldLabel, answer: answerValue(answer) })),
    })),
    eventCollaborations: cap(source.collaborations).flatMap((collaboration) => {
      const target = collaboration.event ?? collaboration.series;
      if (!target) return [];
      return [{
        event: target.title,
        organisation: target.organisation.name,
        type: collaboration.event ? "event" : "series",
        permissions: [...collaboration.permissions],
        addedAt: collaboration.createdAt.toISOString(),
      }];
    }),
    truncated: {
      memberships: source.memberships.length > ACCOUNT_EXPORT_LIMIT,
      registrations: source.registrations.length > ACCOUNT_EXPORT_LIMIT,
      feedback: source.feedback.length > ACCOUNT_EXPORT_LIMIT,
      eventCollaborations: source.collaborations.length > ACCOUNT_EXPORT_LIMIT,
    },
  };
}

export type AccountDataExport = ReturnType<typeof buildAccountDataExport>;

const answerSelect = { valueText: true, valueBool: true, valueNumber: true, valueDate: true } as const;

/**
 * Load only the signed-in user's own rows. Every query is keyed on `userId`
 * (directly or through the user's own RSVP) and fetches one row beyond the cap
 * so truncation can be reported. Selects are explicit; no secret column is read.
 */
export async function loadAccountExportSource(userId: string): Promise<AccountExportSource | null> {
  const take = ACCOUNT_EXPORT_LIMIT + 1;
  const [user, signInProviders, memberships, registrations, feedback, collaborations] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { name: true, email: true, emailVerified: true, createdAt: true, mfaEnabledAt: true },
    }),
    prisma.account.findMany({ where: { userId }, select: { provider: true }, take: 20 }),
    prisma.membership.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
      take,
      select: { role: true, createdAt: true, organisation: { select: { name: true, slug: true } } },
    }),
    prisma.rSVP.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take,
      select: {
        id: true,
        status: true,
        createdAt: true,
        checkedInAt: true,
        // Team name and leader only; join and management tokens are never read.
        team: { select: { name: true, leaderRsvpId: true } },
        event: { select: { title: true, startDateTime: true, endDateTime: true, timezone: true, organisation: { select: { name: true } } } },
        eventInstance: { select: { startDateTime: true, endDateTime: true, series: { select: { title: true, timezone: true, organisation: { select: { name: true } } } } } },
        answers: { select: { ...answerSelect, field: { select: { label: true } } }, orderBy: { field: { sortOrder: "asc" } }, take: 200 },
      },
    }),
    prisma.eventFeedbackResponse.findMany({
      where: { rsvp: { is: { userId } } },
      orderBy: { submittedAt: "desc" },
      take,
      select: {
        submittedAt: true,
        // Read only to report whether a certificate exists; the value is never exported.
        certificateToken: true,
        form: { select: { event: { select: { title: true, organisation: { select: { name: true } } } } } },
        answers: { select: { ...answerSelect, fieldLabel: true }, orderBy: { createdAt: "asc" }, take: 200 },
      },
    }),
    prisma.eventCollaborator.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
      take,
      select: {
        permissions: true,
        createdAt: true,
        event: { select: { title: true, organisation: { select: { name: true } } } },
        series: { select: { title: true, organisation: { select: { name: true } } } },
      },
    }),
  ]);
  if (!user) return null;
  return { user, signInProviders, memberships, registrations, feedback, collaborations };
}
