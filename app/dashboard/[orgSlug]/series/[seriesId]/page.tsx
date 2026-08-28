import { notFound } from "next/navigation";
import Typography from "@mui/material/Typography";
import Stack from "@mui/material/Stack";
import Paper from "@mui/material/Paper";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TableContainer from "@mui/material/TableContainer";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { getRequestOrigin } from "@/lib/publicUrl";
import { isOrgAdmin, requireOrgDashboardAccess } from "@/lib/permissions";
import { canViewEventDashboard } from "@/lib/eventAccess";
import { EditSeriesForm } from "@/components/series/EditSeriesForm";
import { SeriesInvitePanel } from "@/components/invites/SeriesInvitePanel";
import { AttendeeTable } from "@/components/attendees/AttendeeTable";
import { ScheduleManager } from "@/components/schedule/ScheduleManager";
import { EventReportDownloadButton } from "@/components/reports/EventReportDownloadButton";

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

  const invites = await prisma.seriesInvite.findMany({
    where: { eventSeriesId: series.id },
    orderBy: { createdAt: "desc" },
  });

  const firstInstanceId = series.instances[0]?.id;
  const rsvps = firstInstanceId
    ? await prisma.rSVP.findMany({
        where: { eventInstanceId: firstInstanceId },
        include: { user: true },
        orderBy: { createdAt: "desc" },
      })
    : [];

  const origin = await getRequestOrigin();
  const now = new Date();
  const canDownloadReports = Boolean(access.membership && isOrgAdmin(access.membership.role));
  const finishedInstances = series.instances.filter((instance) => instance.endDateTime < now);
  const attendees = rsvps.map((r) => ({
    id: r.id,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
    guestEmail: r.guestEmail,
    user: r.user
      ? { id: r.user.id, name: r.user.name, email: r.user.email }
      : null,
    checkedInAt: r.checkedInAt?.toISOString() ?? null,
    ticketUrl: `${origin}/ticket/${r.checkInToken}`,
    rawAnswers: [],
  }));

  return (
    <Stack spacing={3.5} sx={{ py: { xs: 1, sm: 2 } }}>
      <Stack spacing={0.5}>
        <Typography variant="h5" component="h1" sx={{ fontWeight: 700, letterSpacing: "-0.5px" }}>
          {series.title}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Manage this recurring event and its upcoming occurrences.
        </Typography>
      </Stack>

      <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 }, borderRadius: "18px", borderColor: "rgba(255,255,255,0.08)", backgroundColor: "rgba(255,255,255,0.025)" }}>
        <Typography variant="subtitle1" gutterBottom sx={{ fontWeight: 700 }}>
          Series details
        </Typography>
        <EditSeriesForm organisationSlug={organisation.slug} series={series} />
      </Paper>

      <Typography variant="h6" component="h2" sx={{ fontWeight: 700, letterSpacing: "-0.3px" }}>
        Invites
      </Typography>
      <SeriesInvitePanel
        organisationSlug={organisation.slug}
        eventSeriesId={series.id}
        invites={invites.map((i) => ({
          ...i,
          createdAt: i.createdAt.toISOString(),
        }))}
      />

      <ScheduleManager organisationSlug={organisation.slug} eventSeriesId={series.id} items={series.scheduleItems.map((item) => ({ ...item, startDateTime: item.startDateTime.toISOString(), endDateTime: item.endDateTime.toISOString() }))} defaultDate={series.instances[0] ? eventDateInput(series.instances[0].startDateTime, series.timezone) : ""} />

      <Typography variant="h6" component="h2" sx={{ fontWeight: 700, letterSpacing: "-0.3px" }}>
        Upcoming instances
      </Typography>
      <TableContainer component={Paper} variant="outlined" sx={{ overflow: "hidden", borderRadius: "16px", borderColor: "rgba(255,255,255,0.08)", backgroundColor: "rgba(28,28,30,0.82)" }}>
        <Table size="small">
          <TableHead>
            <TableRow sx={{ backgroundColor: "rgba(255,255,255,0.025)" }}>
              <TableCell sx={{ py: 1.25, color: "rgba(255,255,255,0.48)", fontSize: "0.7rem", fontWeight: 700, letterSpacing: "0.7px", textTransform: "uppercase" }}>Start</TableCell>
              <TableCell align="right" sx={{ py: 1.25, color: "rgba(255,255,255,0.48)", fontSize: "0.7rem", fontWeight: 700, letterSpacing: "0.7px", textTransform: "uppercase" }}>Event page</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {series.instances.map((inst) => (
              <TableRow key={inst.id} hover sx={{ "&:last-child td": { borderBottom: 0 }, "&:hover": { backgroundColor: "rgba(255,255,255,0.035)" } }}>
                <TableCell sx={{ py: 1.5, fontWeight: 600 }}>
                  {inst.startDateTime.toLocaleString(undefined, {
                    timeZone: series.timezone,
                  })}
                </TableCell>
                <TableCell align="right" sx={{ py: 1.5 }}>
                  <Link href={`/${organisation.slug}/i/${inst.id}`} style={{ color: "#0A84FF", fontSize: "0.875rem", fontWeight: 650 }}>
                    View event
                  </Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      {canDownloadReports ? (
        <>
          <Typography variant="h6" component="h2" sx={{ fontWeight: 700, letterSpacing: "-0.3px" }}>
            Reports
          </Typography>
          <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 }, borderRadius: "18px", borderColor: "rgba(255,255,255,0.08)", backgroundColor: "rgba(255,255,255,0.025)" }}>
            {finishedInstances.length ? (
              <Stack spacing={1.25}>
                {finishedInstances.map((instance) => (
                  <Stack key={instance.id} direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ alignItems: { xs: "flex-start", sm: "center" }, justifyContent: "space-between" }}>
                    <Typography variant="body2">
                      {instance.startDateTime.toLocaleString(undefined, { timeZone: series.timezone })}
                    </Typography>
                    <EventReportDownloadButton href={`/api/reports/instance/${instance.id}`} />
                  </Stack>
                ))}
              </Stack>
            ) : (
              <Typography variant="body2" color="text.secondary">
                Reports become available after an occurrence has finished.
              </Typography>
            )}
          </Paper>
        </>
      ) : null}

      {firstInstanceId ? (
        <>
          <Typography variant="h6" component="h2" sx={{ fontWeight: 700, letterSpacing: "-0.3px" }}>
            Attendees (first upcoming occurrence)
          </Typography>
          <AttendeeTable
            organisationSlug={organisation.slug}
            eventInstanceId={firstInstanceId}
            attendees={attendees}
            canManage
            registrationFields={[]}
          />
        </>
      ) : null}
    </Stack>
  );
}
