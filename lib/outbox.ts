import "server-only";

import { OutboxStatus, Prisma, RsvpStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { sendApprovalNotification, sendCollaboratorInvitation, sendEventBroadcast, sendEventInvitation, sendResultsPublishedEmail, sendRSVPConfirmation, sendSubmissionLinkEmail, sendSubmissionReceivedEmail, sendTeamCreatedEmail, sendTeamMemberAddedEmail } from "@/lib/email";
import { hashSubmissionLinkToken, isSubmissionTokenShape, resultsPath, submissionLinkPath } from "@/lib/submissionToken";
import { hashTeamManageToken, isTeamTokenShape, teamJoinPath, teamManagePath } from "@/lib/teamToken";
import { broadcastHtmlToText, formatBroadcastEventDate, renderBroadcastHtml, renderBroadcastTemplate, sampleBroadcastVariables } from "@/lib/broadcastTemplate";
import { broadcastBrandFor, broadcastBrandSelect, broadcastEventUrl, broadcastFeedbackUrl, broadcastScheduleUrl, broadcastTicketUrl, rsvpMatchesBroadcastAudience } from "@/lib/eventBroadcast";
import { isBroadcastDesign } from "@/lib/email/broadcastDesigns";
import { sendPasswordResetEmail } from "@/lib/email/passwordReset";
import { sendEmailVerificationEmail } from "@/lib/email/emailVerification";
import { describeOperationalError } from "@/lib/redactSensitiveText";
import { reportOpsAlert } from "@/lib/opsAlerts";

type OutboxClient = Prisma.TransactionClient | typeof prisma;

type RsvpConfirmationPayload = {
  to: string;
  eventTitle: string;
  status: RsvpStatus;
  checkInToken: string;
  /** Set for registrations on a TEAM event that belong to a team. */
  teamName?: string;
};

type RsvpStatusPayload = {
  to: string;
  eventTitle: string;
  approved: boolean;
  checkInToken?: string;
  recipientName?: string;
  /** Team status changes email each member, naming the team. */
  teamName?: string;
};

/**
 * Team page link for a (new) team leader. Carries the raw management token,
 * which exists nowhere else; the message is dropped if the team was deleted
 * or the token rotated before delivery. Team name and join link are read at
 * send time.
 */
export type TeamCreatedPayload = {
  to: string;
  teamId: string;
  manageToken: string;
  /** "created": a new team; "leader": leadership passed to this member. */
  reason?: "created" | "leader";
};

/** A member the leader added: their own ticket link, resolved at send time from the token. */
export type TeamMemberAddedPayload = {
  to: string;
  checkInToken: string;
  addedByName?: string;
};

/**
 * Hackathon submission confirmation to the person who submitted. Event and
 * project titles are read at send time; the message is dropped when the
 * submission is gone or no longer SUBMITTED.
 */
export type SubmissionReceivedPayload = { to: string; submissionId: string; recipientName?: string };

/**
 * A solo registrant's `/submit/{token}` link, sent only to the RSVP's own
 * address. Carries the raw token (a capability), which exists nowhere else;
 * dropped when the link was regenerated or the registration removed.
 */
export type SubmissionLinkPayload = { to: string; rsvpId: string; token: string };

/** Results announcement per confirmed entrant member; dropped if results were unpublished before delivery. */
export type ResultsPublishedPayload = { to: string; eventId: string; recipientName?: string };

type PasswordResetPayload = {
  to: string;
  resetUrl: string;
  expiresAt: string;
};

type EventInvitePayload = {
  to: string;
  eventTitle: string;
  organisationName: string;
  orgSlug: string;
  eventSlug: string;
  expiresAt?: string;
};

type EmailVerificationPayload = {
  to: string;
  verificationUrl: string;
  expiresAt: string;
};
type CollaboratorInvitePayload = { to: string; eventTitle: string; inviteUrl: string; expiresAt?: string };

/** Per-recipient broadcast row. The template and ticket link are resolved at send time, so the queue never stores capabilities. */
type EventBroadcastPayload = { to: string; broadcastId: string; rsvpId: string };

type EventBroadcastTestPayload = { to: string; eventId: string; subject: string; body: string; design?: string; recipientName?: string };

export async function enqueueEventBroadcastRecipients(client: OutboxClient, recipients: EventBroadcastPayload[]) {
  if (recipients.length === 0) return { count: 0 };
  return client.outboxMessage.createMany({
    data: recipients.map((payload) => ({ kind: "event-broadcast", payload: payload as Prisma.InputJsonValue })),
  });
}

export async function enqueueEventBroadcastTest(client: OutboxClient, payload: EventBroadcastTestPayload) {
  return client.outboxMessage.create({ data: { kind: "event-broadcast-test", payload: payload as Prisma.InputJsonValue } });
}

export async function enqueueCollaboratorInvite(client: OutboxClient, payload: CollaboratorInvitePayload) { return client.outboxMessage.create({ data: { kind: "collaborator-invite", payload: payload as Prisma.InputJsonValue } }); }

export async function enqueueRsvpConfirmation(
  client: OutboxClient,
  payload: RsvpConfirmationPayload,
) {
  return client.outboxMessage.create({
    data: {
      kind: "rsvp-confirmation",
      payload: payload as Prisma.InputJsonValue,
    },
  });
}

export async function enqueueRsvpStatusNotification(
  client: OutboxClient,
  payload: RsvpStatusPayload,
) {
  return client.outboxMessage.create({
    data: {
      kind: "rsvp-status",
      payload: payload as Prisma.InputJsonValue,
    },
  });
}

export async function enqueueTeamCreated(client: OutboxClient, payload: TeamCreatedPayload) {
  return client.outboxMessage.create({ data: { kind: "team-created", payload: payload as Prisma.InputJsonValue } });
}

export async function enqueueTeamMemberAdded(client: OutboxClient, payload: TeamMemberAddedPayload) {
  return client.outboxMessage.create({ data: { kind: "team-member-added", payload: payload as Prisma.InputJsonValue } });
}

export async function enqueueSubmissionReceived(client: OutboxClient, payload: SubmissionReceivedPayload) {
  return client.outboxMessage.create({ data: { kind: "submission-received", payload: payload as Prisma.InputJsonValue } });
}

export async function enqueueSubmissionLink(client: OutboxClient, payload: SubmissionLinkPayload) {
  return client.outboxMessage.create({ data: { kind: "submission-link", payload: payload as Prisma.InputJsonValue } });
}

export async function enqueueResultsPublished(client: OutboxClient, payloads: ResultsPublishedPayload[]) {
  if (payloads.length === 0) return { count: 0 };
  return client.outboxMessage.createMany({
    data: payloads.map((payload) => ({ kind: "results-published", payload: payload as Prisma.InputJsonValue })),
  });
}

export async function enqueuePasswordReset(
  client: OutboxClient,
  payload: PasswordResetPayload,
) {
  return client.outboxMessage.create({
    data: {
      kind: "password-reset",
      payload: payload as Prisma.InputJsonValue,
    },
  });
}

export async function enqueueEventInvite(
  client: OutboxClient,
  payload: EventInvitePayload,
) {
  return client.outboxMessage.create({
    data: {
      kind: "event-invite",
      payload: payload as Prisma.InputJsonValue,
    },
  });
}

export async function enqueueEmailVerification(
  client: OutboxClient,
  payload: EmailVerificationPayload,
) {
  return client.outboxMessage.create({
    data: { kind: "email-verification", payload: payload as Prisma.InputJsonValue },
  });
}

function isBoundedString(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}

function isEmail(value: unknown): value is string {
  return isBoundedString(value, 320) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isIsoDate(value: unknown): value is string {
  return isBoundedString(value, 64) && !Number.isNaN(Date.parse(value));
}

function isSafeMessageUrl(value: unknown): value is string {
  if (!isBoundedString(value, 2048)) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || (process.env.NODE_ENV !== "production" && url.protocol === "http:");
  } catch {
    return false;
  }
}

function isExpired(expiresAt: string | undefined, now = new Date()) {
  return expiresAt !== undefined && new Date(expiresAt) <= now;
}

function containsCapability(kind: string, payload: Prisma.JsonValue) {
  if (["rsvp-confirmation", "password-reset", "email-verification", "collaborator-invite", "team-created", "team-member-added", "submission-link"].includes(kind)) return true;
  return kind === "rsvp-status" && Boolean(payload && typeof payload === "object" && !Array.isArray(payload) && typeof (payload as Record<string, unknown>).checkInToken === "string");
}

function messageId(id: string) {
  return `<yuyu-${id}@outbox.invalid>`;
}

function retryDelayMs(kind: string, attempts: number) {
  const exponentialDelay = 2 ** attempts * 60_000;
  // Verification and reset capabilities expire after one hour. Retrying them
  // on the normal 32/60-minute cadence can leave most of the configured
  // attempts unusable, so keep their retries within the capability lifetime.
  const maximumDelay = kind === "password-reset" || kind === "email-verification"
    ? 8 * 60_000
    : 60 * 60_000;
  return Math.min(maximumDelay, exponentialDelay);
}

class PermanentOutboxError extends Error {
  override name = "PermanentOutboxError";
}

function asRsvpConfirmationPayload(value: Prisma.JsonValue): RsvpConfirmationPayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const payload = value as Record<string, unknown>;
  if (
    !isEmail(payload.to) ||
    !isBoundedString(payload.eventTitle, 200) ||
    !isBoundedString(payload.checkInToken, 128) ||
    !Object.values(RsvpStatus).includes(payload.status as RsvpStatus) ||
    (payload.teamName !== undefined && !isBoundedString(payload.teamName, 200))
  ) {
    return null;
  }
  return payload as RsvpConfirmationPayload;
}

