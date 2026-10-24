import { requireSuperAdminMfa } from "@/lib/permissions";
import Link from "next/link";
import { EventStatus, RsvpStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { countConfirmedForEvent } from "@/lib/rsvpCapacity";
import { peopleCount, teamCapacityLabel } from "@/lib/teamCapacityDisplay";
import { ACTIVITY_SERIES, loadDailyActivity, loadTopOrganisationsByRsvps } from "@/lib/superAdminData";
import { compareWindows, fillDailySeries, formatChange, formatShare, sumPoints, windowStart, DAY_MS } from "@/lib/superAdminInsights";
import { SparklineCard } from "@/components/super-admin/Sparkline";
import { AdminPanel, MetricRows, NameCell } from "@/components/super-admin/AdminPanel";
import { EmptyState, PageHeader } from "@/components/ui/display";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

const WINDOW_DAYS = 30;

const seriesLabels: Record<(typeof ACTIVITY_SERIES)[number], string> = {
  signups: "New users",
  organisations: "New organisations",
  events: "Events created",
  rsvps: "Registrations",
  checkins: "Check-ins",
  feedback: "Feedback responses",
  broadcasts: "Broadcasts sent",
};

const rsvpStatusLabels: Record<RsvpStatus, string> = {
  CONFIRMED: "Confirmed",
  WAITLISTED: "Waitlisted",
  PENDING_APPROVAL: "Waiting for approval",
  REJECTED: "Rejected",
};

export default async function SuperAdminActivityPage() {
  // Layout checks don't re-run on client navigation, so every page checks too.
  await requireSuperAdminMfa();
  const now = new Date();
  // Two windows (previous + current) so growth can be compared from one query.
  const since = windowStart(WINDOW_DAYS * 2, now);
  const currentSince = windowStart(WINDOW_DAYS, now);
  const nextWeek = new Date(now.getTime() + 7 * DAY_MS);

  const [dailyRows, rsvpStatuses, topOrgs, upcoming, emptyOrgCount, emptyOrgs] = await Promise.all([
    loadDailyActivity(since),
    prisma.rSVP.groupBy({ by: ["status"], _count: { _all: true } }),
    loadTopOrganisationsByRsvps(currentSince).catch(() => []),
    prisma.event.findMany({
      where: { status: EventStatus.PUBLISHED, startDateTime: { gte: now, lt: nextWeek } },
      orderBy: { startDateTime: "asc" },
      take: 15,
      select: { id: true, title: true, startDateTime: true, capacity: true, registrationMode: true, soloPolicy: true, organisation: { select: { id: true, name: true } }, _count: { select: { rsvps: { where: { status: RsvpStatus.CONFIRMED } } } } },
    }),
    prisma.organisation.count({ where: { events: { none: {} }, eventSeries: { none: {} } } }),
    prisma.organisation.findMany({
      where: { events: { none: {} }, eventSeries: { none: {} } },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { id: true, name: true, slug: true, createdAt: true, _count: { select: { memberships: true } } },
    }),
  ]);

  // TEAM events fill capacity in units (teams plus solo registrants), not people.
  const unitsByEvent = new Map(
    await Promise.all(
      upcoming.filter((event) => event.registrationMode === "TEAM").map(async (event) => [event.id, await countConfirmedForEvent(event.id, event.registrationMode)] as const),
    ),
  );

  const series = fillDailySeries(dailyRows, ACTIVITY_SERIES, WINDOW_DAYS * 2, now);
  const rsvpTotal = rsvpStatuses.reduce((total, row) => total + row._count._all, 0);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Activity" description={`Growth and usage across the instance over the last ${WINDOW_DAYS} days (UTC days).`} />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {ACTIVITY_SERIES.map((name) => {
          const points = series[name].slice(-WINDOW_DAYS);
          return <SparklineCard key={name} title={seriesLabels[name]} subtitle={`Last ${WINDOW_DAYS} days`} total={sumPoints(points)} points={points} />;
        })}
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <AdminPanel title={`Last ${WINDOW_DAYS} days vs the ${WINDOW_DAYS} before`}>
          <Table label="Growth compared with the previous period">
            <THead>
              <tr>
                <TH>Metric</TH>
                <TH className="text-right">Previous</TH>
                <TH className="text-right">Current</TH>
                <TH className="text-right">Change</TH>
              </tr>
            </THead>
            <TBody>
              {ACTIVITY_SERIES.map((name) => {
                const { current, previous } = compareWindows(series[name]);
                return (
                  <TR key={name}>
                    <TD>{seriesLabels[name]}</TD>
                    <TD className="text-right tabular-nums text-ink-secondary">{previous.toLocaleString()}</TD>
                    <TD className="text-right font-semibold tabular-nums">{current.toLocaleString()}</TD>
                    <TD className="text-right tabular-nums">{formatChange(current, previous)}</TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </AdminPanel>

        <AdminPanel title="Registrations by status" description="All registrations on the instance.">
          <MetricRows
            rows={[
              ...Object.values(RsvpStatus).map((status) => {
                const count = rsvpStatuses.find((row) => row.status === status)?._count._all ?? 0;
                return { label: rsvpStatusLabels[status], value: `${count.toLocaleString()} · ${formatShare(count, rsvpTotal)}` };
              }),
              { label: "Total", value: rsvpTotal.toLocaleString() },
            ]}
          />
        </AdminPanel>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <AdminPanel title="Busiest organisations" description={`By registrations received in the last ${WINDOW_DAYS} days.`}>
          {topOrgs.length === 0 ? (
            <EmptyState mood="sleepy">No registrations in this period.</EmptyState>
          ) : (
            <Table label="Busiest organisations">
              <THead>
                <tr>
                  <TH>Organisation</TH>
                  <TH className="text-right">Registrations</TH>
                </tr>
              </THead>
              <TBody>
                {topOrgs.map((org) => (
                  <TR key={org.id}>
                    <TD><NameCell href={`/super-admin/orgs/${org.id}`} name={org.name} sub={`/${org.slug}`} /></TD>
                    <TD className="text-right tabular-nums">{Number(org.rsvps).toLocaleString()}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </AdminPanel>

        <AdminPanel title="Starting in the next 7 days" description="Published one-off events, soonest first.">
          {upcoming.length === 0 ? (
            <EmptyState mood="sleepy">No published events in the next week.</EmptyState>
          ) : (
            <Table label="Events starting in the next 7 days">
              <THead>
                <tr>
                  <TH>Event</TH>
                  <TH>Starts</TH>
                  <TH className="text-right">Confirmed</TH>
                </tr>
              </THead>
              <TBody>
                {upcoming.map((event) => (
                  <TR key={event.id}>
                    <TD><NameCell name={event.title} sub={<Link href={`/super-admin/orgs/${event.organisation.id}`} className="underline-offset-4 hover:underline">{event.organisation.name}</Link>} /></TD>
                    <TD className="whitespace-nowrap text-ink-secondary">{event.startDateTime.toLocaleString()}</TD>
                    <TD className="text-right tabular-nums">
                      {unitsByEvent.has(event.id) ? (
                        <>
                          {teamCapacityLabel(unitsByEvent.get(event.id)!, event.capacity, event.soloPolicy)}
                          <span className="block text-caption text-ink-muted">{peopleCount(event._count.rsvps)}</span>
                        </>
                      ) : event.capacity ? (
                        `${event._count.rsvps} / ${event.capacity}`
                      ) : (
                        event._count.rsvps
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </AdminPanel>
      </div>

      <AdminPanel title="Organisations without events" description={`${emptyOrgCount.toLocaleString()} organisation${emptyOrgCount === 1 ? " has" : "s have"} no events or series yet. Newest shown first.`}>
        {emptyOrgs.length === 0 ? (
          <EmptyState mood="sleepy">Every organisation has at least one event or series.</EmptyState>
        ) : (
          <Table label="Organisations without events">
            <THead>
              <tr>
                <TH>Organisation</TH>
                <TH className="text-right">Members</TH>
                <TH>Created</TH>
              </tr>
            </THead>
            <TBody>
              {emptyOrgs.map((org) => (
                <TR key={org.id}>
                  <TD><NameCell href={`/super-admin/orgs/${org.id}`} name={org.name} sub={`/${org.slug}`} /></TD>
                  <TD className="text-right tabular-nums">{org._count.memberships}</TD>
                  <TD className="whitespace-nowrap text-ink-secondary">{org.createdAt.toLocaleString()}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </AdminPanel>
    </div>
  );
}
