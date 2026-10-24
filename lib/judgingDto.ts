import type { JudgingStatus, SubmissionStatus } from "@prisma/client";

/*
 * Read-model DTOs for hackathon judging (docs/HACKATHON.md). Each mapper
 * copies an explicit allow-list of fields, so extra columns on a Prisma row
 * (emails, tokens, RSVP or user ids, scores, organiser notes) never leak into
 * a page. Unit tested for forbidden fields in tests/unit/judging-dto.test.ts.
 *
 * Who sees what:
 * - Public results and gallery: project content and entrant display names.
 * - Judges: project content and entrant display names, plus their own scores.
 * - Entrants: their own submission, never the disqualification reason.
 * - Organisers (owner/admin): everything above plus status, reasons, and
 *   judge comments, still without entrant emails or ticket links.
 */

export type EntrantNameSource = {
  team: { name: string } | null;
  rsvp: { guestName: string | null; user: { name: string | null } | null } | null;
};

/** First name plus last initial ("Ada L."), never an email. Same rule as the seeker list. */
export function personDisplayName(fullName: string | null | undefined): string {
  const parts = (fullName ?? "").replace(/[\u0000-\u001F\u007F<>]+/g, " ").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "Participant";
  const first = parts[0]!.slice(0, 40);
  if (parts.length === 1) return first;
  const initial = Array.from(parts[parts.length - 1]!)[0]!.toUpperCase();
  return `${first} ${initial}.`;
}

/** The team name, or a solo entrant's display name. */
export function entrantDisplayName(source: EntrantNameSource): string {
  if (source.team) return source.team.name;
  const person = source.rsvp;
  return personDisplayName(person?.user?.name?.trim() || person?.guestName?.trim() || null);
}

export type ProjectLinks = { repoUrl: string | null; demoUrl: string | null; videoUrl: string | null };

type ProjectRow = EntrantNameSource & ProjectLinks & { id: string; title: string; summary: string };

/** A project on the public gallery (`/{org}/{event}/projects`). */
export type PublicGalleryItemDto = ProjectLinks & { id: string; title: string; summary: string; entrantName: string; isTeam: boolean };

export function publicGalleryItemDto(row: ProjectRow): PublicGalleryItemDto {
  return {
    id: row.id,
    title: row.title,
    summary: row.summary,
    entrantName: entrantDisplayName(row),
    isTeam: row.team != null,
    repoUrl: row.repoUrl,
    demoUrl: row.demoUrl,
    videoUrl: row.videoUrl,
  };
}

/** A winner on the public results page: never a score or a judge comment. */
export type PublicWinnerDto = ProjectLinks & { place: number; title: string; entrantName: string; isTeam: boolean };

export function publicWinnerDto(row: { place: number; submission: Omit<ProjectRow, "id" | "summary"> }): PublicWinnerDto {
  return {
    place: row.place,
    title: row.submission.title,
    entrantName: entrantDisplayName(row.submission),
    isTeam: row.submission.team != null,
    repoUrl: row.submission.repoUrl,
    demoUrl: row.submission.demoUrl,
    videoUrl: row.submission.videoUrl,
  };
}

export type PublicAwardDto = { name: string; description: string; winners: PublicWinnerDto[] };

export type PublicResultsDto = { publishedAt: Date; awards: PublicAwardDto[] };

export type PublicGalleryDto = { projects: PublicGalleryItemDto[] };

/** A submission as a judge sees it. */
export type JudgeSubmissionDto = ProjectLinks & {
  id: string;
  title: string;
  summary: string;
  entrantName: string;
  isTeam: boolean;
  /** Criteria this judge has scored so far. */
  scoredCriteria: number;
  /** This judge's review is submitted (counts towards the result). */
  reviewSubmitted: boolean;
};

export function judgeSubmissionDto(row: ProjectRow, mine: { scoredCriteria: number; reviewSubmitted: boolean }): JudgeSubmissionDto {
  return {
    ...publicGalleryItemDto(row),
    scoredCriteria: mine.scoredCriteria,
    reviewSubmitted: mine.reviewSubmitted,
  };
}

export type JudgingCriterionDto = { id: string; name: string; description: string; weight: number; maxScore: number };

export function judgingCriterionDto(row: JudgingCriterionDto): JudgingCriterionDto {
  return { id: row.id, name: row.name, description: row.description, weight: row.weight, maxScore: row.maxScore };
}

export type JudgeWorkspaceDto = {
  judgingStatus: JudgingStatus;
  criteria: JudgingCriterionDto[];
  submissions: JudgeSubmissionDto[];
};

export type JudgeSubmissionDetailDto = {
  judgingStatus: JudgingStatus;
  criteria: JudgingCriterionDto[];
  submission: JudgeSubmissionDto;
  myScores: Array<{ criterionId: string; score: number }>;
  myReview: { comment: string; submittedAt: Date | null } | null;
};

/** The entrant's own submission (team page, ticket page, or `/submit/{token}`). */
export type EntrantSubmissionDto = {
  entrantName: string;
  isTeam: boolean;
  eventTitle: string;
  timezone: string;
  window: { opensAt: Date | null; closesAt: Date | null; isOpen: boolean };
  /** The entrant is CONFIRMED (only confirmed entrants can submit). */
  confirmed: boolean;
  /** The organisers declined the team or registration (REJECTED): final, never editable. */
  declined: boolean;
  canEdit: boolean;
  submission: (ProjectLinks & { title: string; summary: string; status: SubmissionStatus; submittedAt: Date | null }) | null;
};

export function entrantSubmissionView(row: (ProjectLinks & { title: string; summary: string; status: SubmissionStatus; submittedAt: Date | null }) | null): EntrantSubmissionDto["submission"] {
  if (!row) return null;
  return {
    title: row.title,
    summary: row.summary,
    repoUrl: row.repoUrl,
    demoUrl: row.demoUrl,
    videoUrl: row.videoUrl,
    status: row.status,
    submittedAt: row.submittedAt,
  };
}

/** Organiser list row. Organisers see status and the disqualification reason, never entrant emails. */
export type OrganiserSubmissionDto = ProjectLinks & {
  id: string;
  title: string;
  summary: string;
  entrantName: string;
  isTeam: boolean;
  status: SubmissionStatus;
  submittedAt: Date | null;
  updatedAt: Date;
  disqualifiedReason: string | null;
  assignedJudgeIds: string[];
};

export function organiserSubmissionDto(
  row: ProjectRow & { status: SubmissionStatus; submittedAt: Date | null; updatedAt: Date; disqualifiedReason: string | null },
  assignedJudgeIds: string[],
): OrganiserSubmissionDto {
  return {
    ...publicGalleryItemDto(row),
    status: row.status,
    submittedAt: row.submittedAt,
    updatedAt: row.updatedAt,
    disqualifiedReason: row.disqualifiedReason,
    assignedJudgeIds,
  };
}
