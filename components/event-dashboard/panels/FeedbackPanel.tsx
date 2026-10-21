import { prisma } from "@/lib/db";
import type { EventDashboardContext } from "@/lib/eventDashboard/context";
import { loadFeedbackInsights } from "@/lib/eventDashboard/feedback";
import { formatDate } from "@/lib/format/datetime";
import { FeedbackFormEditor } from "@/components/feedback/FeedbackFormEditor";
import { ResponsesCard } from "@/components/event-dashboard/feedback/ResponsesCard";
import { NoPermission } from "./shared";

const MAX_BROWSER_FEEDBACK_RESPONSES = 250;

export async function FeedbackPanel({ ctx }: { ctx: EventDashboardContext }) {
  const { event, permissions, organisation } = ctx;
  // The form, its settings and the certificate builder are organisation-admin actions.
  if (!permissions.canManageFeedback) return <NoPermission>You do not have permission to manage feedback for this event.</NoPermission>;
  const record = await prisma.eventFeedbackForm.findUnique({ where: { eventId: event.id }, include: { fields: { orderBy: { sortOrder: "asc" } } } });
  const form = record ? { isOpen: record.isOpen, title: record.title, thankYouMessage: record.thankYouMessage, certificateEnabled: record.certificateEnabled, certificateTemplate: record.certificateTemplate } : null;
  const fields = (record?.fields ?? []).map((field) => ({
    id: field.id, key: field.key, label: field.label, type: field.type, required: field.required, sortOrder: field.sortOrder,
    options: Array.isArray(field.options) ? field.options.filter((value): value is string => typeof value === "string") : [],
  }));

  // Responses are organisation-admin only. Only answer values are read: never
  // the RSVP, attendee identity or certificate token.
  const canViewResponses = permissions.canViewFeedbackResponses;
  const [responseRecords, insights] = canViewResponses && record
    ? await Promise.all([
        prisma.eventFeedbackResponse.findMany({
          where: { formId: record.id },
          select: { id: true, submittedAt: true, answers: { select: { fieldKey: true, fieldLabel: true, valueText: true, valueBool: true, valueNumber: true, valueDate: true }, orderBy: { createdAt: "asc" } } },
          orderBy: { submittedAt: "desc" },
          take: MAX_BROWSER_FEEDBACK_RESPONSES + 1,
        }),
        loadFeedbackInsights(record.id, fields),
      ])
    : [[], { responseCount: 0, ratings: [], texts: [] }];
  const responses = responseRecords.slice(0, MAX_BROWSER_FEEDBACK_RESPONSES).map((response) => {
    const grouped: Record<string, { label: string; values: string[] }> = {};
    for (const answer of response.answers) {
      const value = answer.valueText ?? (answer.valueBool != null ? (answer.valueBool ? "Yes" : "No") : null) ?? (answer.valueNumber != null ? String(answer.valueNumber) : null) ?? answer.valueDate?.toLocaleDateString() ?? null;
      if (value === null) continue;
      if (!grouped[answer.fieldKey]) grouped[answer.fieldKey] = { label: answer.fieldLabel, values: [] };
      grouped[answer.fieldKey]!.values.push(value);
    }
    return { id: response.id, submittedAt: response.submittedAt.toISOString(), answers: Object.values(grouped).map((answer) => ({ label: answer.label, value: answer.values.join(", ") })) };
  });

  return (
    <FeedbackFormEditor
      organisationSlug={organisation.slug}
      eventId={event.id}
      feedbackUrl={`${ctx.origin}/${organisation.slug}/${event.slug}/feedback`}
      form={form}
      fields={fields}
      eventTitle={event.title}
      eventDateLabel={formatDate(event.startDateTime, event.timezone)}
      organisationName={organisation.name}
      responses={canViewResponses ? (
        <ResponsesCard
          insights={insights}
          responses={responses}
          truncated={responseRecords.length > MAX_BROWSER_FEEDBACK_RESPONSES}
          exportHref={form ? `/api/exports/events/${event.id}/feedback` : undefined}
          timeZone={event.timezone}
        />
      ) : (
        <NoPermission>You do not have permission to view feedback responses.</NoPermission>
      )}
    />
  );
}
