import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { getRequestOrigin } from "@/lib/publicUrl";
import { isOrgAdmin, requireOrgDashboardAccess } from "@/lib/permissions";
import { canViewEventDashboard } from "@/lib/eventAccess";
import { seriesCapabilities } from "@/lib/eventDashboard/capabilities";
import { EditSeriesForm } from "@/components/series/EditSeriesForm";
import { SeriesInvitePanel } from "@/components/invites/SeriesInvitePanel";
import { GuestsPeople } from "@/components/event-dashboard/panels/GuestsPeople";
import { ScheduleManager } from "@/components/schedule/ScheduleManager";
import { EventReportDownloadButton } from "@/components/reports/EventReportDownloadButton";
import { ArrowUpRight } from "lucide-react";
import { Card, PageHeader } from "@/components/ui/display";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { formatDayTime } from "@/lib/format/datetime";
import { listAttendeesPage } from "@/lib/eventDashboard/attendees";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Manage event series", robots: { index: false, follow: false } };

type Props = { params: Promise<{ orgSlug: string; seriesId: string }> };

function eventDateInput(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)?.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export default async function SeriesManagePage({ params }: Props) {
  const { orgSlug, seriesId } = await params;
  const access = await requireOrgDashboardAccess(orgSlug);
  const { organisation } = access;

  const series = await prisma.eventSeries.findFirst({
    where: { id: seriesId, organisationId: organisation.id },
    include: {
      instances: {
        orderBy: { startDateTime: "asc" },
        take: 20,
      },
      scheduleItems: { orderBy: { sortOrder: "asc" } },
    },
  });
  if (!series) notFound();
  if (!access.membership && !(await canViewEventDashboard({ userId: access.userId, organisationId: organisation.id, eventSeriesId: series.id }))) notFound();
  const isAdmin = Boolean(access.membership && isOrgAdmin(access.membership.role));
  const currentGrant = isAdmin ? null : await prisma.eventCollaborator.findFirst({
    where: { eventSeriesId: series.id, userId: access.userId },
    select: { permissions: true },
  });
  // One capability object drives every control below; the actions re-check it.
  const can = seriesCapabilities(access.membership?.role ?? null, currentGrant?.permissions ?? []);
  const canManageRegistrations = can.canManageRegistrations;

  const invites = can.canManageInvitations
    ? await prisma.seriesInvite.findMany({
        where: { eventSeriesId: series.id },
        orderBy: { createdAt: "desc" },
      })
    : [];

  const firstInstanceId = series.instances[0]?.id;
  const origin = await getRequestOrigin();
  // The first page of the occurrence's guests; further pages, filters and
  // search go through `loadAttendeesPage` with the same series grant check.
  const attendeesPage = firstInstanceId && canManageRegistrations
    ? await listAttendeesPage({ kind: "instance", eventInstanceId: firstInstanceId, organisationId: organisation.id }, {}, { origin, teamMode: false })
    : null;

  const now = new Date();
  const canDownloadReports = can.canDownloadReports;
  const finishedInstances = series.instances.filter((instance) => instance.endDateTime < now);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title={series.title} description="Manage this recurring event and its upcoming occurrences." />

      {can.canEditSeries ? (
        <Card as="section" padding="lg" aria-labelledby="series-details-title">
          <h2 id="series-details-title" className="mb-4 text-h4 text-ink">Series details</h2>
          <EditSeriesForm organisationSlug={organisation.slug} series={{
            id: series.id,
            title: series.title,
            description: series.description,
            recurrenceRule: series.recurrenceRule,
            timezone: series.timezone,
            capacity: series.capacity,
            status: series.status,
            privacyType: series.privacyType,
          }} />
        </Card>
      ) : null}

      {can.canManageInvitations ? (
        <section aria-labelledby="series-invites-title" className="flex flex-col gap-3">
          <h2 id="series-invites-title" className="text-h4 text-ink">Invites</h2>
          <SeriesInvitePanel
            organisationSlug={organisation.slug}
            eventSeriesId={series.id}
            invites={invites.map((i) => ({
              ...i,
              createdAt: i.createdAt.toISOString(),
            }))}
          />
        </section>
      ) : null}

      {can.canManageSchedule ? (
        <ScheduleManager organisationSlug={organisation.slug} eventSeriesId={series.id} items={series.scheduleItems.map((item) => ({ ...item, startDateTime: item.startDateTime.toISOString(), endDateTime: item.endDateTime.toISOString() }))} defaultDate={series.instances[0] ? eventDateInput(series.instances[0].startDateTime, series.timezone) : ""} />
      ) : null}

      <section aria-labelledby="series-instances-title" className="flex flex-col gap-3">
        <h2 id="series-instances-title" className="text-h4 text-ink">Upcoming instances</h2>
        <Table label="Upcoming instances">
          <THead>
            <tr>
              <TH>Start</TH>
              <TH className="text-right">Event page</TH>
            </tr>
          </THead>
          <TBody>
            {series.instances.map((inst) => (
              <TR key={inst.id}>
                <TD className="font-semibold">{formatDayTime(inst.startDateTime, series.timezone)}</TD>
                <TD className="text-right">
                  <Link href={`/${organisation.slug}/i/${inst.id}`} className="inline-flex items-center gap-1 text-sm font-semibold text-ink underline underline-offset-4">
                    View event
                    <ArrowUpRight aria-hidden className="size-3.5" />
                  </Link>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </section>

      {canDownloadReports ? (
        <section aria-labelledby="series-reports-title" className="flex flex-col gap-3">
          <h2 id="series-reports-title" className="text-h4 text-ink">Reports</h2>
          <Card>
            {finishedInstances.length ? (
              <ul className="flex flex-col divide-y divide-line">
                {finishedInstances.map((instance) => (
                  <li key={instance.id} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
                    <span className="text-body-ui text-ink">{formatDayTime(instance.startDateTime, series.timezone)}</span>
                    <EventReportDownloadButton href={`/api/reports/instance/${instance.id}`} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-body-ui text-ink-muted">Reports become available after an occurrence has finished.</p>
            )}
          </Card>
        </section>
      ) : null}

      {firstInstanceId && attendeesPage ? (
        <section aria-label="Attendees (first upcoming occurrence)" className="min-w-0">
          <GuestsPeople
            organisationSlug={organisation.slug}
            target={{ kind: "instance", instanceId: firstInstanceId, seriesId: series.id }}
            title="Attendees (first upcoming occurrence)"
            timeZone={series.timezone}
            now={now.toISOString()}
            initialPage={attendeesPage}
            registrationFields={[]}
          />
        </section>
      ) : null}
    </div>
  );
}
