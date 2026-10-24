import { z } from "zod";

/*
 * Paging for the organiser Judging tab (docs/HACKATHON.md), as pure
 * functions so the rules are unit tested without a database
 * (tests/unit/judging-organiser-paging.test.ts):
 *
 * - Submissions: keyset "Load more" on (createdAt, id), oldest first, with the
 *   status filter and the search applied in SQL (lib/core/judging.ts). The
 *   cursor is the shared `<epoch ms>.<id>` time cursor (lib/keysetCursor.ts).
 * - Results: the ranking is always computed over every project, so ties share
 *   a rank across page boundaries; only the display is sliced into numbered
 *   pages, and a search filters the ranked rows without renumbering them.
 * - Award candidates: the same ranking, SUBMITTED projects only, in short
 *   offset steps for the winner picker.
 */

/** Projects per "Load more" page on Judging → Submissions. */
export const ORGANISER_SUBMISSIONS_PAGE_SIZE = 50;
/** Rows per numbered page on Judging → Results. */
export const JUDGING_RESULTS_PAGE_SIZE = 50;
/** Projects per "Show more" step in the Awards winner picker. */
export const AWARD_CANDIDATES_PAGE_SIZE = 20;

const SEARCH_MAX_LENGTH = 100;
/** Highest page a client can ask for (keeps a forged number from doing silly work). */
const MAX_PAGE = 10_000;

export const ORGANISER_SUBMISSION_FILTERS = ["all", "DRAFT", "SUBMITTED", "WITHDRAWN", "DISQUALIFIED"] as const;
export type OrganiserSubmissionFilter = (typeof ORGANISER_SUBMISSION_FILTERS)[number];

export const organiserSubmissionsQuerySchema = z
  .object({
    query: z.string().trim().max(SEARCH_MAX_LENGTH).optional().default(""),
    status: z.enum(ORGANISER_SUBMISSION_FILTERS).optional().default("all"),
    cursor: z.string().trim().max(160).nullable().optional(),
  })
  .strict();

export const judgingResultsQuerySchema = z
  .object({
    query: z.string().trim().max(SEARCH_MAX_LENGTH).optional().default(""),
    page: z.number().int().min(1).max(MAX_PAGE).optional().default(1),
  })
  .strict();

export const awardCandidatesQuerySchema = z
  .object({
    query: z.string().trim().max(SEARCH_MAX_LENGTH).optional().default(""),
    offset: z.number().int().min(0).max(MAX_PAGE * AWARD_CANDIDATES_PAGE_SIZE).optional().default(0),
  })
  .strict();

/** Case-insensitive substring match on a project's title or entrant name (an empty query matches all). */
export function matchesProjectQuery(row: { title: string; entrantName: string }, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return true;
  return row.title.toLocaleLowerCase().includes(needle) || row.entrantName.toLocaleLowerCase().includes(needle);
}

export type NumberedPage<T> = {
  rows: T[];
  /** 1-based, clamped into 1..totalPages (1 when there are no rows). */
  page: number;
  totalPages: number;
  /** Rows across every page (after any search). */
  total: number;
  /** 0-based index of the first row on this page, for "Showing x–y of N". */
  start: number;
  pageSize: number;
};

/** One numbered page of an already ordered list. A page past the end shows the last page. */
export function numberedPage<T>(rows: readonly T[], page: number, pageSize: number): NumberedPage<T> {
  const size = Math.max(1, Math.floor(pageSize));
  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / size));
  const safePage = Math.min(Math.max(1, Math.floor(Number.isFinite(page) ? page : 1)), totalPages);
  const start = (safePage - 1) * size;
  return { rows: rows.slice(start, start + size), page: safePage, totalPages, total, start, pageSize: size };
}

export type OffsetPage<T> = { rows: T[]; total: number; nextOffset: number | null };

/** One "Show more" step of an already ordered list. */
export function offsetPage<T>(rows: readonly T[], offset: number, pageSize: number): OffsetPage<T> {
  const start = Math.max(0, Math.floor(Number.isFinite(offset) ? offset : 0));
  const end = start + Math.max(1, Math.floor(pageSize));
  return { rows: rows.slice(start, end), total: rows.length, nextOffset: end < rows.length ? end : null };
}

/** "Showing ranks 51–100 of 294" wording for a numbered page (empty pages say so). */
export function numberedPageLabel(page: Pick<NumberedPage<unknown>, "start" | "total"> & { shown: number }, noun: string): string {
  if (page.total === 0 || page.shown === 0) return `No ${noun}`;
  return `Showing ${page.start + 1}–${page.start + page.shown} of ${page.total} ${noun}`;
}
