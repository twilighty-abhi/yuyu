import { EventReportDownloadButton } from "@/components/reports/EventReportDownloadButton";
import { EmptyState } from "@/components/ui/display";
import type { EventDashboardContext } from "@/lib/eventDashboard/context";
import { loadCapacityUsed, loadRsvpStatusCounts } from "@/lib/eventDashboard/data";
import { teamCapacityLabel } from "@/lib/teamCapacityDisplay";
import { loadAllSignupDates, loadFeedbackCount } from "@/lib/eventDashboard/overview";
import { FunnelCard, KeyNumbers, StatusMixCard, TimelineCard, type MixPart } from "../analytics/AnalyticsSections";
import { busiestDay, capacityStatus, funnelSentence, funnelSteps, percentOf, signupsLastWeek, signupTimeline } from "../analytics/metrics";
import { NoPermission } from "./shared";

/** Analytics tab: registration numbers follow the RSVP actions; the PDF report stays with organisation admins. */
export async function AnalyticsPanel({ ctx }: { ctx: EventDashboardContext }) {
  const { event, permissions, now } = ctx;
  if (!permissions.canViewAnalytics) return <NoPermission>You do not have permission to see registration numbers for this event.</NoPermission>;

  // TEAM events fill capacity in units (teams plus solo registrants), not people.
  const teamMode = event.registrationMode === "TEAM";
  const [counts, feedback, signupDates, units] = await Promise.all([
    loadRsvpStatusCounts(event.id),
    loadFeedbackCount(event.id),
    loadAllSignupDates(event.id),
    teamMode ? loadCapacityUsed(event.id, event.registrationMode) : null,
  ]);
  const ended = event.endDateTime < now;
  const steps = funnelSteps({ responded: counts.total, going: counts.confirmed, checkedIn: counts.checkedIn, feedback, ended });
  const checkedIn = steps.find((step) => step.key === "checkedIn")!.value;
  const summary = funnelSentence({ responded: counts.total, going: counts.confirmed, checkedIn, ended });

  const parts: MixPart[] = [
    { key: "going", label: "Going", hint: "Have a place and a ticket", value: counts.confirmed, tone: "bg-success-solid" },
    { key: "waitlist", label: "Waitlist", hint: "Signed up after the event was full", value: counts.waitlisted, tone: "bg-warning-solid" },
    { key: "pending", label: "Waiting for approval", hint: "Need a decision from an organiser", value: counts.pendingApproval, tone: "bg-primary" },
    { key: "declined", label: "Declined", hint: "Declined by an organiser", value: counts.rejected, tone: "bg-danger-solid" },
  ];

  // Crew (docs/CREW.md) are going but never take a place.
  const capacity = capacityStatus(units ?? counts.confirmed - counts.crew, event.capacity);
  const capacityDetail = !capacity
    ? "No capacity limit set"
    : units != null
      ? `${teamCapacityLabel(units, event.capacity, event.soloPolicy)}${capacity.full ? " · full" : ""}`
      : capacity.full
        ? `Full · all ${event.capacity} places taken`
        : `${capacity.left} of ${event.capacity} places left`;
  const turnout = checkedIn != null ? percentOf(checkedIn, counts.confirmed) : null;
  const keyNumbers = [
    {
      key: "going",
      label: "Going",
      value: String(counts.confirmed),
      tone: "bg-success-solid",
      bar: capacity ? capacity.percent / 100 : undefined,
      detail: capacityDetail,
    },
    {
      key: "waitlist",
      label: "Waitlist",
      value: String(counts.waitlisted),
      tone: "bg-warning-solid",
      detail: counts.waitlisted ? "Waiting for a place" : "Nobody waiting",
    },
    {
      key: "pending",
      label: "Waiting for approval",
      value: String(counts.pendingApproval),
      tone: "bg-primary",
      detail: counts.pendingApproval ? "Need your decision" : "Nothing to review",
      action: counts.pendingApproval && !ended ? { tab: "guests", label: "Review" } : undefined,
    },
    {
      key: "turnout",
      label: "Turnout",
      value: turnout != null && checkedIn! <= counts.confirmed ? `${turnout}%` : checkedIn != null ? String(checkedIn) : "—",
      tone: "bg-accent",
      bar: turnout != null ? Math.min(100, turnout) / 100 : undefined,
      detail:
        checkedIn == null
          ? "Shows once check-in starts"
          : turnout != null && checkedIn <= counts.confirmed
            ? `${checkedIn} of ${counts.confirmed} going checked in`
            : `${checkedIn} checked in`,
    },
  ];

  const until = ended ? event.endDateTime : now;
  const timeline = signupTimeline(signupDates, until, event.timezone);
  const busiest = busiestDay(
    signupDates.filter((date) => date <= until),
    event.timezone,
  );
  const lastWeek = ended ? null : signupsLastWeek(signupDates, until, event.timezone);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-body-ui text-ink-secondary">{ended ? "Final numbers for this event. Everything here is also in the PDF report." : "Live numbers for this event. The PDF report is ready once the event ends."}</p>
        {permissions.canDownloadReports && ended ? <EventReportDownloadButton href={`/api/reports/event/${event.id}`} label="Download report (PDF)" /> : null}
      </div>

      {counts.total === 0 ? (
        <EmptyState title="No responses yet">Numbers show up here as soon as people sign up.</EmptyState>
      ) : (
        <>
          <KeyNumbers items={keyNumbers} />
          <FunnelCard steps={steps} summary={summary} />
          <div className="grid gap-5 lg:grid-cols-2">
            <StatusMixCard parts={parts} />
            {timeline ? <TimelineCard timeline={timeline} busiest={busiest} lastWeek={lastWeek} /> : null}
          </div>
        </>
      )}
    </div>
  );
}
