import Link from "next/link";
import { ArrowUpRight, QrCode } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EventManageHeader, type EventHeaderStat } from "@/components/dashboard/EventManageHeader";
import { EventReportDownloadButton } from "@/components/reports/EventReportDownloadButton";
import { CopyEventLink } from "@/components/dashboard/home/CopyEventLink";
import { EventDashboardTabs } from "@/components/event-dashboard/EventDashboardTabs";
import { OverviewPanel } from "@/components/event-dashboard/panels/OverviewPanel";
import { GuestsPanel } from "@/components/event-dashboard/panels/GuestsPanel";
import { EventPagePanel } from "@/components/event-dashboard/panels/EventPagePanel";
import { EmailsPanel } from "@/components/event-dashboard/panels/EmailsPanel";
import { CheckInPanel } from "@/components/event-dashboard/panels/CheckInPanel";
import { FeedbackPanel } from "@/components/event-dashboard/panels/FeedbackPanel";
import { AnalyticsPanel } from "@/components/event-dashboard/panels/AnalyticsPanel";
import { SettingsPanel } from "@/components/event-dashboard/panels/SettingsPanel";
import { loadEventDashboard } from "@/lib/eventDashboard/context";
import { loadCapacityUsed, loadRsvpStatusCounts } from "@/lib/eventDashboard/data";
import { peopleCount, teamUnitNoun } from "@/lib/teamCapacityDisplay";

type Props = {
  params: Promise<{ orgSlug: string; eventId: string }>;
};

export const metadata = { title: "Manage event", robots: { index: false, follow: false } };

export default async function EventManagePage({ params }: Props) {
  const { orgSlug, eventId } = await params;
  const ctx = await loadEventDashboard(orgSlug, eventId);
  const { organisation, event, permissions } = ctx;

  // Live numbers in the header are registration data (admins and MANAGE_REGISTRATIONS).
  const teamMode = event.registrationMode === "TEAM";
  const [counts, capacityUsed] = permissions.canManageRegistrations
    ? await Promise.all([loadRsvpStatusCounts(event.id), teamMode ? loadCapacityUsed(event.id, event.registrationMode) : null])
    : [null, null];
  // TEAM events: capacity counts units (teams plus solo registrants), people are shown beside it.
  const placesStat: EventHeaderStat | null =
    counts && teamMode && capacityUsed != null
      ? {
          label: "Places taken",
          value: event.capacity ? `${capacityUsed} / ${event.capacity}` : capacityUsed,
          detail: `${teamUnitNoun(event.soloPolicy, event.capacity ?? capacityUsed)} · ${peopleCount(counts.confirmed)} going`,
          meter: event.capacity ? { filled: capacityUsed, total: event.capacity, tone: "accent" } : undefined,
        }
      : null;
  const stats: EventHeaderStat[] | undefined = counts
    ? [
        placesStat ?? { label: "Going", value: event.capacity ? `${counts.confirmed} / ${event.capacity}` : counts.confirmed, meter: event.capacity ? { filled: counts.confirmed, total: event.capacity, tone: "accent" } : undefined },
        { label: "Waitlist", value: counts.waitlisted },
        { label: "To approve", value: counts.pendingApproval },
        { label: "Checked in", value: counts.checkedIn, meter: counts.confirmed ? { filled: counts.checkedIn, total: counts.confirmed, tone: "success" } : undefined },
      ]
    : undefined;

  const publicPath = `/${organisation.slug}/${event.slug}`;
  return (
    <div className="flex flex-col gap-6">
      <EventManageHeader
        back={{ href: `/dashboard/${organisation.slug}`, label: "All events" }}
        event={{
          title: event.title,
          status: event.status,
          privacyType: event.privacyType,
          startDateTime: event.startDateTime,
          endDateTime: event.endDateTime,
          timezone: event.timezone,
          location: event.location,
          isOnline: event.isOnline,
          accentColor: event.page?.accentColor,
        }}
        stats={stats}
        actions={
          <>
            {permissions.canDownloadReports && event.endDateTime < ctx.now ? <EventReportDownloadButton href={`/api/reports/event/${event.id}`} /> : null}
            <Button asChild variant="secondary">
              <Link href={publicPath}>
                View page
                <ArrowUpRight aria-hidden className="size-4" />
              </Link>
            </Button>
            {event.status === "PUBLISHED" ? <CopyEventLink path={publicPath} title={event.title} compact /> : null}
            {permissions.canCheckIn ? (
              <Button asChild variant="accent">
                <Link href={`/dashboard/${organisation.slug}/event/${event.id}/check-in`}>
                  <QrCode aria-hidden className="size-[18px]" />
                  Open check-in
                </Link>
              </Button>
            ) : null}
          </>
        }
      />

      <EventDashboardTabs
        badges={{ guests: counts?.pendingApproval ?? 0 }}
        panels={{
          overview: <OverviewPanel ctx={ctx} />,
          guests: <GuestsPanel ctx={ctx} />,
          page: <EventPagePanel ctx={ctx} />,
          emails: <EmailsPanel ctx={ctx} />,
          "check-in": <CheckInPanel ctx={ctx} />,
          feedback: <FeedbackPanel ctx={ctx} />,
          analytics: <AnalyticsPanel ctx={ctx} />,
          settings: <SettingsPanel ctx={ctx} />,
        }}
      />
    </div>
  );
}
