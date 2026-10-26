import type { EventDashboardContext } from "@/lib/eventDashboard/context";
import { loadRegistrationFields } from "@/lib/eventDashboard/data";
import { loadAttendeesFirstPage } from "@/lib/eventDashboard/attendees";
import { loadEventInvitesFirstPage } from "@/lib/eventDashboard/invites";
import { loadEventTeams } from "@/lib/eventDashboard/teams";
import { loadSavedViewsForDashboard } from "@/lib/eventDashboard/savedViews";
import { EventInvitePanel } from "@/components/invites/EventInvitePanel";
import { SubTabs, type SubTab } from "../SubTabs";
import { GuestsPeople } from "./GuestsPeople";
import { GuestsTeams } from "./GuestsTeams";
import { NoPermission } from "./shared";

export async function GuestsPanel({ ctx }: { ctx: EventDashboardContext }) {
  const { event, permissions, organisation } = ctx;
  const teamMode = event.registrationMode === "TEAM";
  const teamsAllowed = teamMode && permissions.canManageRegistrations;
  // Every list here is paged on the server; only first pages load with the panel.
  const [attendees, fields, invites, teamsPage, savedViews] = await Promise.all([
    permissions.canManageRegistrations ? loadAttendeesFirstPage(ctx) : Promise.resolve(null),
    loadRegistrationFields(event.id),
    permissions.canManageInvitations ? loadEventInvitesFirstPage(event.id, organisation.id) : Promise.resolve(null),
    teamsAllowed ? loadEventTeams(ctx) : Promise.resolve(null),
    loadSavedViewsForDashboard(ctx),
  ]);
  const teamsTab: SubTab[] = teamMode
    ? [
        {
          value: "teams",
          label: "Teams",
          count: teamsPage ? teamsPage.counts.all : undefined,
          content: teamsPage ? (
            <GuestsTeams
              organisationSlug={organisation.slug}
              eventId={event.id}
              initialPage={teamsPage}
              approvalRequired={event.privacyType === "APPROVAL_REQUIRED"}
              savedViews={savedViews.GUESTS_TEAMS ?? []}
            />
          ) : (
            <NoPermission>You do not have permission to view or manage attendee registrations.</NoPermission>
          ),
        },
      ]
    : [];
  return (
    <SubTabs
      label="Guests sections"
      items={[
        {
          value: "people",
          label: "People",
          content: attendees ? (
            <GuestsPeople
              organisationSlug={organisation.slug}
              target={{ kind: "event", eventId: event.id, eventTitle: event.title }}
              timeZone={event.timezone}
              now={ctx.now.toISOString()}
              initialPage={attendees}
              registrationFields={fields}
              teamMode={teamMode}
              canUndoCheckIn={permissions.canCheckIn}
              savedViews={savedViews.GUESTS_PEOPLE ?? []}
            />
          ) : (
            <NoPermission>You do not have permission to view or manage attendee registrations.</NoPermission>
          ),
        },
        ...teamsTab,
        {
          value: "invites",
          label: "Invites",
          count: invites ? invites.total : undefined,
          content: invites ? (
            <EventInvitePanel organisationSlug={organisation.slug} eventId={event.id} eventHasEnded={event.endDateTime <= ctx.now} initialPage={invites} timeZone={event.timezone} now={ctx.now.toISOString()} />
          ) : (
            <NoPermission>You do not have permission to manage invitations for this event.</NoPermission>
          ),
        },
      ]}
    />
  );
}
