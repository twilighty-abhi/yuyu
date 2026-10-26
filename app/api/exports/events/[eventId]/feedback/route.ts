import { auth } from "@/lib/auth";
import { recordAuditEvent } from "@/lib/audit";
import { csvByteStream } from "@/lib/csvExport";
import { prisma } from "@/lib/db";
import { getMembership, isOrgAdmin } from "@/lib/permissions";

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
  return `feedback_${safeTitle}_${new Date().toISOString().slice(0, 10)}.csv`;
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
      feedbackForm: {
        select: { id: true, fields: { select: { key: true, label: true }, orderBy: { sortOrder: "asc" } } },
      },
    },
  });
  const feedbackForm = event?.feedbackForm;
  if (!event || !feedbackForm) return missing();

  const membership = await getMembership(session.user.id, event.organisationId);
  if (!membership || !isOrgAdmin(membership.role)) return missing();

  const historicalFields = await prisma.eventFeedbackAnswer.findMany({
    where: { response: { formId: feedbackForm.id } },
    select: { fieldKey: true, fieldLabel: true },
    distinct: ["fieldKey"],
    orderBy: [{ fieldKey: "asc" }, { createdAt: "asc" }],
  });
  const fields = [
    ...feedbackForm.fields,
    ...historicalFields.filter((field) => !feedbackForm.fields.some((current) => current.key === field.fieldKey)).map((field) => ({ key: field.fieldKey, label: field.fieldLabel })),
  ];

  await recordAuditEvent({
    action: "FEEDBACK_RESPONSES_EXPORTED",
    actorUserId: session.user.id,
    organisationId: event.organisationId,
    targetType: "EventFeedbackForm",
    targetId: feedbackForm.id,
  });

  const stream = csvByteStream({
    header: ["Submitted At", ...fields.map((field) => field.label)],
    errorMessage: "Unable to export feedback responses.",
    batches: async function* () {
      let cursor: string | undefined;
      while (true) {
        const responses = await prisma.eventFeedbackResponse.findMany({
          where: { formId: feedbackForm.id },
          orderBy: { id: "asc" },
          take: EXPORT_BATCH_SIZE,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
          select: {
            id: true,
            submittedAt: true,
            answers: { select: { fieldKey: true, valueText: true, valueBool: true, valueNumber: true, valueDate: true }, orderBy: { createdAt: "asc" } },
          },
        });
        if (!responses.length) break;

        yield responses.map((response) => {
          const answers = new Map<string, string[]>();
          for (const answer of response.answers) {
            const values = answers.get(answer.fieldKey) ?? [];
            values.push(answerValue(answer));
            answers.set(answer.fieldKey, values);
          }
          return [
            response.submittedAt.toISOString(),
            ...fields.map((field) => answers.get(field.key)?.join(", ") ?? ""),
          ];
        });
        cursor = responses.at(-1)?.id;
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
