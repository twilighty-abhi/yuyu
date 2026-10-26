import { prisma } from "@/lib/db";
import type { EventDashboardContext } from "@/lib/eventDashboard/context";
import { loadFeedbackInsights } from "@/lib/eventDashboard/feedback";
import { FEEDBACK_RESPONSES_PAGE_SIZE, listFeedbackResponsesPage } from "@/lib/eventDashboard/feedbackResponses";
import { formatDate } from "@/lib/format/datetime";
import { FeedbackFormEditor } from "@/components/feedback/FeedbackFormEditor";
import { ResponsesCard } from "@/components/event-dashboard/feedback/ResponsesCard";
import { NoPermission } from "./shared";

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
  // the RSVP, attendee identity or certificate token. The individual list is
  // paged on the server (first page here, the rest via loadFeedbackResponsesPage).
  const canViewResponses = permissions.canViewFeedbackResponses;
  const [responsesPage, insights] = canViewResponses && record
    ? await Promise.all([
        listFeedbackResponsesPage({ eventId: event.id, organisationId: organisation.id }),
        loadFeedbackInsights(record.id, fields),
      ])
    : [{ responses: [], page: 1, pageCount: 1, total: 0, pageSize: FEEDBACK_RESPONSES_PAGE_SIZE }, { responseCount: 0, ratings: [], texts: [] }];

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
          organisationSlug={organisation.slug}
          eventId={event.id}
          insights={insights}
          initialPage={responsesPage}
          exportHref={form ? `/api/exports/events/${event.id}/feedback` : undefined}
          timeZone={event.timezone}
        />
      ) : (
        <NoPermission>You do not have permission to view feedback responses.</NoPermission>
      )}
    />
  );
}
