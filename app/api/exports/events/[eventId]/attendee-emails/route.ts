import { auth } from "@/lib/auth";
import { recordAuditEvent } from "@/lib/audit";
import { csvByteStream } from "@/lib/csvExport";
import { prisma } from "@/lib/db";
import { canManageRegistrationsFor } from "@/lib/eventAccess";
import { attendeeEmailExportFilename } from "@/lib/attendeeEmailExport";
import { attendeeBaseWhere, attendeeStatusWhere, parseAttendeeViewSearchParams } from "@/lib/attendeeListQuery";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const EXPORT_BATCH_SIZE = 500;

const NO_STORE = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};

function missing() {
  return new Response(null, { status: 404, headers: NO_STORE });
}

type RouteContext = { params: Promise<{ eventId: string }> };

/**
 * Guests · People → "Export emails": unique names and emails for every
 * registration matching the list's current filters and search (not only the
 * rows loaded in the browser). The same access as the full attendee CSV
 * (OWNER/ADMIN or the event's MANAGE_REGISTRATIONS grant); every denial is
 * the same empty 404.
 */
export async function GET(request: Request, context: RouteContext) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return missing();

  const { eventId } = await context.params;
  if (!eventId || eventId.length > 128) return missing();
  const view = parseAttendeeViewSearchParams(new URL(request.url).searchParams);
  if (!view) return missing();

  const event = await prisma.event.findUnique({ where: { id: eventId }, select: { id: true, title: true, organisationId: true, registrationMode: true } });
  if (!event) return missing();
  if (!(await canManageRegistrationsFor({ userId, organisationId: event.organisationId, eventId: event.id }))) return missing();

  const base = attendeeBaseWhere({ kind: "event", eventId: event.id, organisationId: event.organisationId }, view, { teamMode: event.registrationMode === "TEAM" });
  const where = { AND: [base, attendeeStatusWhere(view.status)] };
  await recordAuditEvent({
    action: "ATTENDEE_LIST_EXPORTED",
    actorUserId: userId,
    organisationId: event.organisationId,
    targetType: "Event",
    targetId: event.id,
    // Filter names only; the search text can contain personal data.
    metadata: { format: "emails", status: view.status, kind: view.kind, team: view.team, searched: Boolean(view.query) },
  });

  // Each address once (case-insensitively), first registration wins: the
  // set of addresses already written is the only state kept across batches.
  const seen = new Set<string>();
  const stream = csvByteStream({
    header: ["Name", "Email"],
    errorMessage: "Unable to export attendee emails.",
    batches: async function* () {
      let cursor: string | undefined;
      while (true) {
        const rsvps = await prisma.rSVP.findMany({
          where,
          orderBy: { id: "asc" },
          take: EXPORT_BATCH_SIZE,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
          select: { id: true, guestName: true, guestEmail: true, user: { select: { name: true, email: true } } },
        });
        if (!rsvps.length) break;
        const rows: Array<[string, string]> = [];
        for (const rsvp of rsvps) {
          const email = (rsvp.user?.email ?? rsvp.guestEmail ?? "").trim();
          const key = email.toLowerCase();
          if (!email || seen.has(key)) continue;
          seen.add(key);
          rows.push([(rsvp.user?.name ?? rsvp.guestName ?? "").trim(), email]);
        }
        yield rows;
        cursor = rsvps.at(-1)?.id;
      }
    },
  });

  return new Response(stream, {
    headers: {
      ...NO_STORE,
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${attendeeEmailExportFilename(event.title)}"`,
    },
  });
}
