import { auth } from "@/lib/auth";
import { recordAuditEvent } from "@/lib/audit";
import { planJudgingResultsExport, planJudgingSubmissionsExport } from "@/lib/core/judging";
import { csvStreamResponse, exportFilename, exportFilterNames, exportNotFound } from "@/lib/csvExport";
import { prisma } from "@/lib/db";
import { resolveJudgingOrganiser } from "@/lib/judgingAccess";
import { parseJudgingExportSearchParams } from "@/lib/judgingExport";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/*
 * Judging CSVs (docs/HACKATHON.md): organisation OWNER/ADMIN only, the same
 * check as the organiser judging actions. Anyone else, and any malformed
 * parameter, gets the same bare 404 as a missing event.
 *
 * - Results (default, or `view=results`): one row per judge review with the
 *   rank and result score, judge names but no emails, comments, entrant
 *   emails, or ticket links. `q` keeps the ranked rows matching the Results
 *   search (ranks stay those of the whole ranking); `method` (RAW or ZSCORE)
 *   is the score method the table is showing, the saved one when omitted;
 *   `scored` is the score chip (unscored, underTwo).
 * - Submissions (`view=submissions`): one row per project matching the
 *   Submissions view's `status` filter and `q` search; `status=notSubmitted`
 *   lists the entrants without a submitted project instead.
 *
 * Both stream in bounded batches; every cell goes through buildCsv, which
 * neutralises spreadsheet formulas. The audit records the surface and the
 * filter names, never the search text.
 */

const MAX_EVENT_ID_LENGTH = 128;

type RouteContext = { params: Promise<{ eventId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return exportNotFound();

  const { eventId } = await context.params;
  if (!eventId || eventId.length > MAX_EVENT_ID_LENGTH) return exportNotFound();
  const view = parseJudgingExportSearchParams(new URL(request.url).searchParams);
  if (!view) return exportNotFound();
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { id: true, title: true, organisation: { select: { slug: true } } },
  });
  if (!event) return exportNotFound();

  const ctx = await resolveJudgingOrganiser(userId, event.organisation.slug, event.id);
  if (!ctx) return exportNotFound();

  if (view.view === "submissions") {
    const plan = await planJudgingSubmissionsExport(ctx, { query: view.query, status: view.status });
    if (!plan) return exportNotFound();
    await recordAuditEvent({
      action: "JUDGING_SUBMISSIONS_EXPORTED",
      actorUserId: userId,
      organisationId: ctx.organisationId,
      targetType: "Event",
      targetId: event.id,
      metadata: { surface: "submissions", filters: exportFilterNames({ status: view.status !== "all", search: Boolean(view.query) }) },
    });
    return csvStreamResponse({ header: plan.header, batches: plan.batches, filename: exportFilename("submissions", event.title), errorMessage: "Unable to export submissions." });
  }

  const plan = await planJudgingResultsExport(ctx, { query: view.query, scored: view.scored, method: view.method ?? undefined });
  if (!plan) return exportNotFound();
  await recordAuditEvent({
    action: "JUDGING_SCORES_EXPORTED",
    actorUserId: userId,
    organisationId: ctx.organisationId,
    targetType: "Event",
    targetId: event.id,
    metadata: { surface: "results", rows: plan.rows, method: plan.method, filters: exportFilterNames({ scored: view.scored !== "all", search: Boolean(view.query) }) },
  });
  return csvStreamResponse({ header: plan.header, batches: plan.batches, filename: exportFilename("judging", event.title), errorMessage: "Unable to export judging scores." });
}
