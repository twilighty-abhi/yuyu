import { z } from "zod";

/*
 * Paging rules for the judge workspace list and the public project gallery
 * (docs/HACKATHON.md). Pure helpers, shared by the judging core, the Server
 * Action, and the pages, and unit tested in tests/unit/judging-paging.test.ts.
 *
 * Both lists are ordered `submittedAt ASC, id ASC`. A SUBMITTED submission
 * always has a `submittedAt` (database CHECK `Submission_submitted_has_time`),
 * so the order is total and the judge list can page on that key.
 */

/** Submissions per "Load more" page in the judge workspace. */
export const JUDGE_SUBMISSIONS_PAGE_SIZE = 25;

/** Projects per page on the public gallery (`?page=N`). */
export const PROJECT_GALLERY_PAGE_SIZE = 24;

/** Longest search text accepted by either list. */
export const JUDGING_SEARCH_MAX_LENGTH = 100;

/**
 * Judge workspace views. `todo`: no submitted review from this judge yet
 * (includes `in_progress`). `in_progress`: scored at least one criterion, not
 * submitted. `reviewed`: review submitted.
 */
export const JUDGE_SUBMISSION_FILTERS = ["all", "todo", "in_progress", "reviewed"] as const;
export type JudgeSubmissionFilter = (typeof JUDGE_SUBMISSION_FILTERS)[number];

export type JudgeSubmissionCounts = Record<JudgeSubmissionFilter, number>;

/** Opaque keyset cursor: the last submission's submission time (ms) and id. */
export function encodeSubmissionCursor(row: { submittedAt: Date; id: string }): string {
  return `${row.submittedAt.getTime()}.${row.id}`;
}

export function decodeSubmissionCursor(cursor: string): { submittedAt: Date; id: string } | null {
  const match = /^(\d{1,15})\.([A-Za-z0-9_-]{1,128})$/.exec(cursor);
  if (!match) return null;
  const submittedAt = new Date(Number(match[1]));
  return Number.isNaN(submittedAt.getTime()) ? null : { submittedAt, id: match[2]! };
}

export const judgeSubmissionsQuerySchema = z
  .object({
    query: z.string().trim().max(JUDGING_SEARCH_MAX_LENGTH).optional().default(""),
    filter: z.enum(JUDGE_SUBMISSION_FILTERS).optional().default("all"),
    cursor: z.string().trim().max(160).nullable().optional(),
  })
  .strict();

export type JudgeSubmissionsQuery = z.input<typeof judgeSubmissionsQuerySchema>;

/** `?page=` as a whole number of at least 1; anything else is page 1. */
export function parsePageParam(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw || !/^\d{1,6}$/.test(raw)) return 1;
  return Math.max(1, Number(raw));
}

/** `?q=` trimmed, with runs of whitespace collapsed, and bounded. */
export function parseSearchParam(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value;
  return (raw ?? "").replace(/\s+/g, " ").trim().slice(0, JUDGING_SEARCH_MAX_LENGTH);
}

/** Total pages for `total` items (at least 1, so an empty list still has page 1). */
export function totalPagesFor(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(Math.max(0, total) / pageSize));
}

/** The requested page clamped to the pages that exist. */
export function clampPage(page: number, totalPages: number): number {
  return Math.min(Math.max(1, Math.floor(page) || 1), Math.max(1, totalPages));
}

/** Gallery link for a page and search, keeping URLs short (page 1 and no search add nothing). */
export function galleryHref(basePath: string, page: number, query: string): string {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (page > 1) params.set("page", String(page));
  const search = params.toString();
  return search ? `${basePath}?${search}` : basePath;
}
