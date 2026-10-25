import { z } from "zod";

/*
 * Paging rules for the judge workspace list and the public project gallery
 * (docs/HACKATHON.md). Pure helpers, shared by the judging core, the Server
 * Action, and the pages, and unit tested in tests/unit/judging-paging.test.ts.
 *
 * The judge list is ordered `submittedAt ASC, id ASC`. A SUBMITTED
 * submission always has a `submittedAt` (database CHECK
 * `Submission_submitted_has_time`), so the order is total and the judge list
 * can page on that key. The gallery pages by number over one of
 * `GALLERY_SORTS` (lib/galleryQuery.ts), each ending in `id`.
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

/**
 * Public gallery views (`?filter=`). `winners`: projects that won an award;
 * offered only once results are published, so it never reveals winners early.
 */
export const GALLERY_FILTERS = ["all", "winners"] as const;
export type GalleryFilter = (typeof GALLERY_FILTERS)[number];

/**
 * Public gallery orders (`?sort=`), each ending in an `id` tiebreak.
 * `newest`: latest submission first. `az`: project title A–Z. `awards`:
 * winners by award position then place, then the rest A–Z (results published
 * only).
 */
export const GALLERY_SORTS = ["newest", "az", "awards"] as const;
export type GallerySort = (typeof GALLERY_SORTS)[number];

export const DEFAULT_GALLERY_FILTER: GalleryFilter = "all";
export const DEFAULT_GALLERY_SORT: GallerySort = "newest";

/** One gallery listing as named by its URL. */
export type GalleryView = { page: number; query: string; filter: GalleryFilter; sort: GallerySort };

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * `?filter=` for the gallery. Anything unknown, and `winners` before results
 * are published, falls back to `all`.
 */
export function parseGalleryFilterParam(value: string | string[] | undefined, resultsPublished: boolean): GalleryFilter {
  const raw = firstParam(value);
  if (raw === "winners" && resultsPublished) return "winners";
  return DEFAULT_GALLERY_FILTER;
}

/**
 * `?sort=` for the gallery. Anything unknown, and `awards` before results
 * are published, falls back to `newest`.
 */
export function parseGallerySortParam(value: string | string[] | undefined, resultsPublished: boolean): GallerySort {
  const raw = firstParam(value);
  if (raw === "az") return "az";
  if (raw === "awards" && resultsPublished) return "awards";
  return DEFAULT_GALLERY_SORT;
}

/** Every gallery search param, validated; invalid values fall back to the defaults. */
export function parseGalleryParams(searchParams: { [key: string]: string | string[] | undefined }, resultsPublished: boolean): GalleryView {
  return {
    page: parsePageParam(searchParams.page),
    query: parseSearchParam(searchParams.q),
    filter: parseGalleryFilterParam(searchParams.filter, resultsPublished),
    sort: parseGallerySortParam(searchParams.sort, resultsPublished),
  };
}

/** True when the view narrows or reorders the list (its canonical URL is the plain gallery). */
export function isFilteredGalleryView(view: Pick<GalleryView, "query" | "filter" | "sort">): boolean {
  return view.query !== "" || view.filter !== DEFAULT_GALLERY_FILTER || view.sort !== DEFAULT_GALLERY_SORT;
}

/**
 * Gallery link for a view, keeping URLs short: defaults (page 1, no search,
 * all projects, newest first) add nothing.
 */
export function galleryHref(basePath: string, view: Partial<GalleryView> = {}): string {
  const params = new URLSearchParams();
  if (view.query) params.set("q", view.query);
  if (view.filter && view.filter !== DEFAULT_GALLERY_FILTER) params.set("filter", view.filter);
  if (view.sort && view.sort !== DEFAULT_GALLERY_SORT) params.set("sort", view.sort);
  if (view.page && view.page > 1) params.set("page", String(Math.floor(view.page)));
  const search = params.toString();
  return search ? `${basePath}?${search}` : basePath;
}
