import { ArrowRight } from "lucide-react";
import { Callout } from "@/components/ui/display";
import type { EventDashboardContext } from "@/lib/eventDashboard/context";
import { loadRegistrationFields, loadRsvpStatusCounts } from "@/lib/eventDashboard/data";
import { loadBroadcastCount, loadEventTeam, loadPendingRequests, loadRecentSignupDates } from "@/lib/eventDashboard/overview";
import { cn } from "@/lib/cn";
import { OpenTabButton } from "../EventDashboardTabs";
import { GlanceCard, ReadinessCard, ShareCard, SignupsCard, TeamCard } from "../overview/OverviewSections";
import { WaitingForYou } from "../overview/WaitingForYou";
import { ShortLinkControl } from "../overview/ShortLinkControl";
import { eventPhase, readinessHeading, readinessItems, signupTrend } from "../overview/readiness";

/**
 * Overview tab. Guest data (sign-ups, approvals, counts) needs
 * `canManageRegistrations`, matching the RSVP server actions; everyone else
 * gets a reduced view with only the checklist items they can act on.
 */
export async function OverviewPanel({ ctx }: { ctx: EventDashboardContext }) {
  const { event, permissions, organisation, now } = ctx;
  const guests = permissions.canManageRegistrations;

  const [counts, fields, emailsSent, signupDates, requests, team] = await Promise.all([
    guests ? loadRsvpStatusCounts(event.id) : null,
    guests ? loadRegistrationFields(event.id) : null,
    guests ? loadBroadcastCount(event.id) : 0,
    guests ? loadRecentSignupDates(event.id, now) : null,
    guests ? loadPendingRequests(event.id) : null,
    permissions.canManageCollaborators ? loadEventTeam(organisation.id, event.id) : null,
  ]);

  const phase = eventPhase(event.startDateTime, event.endDateTime, now);
  const approvalRequired = event.privacyType === "APPROVAL_REQUIRED";
  const items = readinessItems({
    published: event.status === "PUBLISHED",
    hasCoverImage: Boolean(event.coverImageUrl),
    hasAccent: Boolean(event.page?.accentColor),
    isOnline: event.isOnline,
    sessionCount: event.sessions.length,
    registrationFieldCount: fields?.length ?? 0,
    // Only whether a PIN exists; the hash itself never leaves the server.
    stationPinSet: Boolean(event.checkInStationPinHash),
    approvalRequired,
    pendingApprovals: counts?.pendingApproval ?? 0,
    emailsSent,
    permissions,
  });
  const heading = readinessHeading({ items, start: event.startDateTime, end: event.endDateTime, now, timeZone: event.timezone });

  const path = `/${organisation.slug}/${event.slug}`;
  const showWaiting = Boolean(requests && counts && (counts.pendingApproval > 0 || approvalRequired));
  const hasMain = guests;

  const aside = (
    <>
      <ShareCard
        url={`${ctx.origin}${path}`}
        path={path}
        title={event.title}
        published={event.status === "PUBLISHED"}
        canEmbed={permissions.canEmbedEvent}
        shortLink={
          event.shortCode || permissions.canManageShortLink ? (
            <ShortLinkControl
              organisationSlug={organisation.slug}
              eventId={event.id}
              title={event.title}
              origin={ctx.origin}
              initialCode={event.shortCode}
              canManage={permissions.canManageShortLink}
              published={event.status === "PUBLISHED"}
            />
          ) : undefined
        }
      />
      <GlanceCard event={event} now={now} canEditDetails={permissions.canEditEventDetails} />
      {team ? <TeamCard team={team} /> : null}
    </>
  );

  return (
    <div className="flex flex-col gap-6">
      {phase === "ended" ? (
        <Callout
          tone="success"
          title="This event has ended"
          action={
            permissions.canViewAnalytics ? (
              <OpenTabButton tab="analytics" className="inline-flex min-h-9 items-center gap-1 text-sm font-semibold underline-offset-4 hover:underline">
                See how it went <ArrowRight aria-hidden className="size-4" />
              </OpenTabButton>
            ) : undefined
          }
        >
          Thank you for hosting.
        </Callout>
      ) : items.length ? (
        <ReadinessCard {...heading} items={items} organisationSlug={organisation.slug} eventSlug={event.slug} />
      ) : null}

      {hasMain ? (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
          <div className="flex min-w-0 flex-col gap-6">
            {signupDates ? <SignupsCard trend={signupTrend(signupDates, now)} /> : null}
            {showWaiting && requests && counts ? (
              <WaitingForYou organisationSlug={organisation.slug} eventId={event.id} timeZone={event.timezone} referenceTime={now.toISOString()} requests={requests} pendingTotal={counts.pendingApproval} />
            ) : null}
          </div>
          <aside className="flex min-w-0 flex-col gap-5">{aside}</aside>
        </div>
      ) : (
        <div className={cn("grid gap-5 md:grid-cols-2 md:items-start", team && "xl:grid-cols-3")}>{aside}</div>
      )}
    </div>
  );
}
