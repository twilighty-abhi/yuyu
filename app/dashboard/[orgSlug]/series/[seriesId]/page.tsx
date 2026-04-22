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
import { requireOrgRole } from "@/lib/permissions";
import { EditSeriesForm } from "@/components/series/EditSeriesForm";
import { SeriesInvitePanel } from "@/components/invites/SeriesInvitePanel";
import { AttendeeTable } from "@/components/attendees/AttendeeTable";

type Props = { params: Promise<{ orgSlug: string; seriesId: string }> };

export default async function SeriesManagePage({ params }: Props) {
  const { orgSlug, seriesId } = await params;
  const { organisation } = await requireOrgRole(orgSlug, "ADMIN");

  const series = await prisma.eventSeries.findFirst({
    where: { id: seriesId, organisationId: organisation.id },
    include: {
      instances: {
        orderBy: { startDateTime: "asc" },
        take: 20,
      },
    },
  });
  if (!series) notFound();

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
  const attendees = rsvps.map((r) => ({
    id: r.id,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
    guestEmail: r.guestEmail,
    user: r.user
      ? { name: r.user.name, email: r.user.email }
      : null,
    checkedInAt: r.checkedInAt?.toISOString() ?? null,
    ticketUrl: `${origin}/ticket/${r.checkInToken}`,
  }));

  return (
    <Stack spacing={3}>
      <Typography variant="h5" component="h1" sx={{ fontWeight: 600 }}>
        {series.title}
      </Typography>

      <Paper variant="outlined" sx={{ p: 3 }}>
        <Typography variant="subtitle1" gutterBottom sx={{ fontWeight: 600 }}>
          Series details
        </Typography>
        <EditSeriesForm organisationSlug={organisation.slug} series={series} />
      </Paper>

      <Typography variant="h6" component="h2">
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

      <Typography variant="h6" component="h2">
        Upcoming instances
      </Typography>
      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Start</TableCell>
              <TableCell align="right">Link</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {series.instances.map((inst) => (
              <TableRow key={inst.id}>
                <TableCell>
                  {inst.startDateTime.toLocaleString(undefined, {
                    timeZone: series.timezone,
                  })}
                </TableCell>
                <TableCell align="right">
                  <Link href={`/${organisation.slug}/i/${inst.id}`}>
                    Public page
                  </Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      {firstInstanceId ? (
        <>
          <Typography variant="h6" component="h2">
            Attendees (first upcoming occurrence)
          </Typography>
          <AttendeeTable
            organisationSlug={organisation.slug}
            eventInstanceId={firstInstanceId}
            attendees={attendees}
            canManage
          />
        </>
      ) : null}
    </Stack>
  );
}
