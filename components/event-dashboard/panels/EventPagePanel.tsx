import { toEventClientDto } from "@/lib/eventDto";
import type { EventDashboardContext } from "@/lib/eventDashboard/context";
import { loadRegistrationFields } from "@/lib/eventDashboard/data";
import { loadRegistrationLock } from "@/lib/eventDashboard/teams";
import { formatDayShort, formatTime } from "@/lib/format/datetime";
import { EditEventForm } from "@/components/event/EditEventForm";
import { EventWebsiteManager, type EventPagePreviewData } from "@/components/event/EventWebsiteManager";
import { EventRegistrationFormEditor } from "@/components/registration/EventRegistrationFormEditor";
import { ProgrammeCard } from "../event-page/ProgrammeCard";
import { htmlExcerpt, programmeCounts, programmeSummary } from "../event-page/summary";
import { SubTabs } from "../SubTabs";
import { NoPermission } from "./shared";

export async function EventPagePanel({ ctx }: { ctx: EventDashboardContext }) {
  const { event, permissions, organisation, now } = ctx;
  const [fields, registrations] = await Promise.all([
    loadRegistrationFields(event.id),
    permissions.canEditDetails ? loadRegistrationLock(event.id) : Promise.resolve(undefined),
  ]);
  const website = {
    page: event.page,
    highlights: event.highlights.map((x) => ({ id: x.id, title: x.title, description: x.description, visibility: x.visibility, values: { icon: x.icon, sortOrder: x.sortOrder } })),
    speakers: event.speakers.map((x) => ({ id: x.id, title: x.name, description: x.bioHtml, visibility: x.visibility, values: { headline: x.headline, organisation: x.organisation, photoUrl: x.photoUrl, websiteUrl: x.websiteUrl, linkedinUrl: x.linkedinUrl, xUrl: x.xUrl, sortOrder: x.sortOrder } })),
    sponsors: event.sponsors.map((x) => ({ id: x.id, title: x.name, description: x.description, visibility: x.visibility, values: { logoUrl: x.logoUrl, websiteUrl: x.websiteUrl, tier: x.tier, sortOrder: x.sortOrder } })),
    resources: event.resources.map((x) => ({ id: x.id, title: x.title, description: x.description, visibility: x.visibility, values: { externalUrl: x.externalUrl, sortOrder: x.sortOrder } })),
    faqs: event.faqs.map((x) => ({ id: x.id, title: x.question, description: x.answerHtml, visibility: x.visibility, values: { sortOrder: x.sortOrder } })),
  };
  const dto = toEventClientDto(event);
  const scheduleHref = permissions.canManageSchedule ? `/dashboard/${organisation.slug}/event/${event.id}/schedule` : null;
  const counts = programmeCounts(event.sessions, event.speakers.length);
  const publishedSessions = event.sessions
    .filter((session) => session.visibility === "PUBLISHED")
    .sort((a, b) => a.startDateTime.getTime() - b.startDateTime.getTime() || a.sortOrder - b.sortOrder);
  const sessionLines = publishedSessions.slice(0, 3).map((session) => ({ lead: formatTime(session.startDateTime, event.timezone), text: session.title }));
  if (publishedSessions.length > 3) sessionLines.push({ lead: "", text: `+${publishedSessions.length - 3} more` });
  const preview: EventPagePreviewData = {
    title: event.title,
    dateLine: `${formatDayShort(event.startDateTime, event.timezone, now)} · ${formatTime(event.startDateTime, event.timezone)}`,
    privacyType: event.privacyType,
    location: event.isOnline ? "" : event.location,
    isOnline: event.isOnline,
    aboutExcerpt: htmlExcerpt(event.page?.aboutHtml ?? ""),
    sessionCount: counts.sessionCount,
    sessionLines,
    scheduleHref,
  };
  const programme = <ProgrammeCard summary={programmeSummary(counts)} scheduleHref={scheduleHref} />;
  return (
    <SubTabs
      label="Event page sections"
      items={[
        {
          value: "details",
          label: "Details",
          content: permissions.canEditDetails ? <EditEventForm organisationSlug={organisation.slug} event={dto} page={website.page} registrations={registrations} /> : <NoPermission>You do not have permission to edit event details.</NoPermission>,
        },
        {
          value: "page",
          label: "Page & programme",
          content: permissions.canEditDetails ? (
            <EventWebsiteManager organisationSlug={organisation.slug} eventId={event.id} eventSlug={event.slug} {...website} preview={preview} programme={programme} />
          ) : (
            <div className="flex flex-col gap-5">
              {programme}
              <NoPermission>You do not have permission to edit the event page.</NoPermission>
            </div>
          ),
        },
        {
          value: "registration",
          label: "Registration form",
          content: <EventRegistrationFormEditor organisationSlug={organisation.slug} eventId={event.id} fields={fields} />,
        },
      ]}
    />
  );
}