export function asTeamCreatedPayload(value: Prisma.JsonValue): TeamCreatedPayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const payload = value as Record<string, unknown>;
  if (
    !isEmail(payload.to) ||
    !isBoundedString(payload.teamId, 64) ||
    !isTeamTokenShape(payload.manageToken) ||
    (payload.reason !== undefined && payload.reason !== "created" && payload.reason !== "leader")
  ) return null;
  return payload as TeamCreatedPayload;
}

export function asTeamMemberAddedPayload(value: Prisma.JsonValue): TeamMemberAddedPayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const payload = value as Record<string, unknown>;
  if (
    !isEmail(payload.to) ||
    !isBoundedString(payload.checkInToken, 128) ||
    (payload.addedByName !== undefined && !isBoundedString(payload.addedByName, 200))
  ) return null;
  return payload as TeamMemberAddedPayload;
}

export function asSubmissionReceivedPayload(value: Prisma.JsonValue): SubmissionReceivedPayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const payload = value as Record<string, unknown>;
  if (
    !isEmail(payload.to) ||
    !isBoundedString(payload.submissionId, 64) ||
    (payload.recipientName !== undefined && !isBoundedString(payload.recipientName, 200))
  ) return null;
  return payload as SubmissionReceivedPayload;
}

export function asSubmissionLinkPayload(value: Prisma.JsonValue): SubmissionLinkPayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const payload = value as Record<string, unknown>;
  if (!isEmail(payload.to) || !isBoundedString(payload.rsvpId, 64) || !isSubmissionTokenShape(payload.token)) return null;
  return payload as SubmissionLinkPayload;
}

