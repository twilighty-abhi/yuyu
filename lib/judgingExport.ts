import { z } from "zod";
import { RESULTS_SCORE_FILTERS, SUBMISSION_VIEW_FILTERS, type ResultsScoreFilter, type SubmissionViewFilter } from "@/lib/judgingOrganiserPaging";

/*
 * Query strings for `/api/exports/events/:eventId/judging` (docs/HACKATHON.md):
 * the Results and Submissions "Export" links build them from the view they
 * show, and the route parses them back. Pure, safe in client components.
 */

export const JUDGING_EXPORT_VIEWS = ["results", "submissions"] as const;
export type JudgingExportView = (typeof JUDGING_EXPORT_VIEWS)[number];
export type JudgingExportMethod = "RAW" | "ZSCORE";

export type ParsedJudgingExport = {
  view: JudgingExportView;
  query: string;
  /** Submissions only: a status chip, or `notSubmitted` (entrants without a SUBMITTED project). */
  status: SubmissionViewFilter;
  /** Results only: the score chip (ranks never change). */
  scored: ResultsScoreFilter;
  /** Results only; null means the event's saved method. */
  method: JudgingExportMethod | null;
};

const judgingExportParamsSchema = z.object({
  view: z.enum(JUDGING_EXPORT_VIEWS).optional().default("results"),
  q: z.string().trim().max(100).optional().default(""),
  status: z.enum(SUBMISSION_VIEW_FILTERS).optional().default("all"),
  scored: z.enum(RESULTS_SCORE_FILTERS).optional().default("all"),
  method: z.enum(["RAW", "ZSCORE"]).optional(),
});

/** Null for any malformed value (the route answers it with its empty 404). */
export function parseJudgingExportSearchParams(params: URLSearchParams): ParsedJudgingExport | null {
  const parsed = judgingExportParamsSchema.safeParse({
    view: params.get("view") ?? undefined,
    q: params.get("q") ?? undefined,
    status: params.get("status") ?? undefined,
    scored: params.get("scored") ?? undefined,
    method: params.get("method") ?? undefined,
  });
  if (!parsed.success) return null;
  // Each view has its own filters; a parameter of the other view is malformed.
  if (parsed.data.view === "results" && parsed.data.status !== "all") return null;
  if (parsed.data.view === "submissions" && (parsed.data.scored !== "all" || parsed.data.method)) return null;
  return { view: parsed.data.view, query: parsed.data.q, status: parsed.data.status, scored: parsed.data.scored, method: parsed.data.method ?? null };
}

function withQuery(base: string, params: URLSearchParams): string {
  const query = params.toString();
  return query ? `${base}?${query}` : base;
}

/** Judging → Results → Export: the search and score chip showing, and the score method the table ranks by. */
export function judgingResultsExportHref(base: string, view: { query: string; method: JudgingExportMethod; scored?: ResultsScoreFilter }): string {
  const params = new URLSearchParams();
  if (view.query.trim()) params.set("q", view.query.trim());
  if (view.scored && view.scored !== "all") params.set("scored", view.scored);
  params.set("method", view.method);
  return withQuery(base, params);
}

/** Judging → Submissions → Export: the status chip and search showing. */
export function judgingSubmissionsExportHref(base: string, view: { query: string; status: SubmissionViewFilter }): string {
  const params = new URLSearchParams({ view: "submissions" });
  if (view.status !== "all") params.set("status", view.status);
  if (view.query.trim()) params.set("q", view.query.trim());
  return withQuery(base, params);
}
