import type { RegistrationFieldType, RegistrationMode, RsvpStatus } from "@prisma/client";
import { parseFieldSettings, settingsForType } from "@/lib/registrationFields";
import { personDisplayName, type JudgeSubmissionDto } from "@/lib/judgingDto";
import type { OrganiserTeamDto } from "@/lib/core/teams";
import type {
  EventSummaryDto,
  GuestDto,
  JudgeSubmissionMobileDto,
  MyTeamDto,
  OrganiserTeamMobileDto,
  RegistrationFieldDto,
  UserDto,
} from "@/lib/mobile/schemas";

/*
 * Pure mappers from explicit Prisma selections to mobile DTOs. Never spread a
 * Prisma record into a response: every field is named here.
 */

/** Resolve a stored image/link path against the public base URL; reject non-http(s) values. */
export function absoluteUrl(value: string | null | undefined, baseUrl: string): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) return `${baseUrl.replace(/\/$/, "")}${trimmed}`;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

export function toUserDto(user: {
  id: string;
  name: string | null;
  email: string | null;
  image: string | null;
  profileImageUrl: string | null;
  emailVerified: Date | null;
  mfaEnabledAt: Date | null;
}, baseUrl: string): UserDto {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    imageUrl: absoluteUrl(user.profileImageUrl ?? user.image, baseUrl),
    emailVerified: user.emailVerified != null,
    mfaEnabled: user.mfaEnabledAt != null,
  };
}

export const mobileUserSelect = {
  id: true,
  name: true,
  email: true,
  image: true,
  profileImageUrl: true,
  emailVerified: true,
  mfaEnabledAt: true,
} as const;

export const eventSummarySelect = {
  id: true,
  slug: true,
  title: true,
  coverImageUrl: true,
  startDateTime: true,
  endDateTime: true,
  timezone: true,
  location: true,
  mapLinkUrl: true,
  isOnline: true,
  status: true,
  registrationMode: true,
  page: { select: { accentColor: true } },
  organisation: { select: { slug: true, name: true, logoUrl: true } },
} as const;

export type EventSummaryRecord = {
  id: string;
  slug: string;
  title: string;
  coverImageUrl: string | null;
  startDateTime: Date;
  endDateTime: Date;
  timezone: string;
  location: string;
  mapLinkUrl: string | null;
  isOnline: boolean;
  status: EventSummaryDto["status"];
  registrationMode: RegistrationMode;
  page: { accentColor: string | null } | null;
  organisation: { slug: string; name: string; logoUrl: string | null };
};

export function toEventSummary(event: EventSummaryRecord, baseUrl: string): EventSummaryDto {
  return {
    id: event.id,
    slug: event.slug,
    title: event.title,
    coverImageUrl: absoluteUrl(event.coverImageUrl, baseUrl),
    startDateTime: event.startDateTime.toISOString(),
    endDateTime: event.endDateTime.toISOString(),
    timezone: event.timezone,
    location: event.location,
    mapLinkUrl: event.mapLinkUrl,
    isOnline: event.isOnline,
    accentColor: event.page?.accentColor ?? null,
    status: event.status,
    registrationMode: event.registrationMode,
    organisation: {
      slug: event.organisation.slug,
      name: event.organisation.name,
      logoUrl: absoluteUrl(event.organisation.logoUrl, baseUrl),
    },
  };
}

/** Same precedence as the dashboard/check-in label: account name, guest name, email, "Guest". */
export function attendeeDisplayName(rsvp: {
  user: { name: string | null; email: string | null } | null;
  guestName: string | null;
  guestEmail: string | null;
}) {
  return rsvp.user?.name?.trim() || rsvp.guestName?.trim() || rsvp.user?.email || rsvp.guestEmail || "Guest";
}

export const guestRsvpSelect = {
  id: true,
  status: true,
  checkedInAt: true,
  createdAt: true,
  userId: true,
  guestName: true,
  guestEmail: true,
  user: { select: { name: true, email: true } },
  team: { select: { name: true } },
} as const;