export function asResultsPublishedPayload(value: Prisma.JsonValue): ResultsPublishedPayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const payload = value as Record<string, unknown>;
  if (
    !isEmail(payload.to) ||
    !isBoundedString(payload.eventId, 64) ||
    (payload.recipientName !== undefined && !isBoundedString(payload.recipientName, 200))
  ) return null;
  return payload as ResultsPublishedPayload;
}

function asRsvpStatusPayload(value: Prisma.JsonValue): RsvpStatusPayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const payload = value as Record<string, unknown>;
  if (
    !isEmail(payload.to) ||
    !isBoundedString(payload.eventTitle, 200) ||
    typeof payload.approved !== "boolean" ||
    (payload.approved && !isBoundedString(payload.checkInToken, 128)) ||
    (payload.checkInToken !== undefined && !isBoundedString(payload.checkInToken, 128)) ||
    (payload.recipientName !== undefined && !isBoundedString(payload.recipientName, 200)) ||
    (payload.teamName !== undefined && !isBoundedString(payload.teamName, 200))
  ) return null;
  return payload as RsvpStatusPayload;
}

async function getCurrentRsvp(checkInToken: string) {
  return prisma.rSVP.findUnique({
    where: { checkInToken },
    select: {
      status: true,
      guestName: true,
      user: { select: { name: true } },
      event: { select: { startDateTime: true, endDateTime: true, timezone: true, location: true } },
      eventInstance: { select: { startDateTime: true, endDateTime: true, series: { select: { timezone: true } } } },
    },
  });
}

