import { EventPermission } from "@prisma/client";
import { auth } from "@/lib/auth";
import { recordAuditEvent } from "@/lib/audit";
import { buildCsv } from "@/lib/csv";
import { prisma } from "@/lib/db";
import { getMembership, isOrgAdmin } from "@/lib/permissions";
import { getRequestOrigin } from "@/lib/publicUrl";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const EXPORT_BATCH_SIZE = 500;

function missing() {
  return new Response(null, {
    status: 404,
    headers: {
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function filename(eventTitle: string) {
  const safeTitle = eventTitle
    .replace(/[^a-zA-Z0-9 _-]/g, "")
    .replace(/\s+/g, "_")
    .slice(0, 50) || "event";
  return `attendees_${safeTitle}_${new Date().toISOString().slice(0, 10)}.csv`;
}

function answerValue(answer: { valueText: string | null; valueBool: boolean | null; valueNumber: number | null; valueDate: Date | null }) {
  return answer.valueText
    ?? (answer.valueBool == null ? null : answer.valueBool ? "Yes" : "No")
    ?? (answer.valueNumber == null ? null : String(answer.valueNumber))
    ?? answer.valueDate?.toISOString().slice(0, 10)
    ?? "";
}

type RouteContext = { params: Promise<{ eventId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const session = await auth();
  if (!session?.user?.id) return missing();

  const { eventId } = await context.params;
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: {
      id: true,
      title: true,
      organisationId: true,
      registrationForm: {
        select: { fields: { select: { id: true, label: true }, orderBy: { sortOrder: "asc" } } },
      },
    },
  });
  if (!event) return missing();

  const membership = await getMembership(session.user.id, event.organisationId);
  const collaborator = membership ? null : await prisma.eventCollaborator.findFirst({
    where: { eventId: event.id, userId: session.user.id, permissions: { has: EventPermission.MANAGE_REGISTRATIONS } },
    select: { id: true },
  });
  if ((!membership || !isOrgAdmin(membership.role)) && !collaborator) return missing();

  const fields = event.registrationForm?.fields ?? [];
  const origin = await getRequestOrigin();
  await recordAuditEvent({
    action: "ATTENDEE_LIST_EXPORTED",
    actorUserId: session.user.id,
    organisationId: event.organisationId,
    targetType: "Event",
    targetId: event.id,
  });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        controller.enqueue(encoder.encode(`\uFEFF${buildCsv([["Name", "Email", "Status", "Registration Date", "Checked In At", "Ticket URL", ...fields.map((field) => field.label)]])}\n`));
        let cursor: string | undefined;

        while (true) {
          const rsvps = await prisma.rSVP.findMany({
            where: { eventId: event.id },
            orderBy: { id: "asc" },
            take: EXPORT_BATCH_SIZE,
            ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
            include: {
              user: { select: { name: true, email: true } },
              answers: { select: { fieldId: true, valueText: true, valueBool: true, valueNumber: true, valueDate: true } },
            },
          });
          if (!rsvps.length) break;

          const rows = rsvps.map((rsvp) => {
            const answers = new Map(rsvp.answers.map((answer) => [answer.fieldId, answerValue(answer)]));
            return [
              rsvp.user?.name ?? rsvp.guestName ?? "",
              rsvp.user?.email ?? rsvp.guestEmail ?? "",
              rsvp.status,
              rsvp.createdAt.toISOString(),
              rsvp.checkedInAt?.toISOString() ?? "",
              `${origin}/ticket/${rsvp.checkInToken}`,
              ...fields.map((field) => answers.get(field.id) ?? ""),
            ];
          });
          controller.enqueue(encoder.encode(`${buildCsv(rows)}\n`));
          cursor = rsvps.at(-1)?.id;
        }
        controller.close();
      } catch {
        controller.error(new Error("Unable to export attendee list."));
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename(event.title)}"`,
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