export function toGuest(rsvp: {
  id: string;
  status: RsvpStatus;
  checkedInAt: Date | null;
  createdAt: Date;
  userId: string | null;
  guestName: string | null;
  guestEmail: string | null;
  user: { name: string | null; email: string | null } | null;
  team?: { name: string } | null;
}): GuestDto {
  return {
    rsvpId: rsvp.id,
    displayName: attendeeDisplayName(rsvp),
    email: rsvp.user?.email ?? rsvp.guestEmail,
    status: rsvp.status,
    checkedInAt: rsvp.checkedInAt?.toISOString() ?? null,
    registeredAt: rsvp.createdAt.toISOString(),
    isGuest: rsvp.userId == null,
    ...(rsvp.team ? { teamName: rsvp.team.name } : {}),
  };
}

/**
 * The caller's own team for the attendee app: team name, size and members'
 * display names (first name and last initial, the seeker-list rule). Never
 * emails, answers, ticket tokens, or team links.
 */
export function toMyTeam(team: {
  id: string;
  name: string;
  leaderRsvpId: string | null;
  maxSize: number | null;
  members: Array<{ id: string; guestName: string | null; user: { name: string | null } | null }>;
}, myRsvpId: string): MyTeamDto {
  return {
    id: team.id,
    name: team.name,
    role: team.leaderRsvpId === myRsvpId ? "LEADER" : "MEMBER",
    size: team.members.length,
    maxSize: team.maxSize,
    members: team.members.map((member) => ({
      displayName: personDisplayName(member.user?.name?.trim() || member.guestName?.trim() || null),
      isLeader: member.id === team.leaderRsvpId,
    })),
  };
}

/** One team in the organiser Teams list: names and check-in state; no emails (use the guest detail for contact). */
export function toOrganiserTeam(team: OrganiserTeamDto): OrganiserTeamMobileDto {
  const leader = team.members.find((member) => member.isLeader);
  return {
    id: team.id,
    name: team.name,
    status: team.status,
    size: team.size,
    minSize: team.minSize,
    maxSize: team.maxSize,
    incomplete: team.incomplete,
    lookingForMembers: team.lookingForMembers,
    leaderDisplayName: leader?.name ?? null,
    members: team.members.map((member) => ({ rsvpId: member.rsvpId, displayName: member.name, isLeader: member.isLeader, checkedIn: member.checkedIn })),
  };
}

export type MyReviewStatus = "NONE" | "DRAFT" | "SUBMITTED";

/** SUBMITTED once the review is submitted; DRAFT once any score or comment is saved; otherwise NONE. */
export function myReviewStatus(mine: { reviewSubmitted: boolean; scoredCriteria: number; hasReviewRow: boolean }): MyReviewStatus {
  if (mine.reviewSubmitted) return "SUBMITTED";
  return mine.scoredCriteria > 0 || mine.hasReviewRow ? "DRAFT" : "NONE";
}

/** A project for a judge: content and display names only (lib/judgingDto.ts already excludes emails, answers, status reasons and other judges). */
export function toJudgeSubmission(row: JudgeSubmissionDto, hasReviewRow: boolean): JudgeSubmissionMobileDto {
  return {
    id: row.id,
    title: row.title,
    summary: row.summary,
    links: { repo: row.repoUrl, demo: row.demoUrl, video: row.videoUrl },
    entrantName: row.entrantName,
    ...(row.isTeam ? { teamName: row.entrantName } : {}),
    myReview: {
      status: myReviewStatus({ reviewSubmitted: row.reviewSubmitted, scoredCriteria: row.scoredCriteria, hasReviewRow }),
      scoredCriteria: row.scoredCriteria,
    },
  };
}

/** A stored registration/feedback question as the app renders it (mirrors `toFieldDefinition`). */
export function toRegistrationField(field: {
  id: string;
  key: string;
  label: string;
  type: RegistrationFieldType;
  required: boolean;
  options: unknown;
  helpText?: string | null;
  placeholder?: string | null;
  settings?: unknown;
}): RegistrationFieldDto {
  const settings = settingsForType(field.type, parseFieldSettings(field.settings));
  const { showIf, ...rest } = settings;
  return {
    id: field.id,
    key: field.key,
    label: field.label,
    type: field.type,
    required: field.required,
    helpText: field.helpText?.trim() ? field.helpText : null,
    placeholder: field.placeholder?.trim() ? field.placeholder : null,
    options: Array.isArray(field.options) ? field.options.filter((value): value is string => typeof value === "string") : [],
    settings: rest,
    showIf: showIf ? { fieldKey: showIf.fieldKey, values: [...showIf.values] } : null,
  };
}
