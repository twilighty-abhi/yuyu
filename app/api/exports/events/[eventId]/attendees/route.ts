import { EventPermission, type Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { recordAuditEvent } from "@/lib/audit";
import { csvStreamResponse, exportFilename, exportFilterNames, exportNotFound } from "@/lib/csvExport";
import { prisma } from "@/lib/db";
import { getMembership, isOrgAdmin } from "@/lib/permissions";
import { getRequestOrigin } from "@/lib/publicUrl";
import { attendeeBaseWhere, attendeeStatusWhere, parseAttendeeViewSearchParams, type AttendeeListView } from "@/lib/attendeeListQuery";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const EXPORT_BATCH_SIZE = 500;

/*
 * The attendee CSV. Without query parameters it holds every registration of
 * the event (the check-in desk's "Export attendance" and the unfiltered
 * Guests · People list). Guests · People's "Export CSV" adds the list's
 * current filters (`status`, `kind`, `team`, `q`, parsed exactly as the
 * list's own query by lib/attendeeListQuery.ts), so the file holds every
 * matching registration, not only the rows loaded in the browser. Same
 * columns either way; any malformed parameter is the same empty 404 as a
 * denial.
 */

function isFiltered(view: AttendeeListView) {
  return view.status !== "all" || view.kind !== "all" || view.team !== "all" || Boolean(view.query);
}

function answerValue(answer: { valueText: string | null; valueBool: boolean | null; valueNumber: number | null; valueDate: Date | null }) {
  return answer.valueText
    ?? (answer.valueBool == null ? null : answer.valueBool ? "Yes" : "No")
    ?? (answer.valueNumber == null ? null : String(answer.valueNumber))
    ?? answer.valueDate?.toISOString().slice(0, 10)
    ?? "";
}

/** Team name and role for one registration; solo registrants get an empty team and "Solo". */
function teamCells(rsvp: { id: string; team?: { name: string; leaderRsvpId: string | null } | null }) {
  if (!rsvp.team) return ["", "Solo"];
  return [rsvp.team.name, rsvp.team.leaderRsvpId === rsvp.id ? "Leader" : "Member"];
}

type RouteContext = { params: Promise<{ eventId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const session = await auth();
  if (!session?.user?.id) return exportNotFound();

  const { eventId } = await context.params;
  if (!eventId || eventId.length > 128) return exportNotFound();
  const view = parseAttendeeViewSearchParams(new URL(request.url).searchParams);
  if (!view) return exportNotFound();
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: {
      id: true,
      title: true,
      organisationId: true,
      registrationMode: true,
      registrationForm: {
        select: { fields: { select: { id: true, label: true }, orderBy: { sortOrder: "asc" } } },
      },
      // One column per custom check-in list, after the registration answers,
      // so existing columns keep their positions.
      checkInLists: {
        select: { id: true, name: true, archived: true },
        orderBy: [{ archived: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
      },
    },
  });
  if (!event) return exportNotFound();

  // Organisation owners/admins, or anyone (member or not) holding the exact
  // MANAGE_REGISTRATIONS grant on this event, as in lib/eventDashboard/capabilities.ts.
  const membership = await getMembership(session.user.id, event.organisationId);
  const isAdmin = Boolean(membership && isOrgAdmin(membership.role));
  const collaborator = isAdmin ? null : await prisma.eventCollaborator.findFirst({
    where: { eventId: event.id, userId: session.user.id, permissions: { has: EventPermission.MANAGE_REGISTRATIONS } },
    select: { id: true },
  });
  if (!isAdmin && !collaborator) return exportNotFound();

  const fields = event.registrationForm?.fields ?? [];
  // TEAM events add Team and Team role columns (docs/TEAMS.md); other exports keep their columns.
  const teamColumns = event.registrationMode === "TEAM";
  const lists = event.checkInLists;
  const origin = await getRequestOrigin();
  // Unfiltered: every registration, as before. Filtered: the People list's
  // own conditions, with the organisation re-checked in the same query.
  const where: Prisma.RSVPWhereInput = isFiltered(view)
    ? { AND: [attendeeBaseWhere({ kind: "event", eventId: event.id, organisationId: event.organisationId }, view, { teamMode: teamColumns }), attendeeStatusWhere(view.status)] }
    : { eventId: event.id };
  await recordAuditEvent({
    action: "ATTENDEE_LIST_EXPORTED",
    actorUserId: session.user.id,
    organisationId: event.organisationId,
    targetType: "Event",
    targetId: event.id,
    // Filter names only; the search text can contain personal data.
    metadata: {
      surface: "people",
      filters: exportFilterNames({ status: view.status !== "all", kind: view.kind !== "all", team: teamColumns && view.team !== "all", search: Boolean(view.query) }),
    },
  });

  return csvStreamResponse({
    header: ["Name", "Email", "Status", ...(teamColumns ? ["Team", "Team role"] : []), "Registration Date", "Checked In At", "Ticket URL", ...fields.map((field) => field.label), ...lists.map((list) => `Check-in: ${list.name}${list.archived ? " (archived)" : ""}`)],
    filename: exportFilename("attendees", event.title),
    errorMessage: "Unable to export attendee list.",
    batches: async function* () {
      let cursor: string | undefined;

      while (true) {
        const rsvps = await prisma.rSVP.findMany({
          where,
          orderBy: { id: "asc" },
          take: EXPORT_BATCH_SIZE,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
          include: {
            user: { select: { name: true, email: true } },
            answers: { select: { fieldId: true, valueText: true, valueBool: true, valueNumber: true, valueDate: true } },
            team: { select: { name: true, leaderRsvpId: true } },
            checkInListRecords: { select: { listId: true, checkedInAt: true } },
          },
        });
        if (!rsvps.length) break;

        const rows = rsvps.map((rsvp) => {
          const answers = new Map(rsvp.answers.map((answer) => [answer.fieldId, answerValue(answer)]));
          const listCheckIns = new Map(rsvp.checkInListRecords.map((record) => [record.listId, record.checkedInAt.toISOString()]));
          return [
            rsvp.user?.name ?? rsvp.guestName ?? "",
            rsvp.user?.email ?? rsvp.guestEmail ?? "",
            rsvp.status,
            ...(teamColumns ? teamCells(rsvp) : []),
            rsvp.createdAt.toISOString(),
            rsvp.checkedInAt?.toISOString() ?? "",
            `${origin}/ticket/${rsvp.checkInToken}`,
            ...fields.map((field) => answers.get(field.id) ?? ""),
            ...lists.map((list) => listCheckIns.get(list.id) ?? ""),
          ];
        });
        yield rows;
        cursor = rsvps.at(-1)?.id;
      }
    },
  });
}