function calendarEvent(rsvp: Awaited<ReturnType<typeof getCurrentRsvp>>) {
  if (rsvp?.event) {
    return rsvp.event;
  }
  if (rsvp?.eventInstance) {
    return {
      startDateTime: rsvp.eventInstance.startDateTime,
      endDateTime: rsvp.eventInstance.endDateTime,
      timezone: rsvp.eventInstance.series.timezone,
    };
  }
  return undefined;
}

function attendeeName(rsvp: Awaited<ReturnType<typeof getCurrentRsvp>>) {
  return rsvp?.user?.name?.trim() || rsvp?.guestName?.trim() || undefined;
}

function asPasswordResetPayload(value: Prisma.JsonValue): PasswordResetPayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const payload = value as Record<string, unknown>;
  if (
    !isEmail(payload.to) ||
    !isSafeMessageUrl(payload.resetUrl) ||
    !isIsoDate(payload.expiresAt)
  ) return null;
  return payload as PasswordResetPayload;
}

function asEventInvitePayload(value: Prisma.JsonValue): EventInvitePayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const payload = value as Record<string, unknown>;
  if (
    !isEmail(payload.to) ||
    !isBoundedString(payload.eventTitle, 200) ||
    !isBoundedString(payload.organisationName, 120) ||
    !isBoundedString(payload.orgSlug, 64) ||
    !isBoundedString(payload.eventSlug, 64) ||
    (payload.expiresAt !== undefined && !isIsoDate(payload.expiresAt))
  ) return null;
  return payload as EventInvitePayload;
}

function asEmailVerificationPayload(value: Prisma.JsonValue): EmailVerificationPayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const payload = value as Record<string, unknown>;
  if (!isEmail(payload.to) || !isSafeMessageUrl(payload.verificationUrl) || !isIsoDate(payload.expiresAt)) return null;
  return payload as EmailVerificationPayload;
}
function asEventBroadcastPayload(value: Prisma.JsonValue): EventBroadcastPayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const payload = value as Record<string, unknown>;
  if (!isEmail(payload.to) || !isBoundedString(payload.broadcastId, 64) || !isBoundedString(payload.rsvpId, 64)) return null;
  return payload as EventBroadcastPayload;
}

function asEventBroadcastTestPayload(value: Prisma.JsonValue): EventBroadcastTestPayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const payload = value as Record<string, unknown>;
  if (
    !isEmail(payload.to) ||
    !isBoundedString(payload.eventId, 64) ||
    !isBoundedString(payload.subject, 150) ||
    !isBoundedString(payload.body, 20000) ||
    (payload.recipientName !== undefined && !isBoundedString(payload.recipientName, 200)) ||
    (payload.design !== undefined && !isBroadcastDesign(payload.design))
  ) return null;
  return payload as EventBroadcastTestPayload;
}

const broadcastEventSelect = {
  title: true,
  slug: true,
  startDateTime: true,
  timezone: true,
  location: true,
  isOnline: true,
  ...broadcastBrandSelect,
  organisation: { select: { name: true, slug: true, logoUrl: true } },
} as const;

type BroadcastEvent = {
  title: string;
  slug: string;
  startDateTime: Date;
  timezone: string;
  location: string;
  isOnline: boolean;
  organisation: { name: string; slug: string; logoUrl: string | null };
};

function broadcastVariablesFor(event: BroadcastEvent, recipient: { name?: string | null; ticketUrl?: string | null }) {
  const eventUrl = broadcastEventUrl(event.organisation.slug, event.slug);
  return {
    name: recipient.name,
    event: event.title,
    eventDate: formatBroadcastEventDate(event.startDateTime, event.timezone),
    location: event.isOnline ? "Online" : (event.location.trim() || "the venue"),
    eventUrl,
    ticketLink: recipient.ticketUrl ?? eventUrl,
    feedbackUrl: broadcastFeedbackUrl(event.organisation.slug, event.slug),
    scheduleUrl: broadcastScheduleUrl(event.organisation.slug, event.slug),
    organisation: event.organisation.name,
  };
}

