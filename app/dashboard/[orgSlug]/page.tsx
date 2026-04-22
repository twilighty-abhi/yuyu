import Typography from "@mui/material/Typography";
import Stack from "@mui/material/Stack";
import Grid from "@mui/material/Grid";
import Paper from "@mui/material/Paper";
import Box from "@mui/material/Box";
import { prisma } from "@/lib/db";
import {
  canDeleteOrg,
  canManageEvents,
  isOrgAdmin,
  requireOrgMembership,
} from "@/lib/permissions";
import Link from "next/link";
import Button from "@mui/material/Button";
import { EventCard } from "@/components/event/EventCard";
import { CreateEventDialog } from "@/components/event/CreateEventDialog";
import { CreateSeriesDialog } from "@/components/series/CreateSeriesDialog";
import { DeleteOrganisationButton } from "@/components/dashboard/DeleteOrganisationButton";

type Props = { params: Promise<{ orgSlug: string }> };

export default async function OrgDashboardPage({ params }: Props) {
  const { orgSlug } = await params;
  const { organisation, membership } = await requireOrgMembership(orgSlug);
  const manage = canManageEvents(membership);
  const owner = canDeleteOrg(membership);
  const admin = isOrgAdmin(membership.role);

  const events = await prisma.event.findMany({
    where: { organisationId: organisation.id },
    orderBy: { startDateTime: "asc" },
  });

  const orgSeries = await prisma.organisation.findUnique({
    where: { id: organisation.id },
    select: {
      eventSeries: { orderBy: { createdAt: "desc" } },
    },
  });
  const seriesList = orgSeries?.eventSeries ?? [];

  const totalRsvps = await prisma.rSVP.count({
    where: {
      OR: [
        { event: { organisationId: organisation.id } },
        { eventInstance: { series: { organisationId: organisation.id } } },
      ],
    },
  });

  return (
    <>
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={2}
        sx={{
          justifyContent: "space-between",
          alignItems: { xs: "flex-start", sm: "center" },
        }}
      >
        <Typography variant="body2" color="text.secondary">
          Manage events and members for this organisation.
        </Typography>
        <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap" }}>
          {admin ? (
            <Link
              href={`/dashboard/${organisation.slug}/settings`}
              style={{ textDecoration: "none" }}
            >
              <Button variant="outlined" size="small">
                Settings
              </Button>
            </Link>
          ) : null}
          {owner ? (
            <DeleteOrganisationButton organisationSlug={organisation.slug} />
          ) : null}
        </Stack>
      </Stack>

      <Grid container spacing={2} sx={{ mt: 0 }}>
        <Grid size={{ xs: 12, sm: 6, md: 4 }}>
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="subtitle2" color="text.secondary">
              Total events
            </Typography>
            <Typography variant="h4" component="p">
              {events.length}
            </Typography>
          </Paper>
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 4 }}>
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="subtitle2" color="text.secondary">
              Total RSVPs
            </Typography>
            <Typography variant="h4" component="p">
              {totalRsvps}
            </Typography>
          </Paper>
        </Grid>
      </Grid>

      {manage ? (
        <Stack direction="row" spacing={2} sx={{ flexWrap: "wrap", mt: 2 }}>
          <CreateEventDialog
            organisationSlug={organisation.slug}
            canPublish={manage}
            variant="button"
          />
          <CreateSeriesDialog
            organisationSlug={organisation.slug}
            canPublish={manage}
          />
        </Stack>
      ) : null}

      <Typography variant="h6" component="h2" sx={{ mt: 2, mb: 2 }}>
        Event series
      </Typography>
      {seriesList.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 3, mb: 2 }}>
          <Typography color="text.secondary">
            No recurring series yet.
          </Typography>
        </Paper>
      ) : (
        <Stack spacing={1} sx={{ mb: 3 }}>
          {seriesList.map((s) => (
            <Paper key={s.id} variant="outlined" sx={{ px: 2, py: 1.5 }}>
              <Link
                href={`/dashboard/${organisation.slug}/series/${s.id}`}
                style={{ textDecoration: "none" }}
              >
                <Button
                  sx={{ justifyContent: "flex-start", textTransform: "none" }}
                  fullWidth
                >
                  {s.title}
                </Button>
              </Link>
            </Paper>
          ))}
        </Stack>
      )}

      <Typography variant="h6" component="h2" sx={{ mt: 2, mb: 2 }}>
        Events
      </Typography>

      {events.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 4, textAlign: "center" }}>
          <Typography color="text.secondary">
            No events yet.
            {manage ? " Create one with the button below." : ""}
          </Typography>
        </Paper>
      ) : (
        <Grid container spacing={2}>
          {events.map((event) => (
            <Grid size={{ xs: 12, sm: 6, md: 4 }} key={event.id}>
              <EventCard
                orgSlug={organisation.slug}
                href={
                  manage
                    ? `/dashboard/${organisation.slug}/event/${event.id}`
                    : undefined
                }
                event={event}
              />
            </Grid>
          ))}
        </Grid>
      )}

      {manage ? (
        <Box sx={{ position: "fixed", right: 24, bottom: 24, zIndex: 10 }}>
          <CreateEventDialog
            organisationSlug={organisation.slug}
            canPublish={manage}
            variant="fab"
          />
        </Box>
      ) : null}
    </>
  );
}
