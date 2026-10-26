import { auth } from "@/lib/auth";
import { recordAuditEvent } from "@/lib/audit";
import { ORGANISER_TEAMS_EXPORT_BATCH_SIZE, listEventTeamsForOrganiser, resolveOrganiserEvent } from "@/lib/core/teams";
import { csvStreamResponse, exportFilename, exportFilterNames, exportNotFound } from "@/lib/csvExport";
import { prisma } from "@/lib/db";
import { TEAM_EXPORT_HEADER, parseTeamExportSearchParams, teamExportRow } from "@/lib/teamExport";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ eventId: string }> };

/**
 * Guests · Teams → "Export CSV": every team matching the Teams view's
 * current status filter and search (`status`, `q`), not only the teams
 * loaded in the browser. Read through the view's own query in bounded
 * keyset batches. The same access as the Teams view and the attendee CSV
 * (`resolveOrganiserEvent`: OWNER/ADMIN or the event's MANAGE_REGISTRATIONS
 * grant); every denial, a non-team event and a malformed parameter are the
 * same empty 404. Names and emails, never tokens or answers.
 */
export async function GET(request: Request, context: RouteContext) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return exportNotFound();

  const { eventId } = await context.params;
  if (!eventId || eventId.length > 128) return exportNotFound();
  const view = parseTeamExportSearchParams(new URL(request.url).searchParams);
  if (!view) return exportNotFound();

  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { id: true, title: true, registrationMode: true, organisation: { select: { slug: true } } },
  });
  if (!event || event.registrationMode !== "TEAM") return exportNotFound();
  const ctx = await resolveOrganiserEvent(userId, event.organisation.slug, event.id);
  if (!ctx) return exportNotFound();

  await recordAuditEvent({
    action: "TEAM_LIST_EXPORTED",
    actorUserId: userId,
    organisationId: ctx.organisationId,
    targetType: "Event",
    targetId: ctx.eventId,
    // Filter names only; the search text can contain personal data.
    metadata: { surface: "teams", filters: exportFilterNames({ status: view.status !== "all", search: Boolean(view.query) }) },
  });

  return csvStreamResponse({
    header: [...TEAM_EXPORT_HEADER],
    filename: exportFilename("teams", event.title),
    errorMessage: "Unable to export teams.",
    batches: async function* () {
      let cursor: string | null = null;
      do {
        const page = await listEventTeamsForOrganiser(ctx, { query: view.query, filter: view.status, cursor }, { pageSize: ORGANISER_TEAMS_EXPORT_BATCH_SIZE });
        if (page.teams.length === 0) break;
        const submissions = await prisma.submission.findMany({
          where: { eventId: ctx.eventId, teamId: { in: page.teams.map((team) => team.id) } },
          select: { teamId: true, status: true },
        });
        const submissionStatus = new Map(submissions.map((submission) => [submission.teamId, submission.status]));
        yield page.teams.map((team) => teamExportRow(team, submissionStatus.get(team.id) ?? null));
        cursor = page.nextCursor;
      } while (cursor);
    },
  });
}