function asCollaboratorInvitePayload(value: Prisma.JsonValue): CollaboratorInvitePayload | null { if (!value || typeof value !== "object" || Array.isArray(value)) return null; const p = value as Record<string, unknown>; return isEmail(p.to) && isBoundedString(p.eventTitle, 200) && isSafeMessageUrl(p.inviteUrl) && (p.expiresAt === undefined || isIsoDate(p.expiresAt)) ? p as CollaboratorInvitePayload : null; }

/** Deliver a small batch. Run this from a protected scheduler, never a request path. */
export async function deliverOutboxBatch(limit = 20) {
  // A worker may be interrupted after claiming a message. Return a stale claim
  // to the retry queue before processing new work so messages cannot be lost.
  await prisma.outboxMessage.updateMany({
    where: {
      status: OutboxStatus.PROCESSING,
      lockedAt: { lt: new Date(Date.now() - 15 * 60_000) },
    },
    data: { status: OutboxStatus.PENDING, lockedAt: null },
  });

  const messages = await prisma.outboxMessage.findMany({
    where: { status: OutboxStatus.PENDING, availableAt: { lte: new Date() } },
    orderBy: { createdAt: "asc" },
    take: Math.min(Math.max(limit, 1), 100),
  });

  let sent = 0;
  let failed = 0;
  for (const message of messages) {
    const claimTime = new Date();
    const claim = await prisma.outboxMessage.updateMany({
      where: { id: message.id, status: OutboxStatus.PENDING },
      data: { status: OutboxStatus.PROCESSING, lockedAt: claimTime, attempts: { increment: 1 } },
    });
    if (claim.count !== 1) continue;

    try {
      const removeAfterDelivery = containsCapability(message.kind, message.payload);
      const stableMessageId = messageId(message.id);
      if (message.kind === "rsvp-confirmation") {
        const payload = asRsvpConfirmationPayload(message.payload);
        if (!payload) throw new PermanentOutboxError();
        const rsvp = await getCurrentRsvp(payload.checkInToken);
        if (rsvp?.status !== payload.status) {
          await prisma.outboxMessage.deleteMany({ where: { id: message.id, status: OutboxStatus.PROCESSING, lockedAt: claimTime } });
          continue;
        }
        await sendRSVPConfirmation({ ...payload, recipientName: attendeeName(rsvp), calendarEvent: calendarEvent(rsvp), messageId: stableMessageId });
      } else if (message.kind === "rsvp-status") {
        const payload = asRsvpStatusPayload(message.payload);
        if (!payload) throw new PermanentOutboxError();
        if (payload.approved) {
          const rsvp = await getCurrentRsvp(payload.checkInToken!);
          if (rsvp?.status !== RsvpStatus.CONFIRMED) {
            await prisma.outboxMessage.deleteMany({ where: { id: message.id, status: OutboxStatus.PROCESSING, lockedAt: claimTime } });
            continue;
          }
          await sendRSVPConfirmation({
            to: payload.to,
            eventTitle: payload.eventTitle,
            status: RsvpStatus.CONFIRMED,
            checkInToken: payload.checkInToken,
            recipientName: attendeeName(rsvp),
            calendarEvent: calendarEvent(rsvp),
            teamName: payload.teamName,
            messageId: stableMessageId,
          });
        } else {
          await sendApprovalNotification({ ...payload, messageId: stableMessageId });
        }
      } else if (message.kind === "team-created") {
        const payload = asTeamCreatedPayload(message.payload);
        if (!payload) throw new PermanentOutboxError();
        const team = await prisma.team.findUnique({
          where: { id: payload.teamId },
          select: {
            name: true,
            joinToken: true,
            manageTokenHash: true,
            event: { select: { title: true, slug: true, organisation: { select: { slug: true } } } },
            leaderRsvp: { select: { guestName: true, user: { select: { name: true } } } },
          },
        });
        // The team was deleted, or the link was regenerated (or leadership
        // moved on) before delivery: never send a link that no longer works.
        if (!team || team.manageTokenHash !== hashTeamManageToken(payload.manageToken)) {
          await prisma.outboxMessage.deleteMany({ where: { id: message.id, status: OutboxStatus.PROCESSING, lockedAt: claimTime } });
          continue;
        }
        await sendTeamCreatedEmail({
          to: payload.to,
          eventTitle: team.event.title,
          teamName: team.name,
          managePath: teamManagePath(payload.manageToken),
          joinPath: teamJoinPath(team.event.organisation.slug, team.event.slug, team.joinToken),
          reason: payload.reason ?? "created",
          recipientName: team.leaderRsvp?.user?.name?.trim() || team.leaderRsvp?.guestName?.trim() || undefined,
          messageId: stableMessageId,
        });
      } else if (message.kind === "team-member-added") {
        const payload = asTeamMemberAddedPayload(message.payload);
        if (!payload) throw new PermanentOutboxError();
        const rsvp = await prisma.rSVP.findUnique({
          where: { checkInToken: payload.checkInToken },
          select: {
            status: true,
            guestName: true,
            user: { select: { name: true } },
            event: { select: { title: true } },
            team: { select: { name: true } },
          },
        });
        if (!rsvp?.event || !rsvp.team) {
          await prisma.outboxMessage.deleteMany({ where: { id: message.id, status: OutboxStatus.PROCESSING, lockedAt: claimTime } });
          continue;
        }
        await sendTeamMemberAddedEmail({
          to: payload.to,
          eventTitle: rsvp.event.title,
          teamName: rsvp.team.name,
          status: rsvp.status,
          checkInToken: payload.checkInToken,
          addedByName: payload.addedByName,
          recipientName: rsvp.user?.name?.trim() || rsvp.guestName?.trim() || undefined,
          messageId: stableMessageId,
        });
      } else if (message.kind === "submission-received") {
        const payload = asSubmissionReceivedPayload(message.payload);
        if (!payload) throw new PermanentOutboxError();
        const submission = await prisma.submission.findUnique({
          where: { id: payload.submissionId },
          select: {
            status: true,
            title: true,
            team: { select: { name: true } },
            event: { select: { title: true, slug: true, organisation: { select: { slug: true } } } },
          },
        });
        if (!submission || submission.status !== "SUBMITTED") {
          await prisma.outboxMessage.deleteMany({ where: { id: message.id, status: OutboxStatus.PROCESSING, lockedAt: claimTime } });
          continue;
        }
        await sendSubmissionReceivedEmail({
          to: payload.to,
          eventTitle: submission.event.title,
          projectTitle: submission.title,
          teamName: submission.team?.name,
          eventPath: `/${encodeURIComponent(submission.event.organisation.slug)}/${encodeURIComponent(submission.event.slug)}`,
          recipientName: payload.recipientName,
          messageId: stableMessageId,
        });
      } else if (message.kind === "submission-link") {
        const payload = asSubmissionLinkPayload(message.payload);
        if (!payload) throw new PermanentOutboxError();
        const link = await prisma.submissionLink.findUnique({
          where: { rsvpId: payload.rsvpId },
          select: {
            tokenHash: true,
            rsvp: { select: { teamId: true, guestName: true, user: { select: { name: true } }, event: { select: { title: true } } } },
          },
        });
        // Regenerated, removed, or the registrant joined a team since: never
        // send a link that no longer works.
        if (!link || link.tokenHash !== hashSubmissionLinkToken(payload.token) || !link.rsvp.event || link.rsvp.teamId) {
          await prisma.outboxMessage.deleteMany({ where: { id: message.id, status: OutboxStatus.PROCESSING, lockedAt: claimTime } });
          continue;
        }
        await sendSubmissionLinkEmail({
          to: payload.to,
          eventTitle: link.rsvp.event.title,
          submitPath: submissionLinkPath(payload.token),
          recipientName: link.rsvp.user?.name?.trim() || link.rsvp.guestName?.trim() || undefined,
          messageId: stableMessageId,
        });
      } else if (message.kind === "results-published") {
        const payload = asResultsPublishedPayload(message.payload);
        if (!payload) throw new PermanentOutboxError();
        const event = await prisma.event.findUnique({
          where: { id: payload.eventId },
          select: { title: true, slug: true, resultsPublishedAt: true, organisation: { select: { slug: true } } },
        });
        if (!event?.resultsPublishedAt) {
          await prisma.outboxMessage.deleteMany({ where: { id: message.id, status: OutboxStatus.PROCESSING, lockedAt: claimTime } });
          continue;
        }
        await sendResultsPublishedEmail({
          to: payload.to,
          eventTitle: event.title,
          resultsPath: resultsPath(event.organisation.slug, event.slug),
          recipientName: payload.recipientName,
          messageId: stableMessageId,
        });
      } else if (message.kind === "password-reset") {
        const payload = asPasswordResetPayload(message.payload);
        if (!payload) throw new PermanentOutboxError();
        if (isExpired(payload.expiresAt)) {
          await prisma.outboxMessage.deleteMany({ where: { id: message.id, status: OutboxStatus.PROCESSING, lockedAt: claimTime } });
          failed += 1;
          continue;
        }
        await sendPasswordResetEmail({ ...payload, messageId: stableMessageId });
      } else if (message.kind === "email-verification") {
        const payload = asEmailVerificationPayload(message.payload);
        if (!payload) throw new PermanentOutboxError();
        if (isExpired(payload.expiresAt)) {
          await prisma.outboxMessage.deleteMany({ where: { id: message.id, status: OutboxStatus.PROCESSING, lockedAt: claimTime } });
          failed += 1;
          continue;
        }
        await sendEmailVerificationEmail({ ...payload, messageId: stableMessageId });
      } else if (message.kind === "event-invite") {
        const payload = asEventInvitePayload(message.payload);
        if (!payload) throw new PermanentOutboxError();
        if (isExpired(payload.expiresAt)) {
          await prisma.outboxMessage.deleteMany({ where: { id: message.id, status: OutboxStatus.PROCESSING, lockedAt: claimTime } });
          failed += 1;
          continue;
        }
        await sendEventInvitation({ ...payload, messageId: stableMessageId });
      } else if (message.kind === "collaborator-invite") {
        const payload = asCollaboratorInvitePayload(message.payload);
        if (!payload) throw new PermanentOutboxError();
        if (isExpired(payload.expiresAt)) {
          await prisma.outboxMessage.deleteMany({ where: { id: message.id, status: OutboxStatus.PROCESSING, lockedAt: claimTime } });
          failed += 1;
          continue;
        }
        await sendCollaboratorInvitation({ ...payload, messageId: stableMessageId });
      } else if (message.kind === "event-broadcast") {
        const payload = asEventBroadcastPayload(message.payload);
        if (!payload) throw new PermanentOutboxError();
        const [broadcast, rsvp] = await Promise.all([
          prisma.eventBroadcast.findUnique({
            where: { id: payload.broadcastId },
            select: { subject: true, body: true, design: true, statuses: true, attendance: true, eventId: true, event: { select: broadcastEventSelect } },
          }),
          prisma.rSVP.findUnique({
            where: { id: payload.rsvpId },
            select: { eventId: true, status: true, checkedInAt: true, checkInToken: true, guestName: true, user: { select: { name: true } } },
          }),
        ]);
        // The broadcast or registration was removed, or the registration no
        // longer belongs to the audience it was selected for. Drop silently
        // rather than sending wording that no longer applies.
        if (!broadcast || !rsvp || rsvp.eventId !== broadcast.eventId || !rsvpMatchesBroadcastAudience(rsvp, broadcast)) {
          await prisma.outboxMessage.deleteMany({ where: { id: message.id, status: OutboxStatus.PROCESSING, lockedAt: claimTime } });
          continue;
        }
        const variables = broadcastVariablesFor(broadcast.event, {
          name: rsvp.user?.name?.trim() || rsvp.guestName?.trim() || null,
          ticketUrl: rsvp.status === RsvpStatus.CONFIRMED ? broadcastTicketUrl(rsvp.checkInToken) : null,
        });
        const bodyHtml = renderBroadcastHtml(broadcast.body, variables);
        await sendEventBroadcast({
          to: payload.to,
          subject: renderBroadcastTemplate(broadcast.subject, variables),
          bodyHtml,
          bodyText: broadcastHtmlToText(bodyHtml),
          eventTitle: broadcast.event.title,
          organisationName: broadcast.event.organisation.name,
          design: isBroadcastDesign(broadcast.design) ? broadcast.design : undefined,
          brand: broadcastBrandFor(broadcast.event),
          messageId: stableMessageId,
        });
      } else if (message.kind === "event-broadcast-test") {
        const payload = asEventBroadcastTestPayload(message.payload);
        if (!payload) throw new PermanentOutboxError();
        const event = await prisma.event.findUnique({ where: { id: payload.eventId }, select: broadcastEventSelect });
        if (!event) {
          await prisma.outboxMessage.deleteMany({ where: { id: message.id, status: OutboxStatus.PROCESSING, lockedAt: claimTime } });
          continue;
        }
        const variables = sampleBroadcastVariables({
          title: event.title,
          startDateTime: event.startDateTime,
          timezone: event.timezone,
          location: event.location,
          isOnline: event.isOnline,
          eventUrl: broadcastEventUrl(event.organisation.slug, event.slug),
          organisationName: event.organisation.name,
        }, payload.recipientName ?? null);
        // If the organiser receiving the test is confirmed for this event themselves,
        // the ticket button opens their own ticket, so the whole flow can be checked.
        // (Tests only ever go to the signed-in organiser's own verified address.)
        const ownRsvp = await prisma.rSVP.findFirst({
          where: {
            eventId: payload.eventId,
            status: RsvpStatus.CONFIRMED,
            OR: [{ user: { email: { equals: payload.to, mode: "insensitive" } } }, { guestEmail: { equals: payload.to, mode: "insensitive" } }],
          },
          select: { checkInToken: true },
        });
        if (ownRsvp) variables.ticketLink = broadcastTicketUrl(ownRsvp.checkInToken);
        const bodyHtml = renderBroadcastHtml(payload.body, variables);
        await sendEventBroadcast({
          to: payload.to,
          subject: `[Test] ${renderBroadcastTemplate(payload.subject, variables)}`,
          bodyHtml,
          bodyText: broadcastHtmlToText(bodyHtml),
          eventTitle: event.title,
          organisationName: event.organisation.name,
          design: isBroadcastDesign(payload.design) ? payload.design : undefined,
          brand: broadcastBrandFor(event),
          messageId: stableMessageId,
        });
      } else {
        throw new PermanentOutboxError();
      }
      if (removeAfterDelivery) {
        await prisma.outboxMessage.deleteMany({ where: { id: message.id, status: OutboxStatus.PROCESSING, lockedAt: claimTime } });
      } else {
        await prisma.outboxMessage.updateMany({
          where: { id: message.id, status: OutboxStatus.PROCESSING, lockedAt: claimTime },
          data: { status: OutboxStatus.SENT, sentAt: new Date(), lockedAt: null, lastError: null },
        });
      }
      sent += 1;
    } catch (error) {
      const attempts = message.attempts + 1;
      const retryAt = new Date(Date.now() + retryDelayMs(message.kind, attempts));
      const terminal = error instanceof PermanentOutboxError || attempts >= 8;
      if (containsCapability(message.kind, message.payload) && terminal) {
        await prisma.outboxMessage.deleteMany({ where: { id: message.id, status: OutboxStatus.PROCESSING, lockedAt: claimTime } });
      } else {
        await prisma.outboxMessage.updateMany({
          where: { id: message.id, status: OutboxStatus.PROCESSING, lockedAt: claimTime },
          data: {
            status: terminal ? OutboxStatus.FAILED : OutboxStatus.PENDING,
            availableAt: retryAt,
            lockedAt: null,
            lastError: describeOperationalError(error),
          },
        });
      }
      reportOpsAlert({
        level: terminal ? "error" : "warning",
        source: "email",
        title: terminal ? "Email delivery failed permanently" : "Email delivery failed; will retry",
        error,
        context: { kind: message.kind, attempt: attempts },
      });
      failed += 1;
    }
  }
  return { sent, failed };
}
