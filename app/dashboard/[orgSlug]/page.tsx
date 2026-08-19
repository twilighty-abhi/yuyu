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
import NavigateBeforeIcon from "@mui/icons-material/NavigateBefore";
import NavigateNextIcon from "@mui/icons-material/NavigateNext";
import Chip from "@mui/material/Chip";

import type { Metadata } from "next";

type Props = {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<{ page?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { orgSlug } = await params;
  const org = await prisma.organisation.findUnique({
    where: { slug: orgSlug },
    select: { name: true },
  });
  return {
    title: org ? `${org.name} Dashboard` : "Dashboard",
  };
}

export default async function OrgDashboardPage({ params, searchParams }: Props) {
  const { orgSlug } = await params;
  const sp = await searchParams;
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const pageSize = 6;

  const { organisation, membership } = await requireOrgMembership(orgSlug);
  const manage = canManageEvents(membership);
  const owner = canDeleteOrg(membership);
  const admin = isOrgAdmin(membership.role);

  const totalEvents = await prisma.event.count({
    where: { organisationId: organisation.id },
  });
  const totalPages = Math.ceil(totalEvents / pageSize) || 1;
  const safePage = Math.min(page, totalPages);

  const events = await prisma.event.findMany({
    where: { organisationId: organisation.id },
    orderBy: { startDateTime: "asc" },
    skip: (safePage - 1) * pageSize,
    take: pageSize,
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
          alignItems: { xs: "stretch", sm: "flex-end" },
          pb: 1.5,
          borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
          mb: 1,
        }}
      >
        <Stack spacing={0.5}>
          <Typography
            variant="h4"
            component="h1"
            sx={{ fontWeight: 700, letterSpacing: "-1px" }}
          >
            {organisation.name}
          </Typography>
          <Typography variant="body2" sx={{ color: "#8E8E93" }}>
            Manage events, membership lists, and settings for this organisation.
          </Typography>
        </Stack>
        <Stack direction="row" spacing={1.5} useFlexGap sx={{ flexWrap: "wrap", alignItems: "center" }}>
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
          <Paper
            variant="outlined"
            sx={{
              p: 3,
              borderRadius: "16px",
              backgroundColor: "#1C1C1E",
              borderColor: "rgba(255, 255, 255, 0.08)",
            }}
          >
            <Typography variant="body2" sx={{ color: "#8E8E93", fontWeight: 600, fontSize: "0.8rem", textTransform: "uppercase", letterSpacing: "0.5px" }}>
              Total events
            </Typography>
            <Typography variant="h3" sx={{ fontWeight: 700, mt: 1, letterSpacing: "-1px" }}>
              {totalEvents}
            </Typography>
          </Paper>
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 4 }}>
          <Paper
            variant="outlined"
            sx={{
              p: 3,
              borderRadius: "16px",
              backgroundColor: "#1C1C1E",
              borderColor: "rgba(255, 255, 255, 0.08)",
            }}
          >
            <Typography variant="body2" sx={{ color: "#8E8E93", fontWeight: 600, fontSize: "0.8rem", textTransform: "uppercase", letterSpacing: "0.5px" }}>
              Total RSVPs
            </Typography>
            <Typography variant="h3" sx={{ fontWeight: 700, mt: 1, letterSpacing: "-1px" }}>
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
        <Stack spacing={2.5}>
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

          <Stack
            direction={{ xs: "column", sm: "row" }}
            spacing={1}
            sx={{ alignItems: "center", justifyContent: "space-between" }}
          >
            <Typography variant="body2" color="text.secondary">
              Showing {((safePage - 1) * pageSize) + 1}–{Math.min(safePage * pageSize, totalEvents)} of {totalEvents} event{totalEvents === 1 ? "" : "s"}
            </Typography>
            {totalPages > 1 ? (
              <Chip label={`Page ${safePage} of ${totalPages}`} size="small" variant="outlined" />
            ) : null}
          </Stack>

          {totalPages > 1 ? (
            <Stack direction="row" spacing={1} sx={{ justifyContent: "center", pt: 1 }}>
              <Button
                component={Link}
                href={`/dashboard/${organisation.slug}?page=${safePage - 1}`}
                variant="outlined"
                size="small"
                disabled={safePage <= 1}
                startIcon={<NavigateBeforeIcon />}
                sx={{ borderRadius: 2 }}
              >
                Previous
              </Button>
              {(() => {
                const pages = [];
                for (let i = 1; i <= totalPages; i++) {
                  pages.push(i);
                }
                return pages.map((p) => (
                  <Button
                    key={p}
                    component={Link}
                    href={`/dashboard/${organisation.slug}?page=${p}`}
                    variant={p === safePage ? "contained" : "text"}
                    size="small"
                    sx={{
                      minWidth: 40,
                      borderRadius: 2,
                      ...(p === safePage
                        ? {
                            background: "linear-gradient(135deg, #7CF5B6 0%, #B9AEFF 100%)",
                            color: "#061814",
                            fontWeight: 750,
                          }
                        : {}),
                    }}
                  >
                    {p}
                  </Button>
                ));
              })()}
              <Button
                component={Link}
                href={`/dashboard/${organisation.slug}?page=${safePage + 1}`}
                variant="outlined"
                size="small"
                disabled={safePage >= totalPages}
                endIcon={<NavigateNextIcon />}
                sx={{ borderRadius: 2 }}
              >
                Next
              </Button>
            </Stack>
          ) : null}
        </Stack>
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
