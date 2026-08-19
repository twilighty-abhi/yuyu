import Typography from "@mui/material/Typography";
import Stack from "@mui/material/Stack";
import Grid from "@mui/material/Grid";
import Paper from "@mui/material/Paper";
import Box from "@mui/material/Box";
import { prisma } from "@/lib/db";
import {
  canManageEvents,
  isOrgAdmin,
  requireOrgMembership,
} from "@/lib/permissions";
import Link from "next/link";
import Button from "@mui/material/Button";
import { EventCard } from "@/components/event/EventCard";
import { CreateEventDialog } from "@/components/event/CreateEventDialog";
import { CreateSeriesDialog } from "@/components/series/CreateSeriesDialog";
import NavigateBeforeIcon from "@mui/icons-material/NavigateBefore";
import NavigateNextIcon from "@mui/icons-material/NavigateNext";
import Chip from "@mui/material/Chip";
import EventIcon from "@mui/icons-material/Event";
import AddIcon from "@mui/icons-material/Add";
import RepeatIcon from "@mui/icons-material/Repeat";

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

  return (
    <>
      <Paper
        variant="outlined"
        sx={{
          p: { xs: 2.5, sm: 3.5 },
          borderRadius: "22px",
          borderColor: "rgba(255, 255, 255, 0.09)",
          background: "linear-gradient(120deg, rgba(10,132,255,0.15), rgba(28,28,30,0.96) 55%, rgba(48,209,88,0.08))",
          boxShadow: "0 18px 45px rgba(0,0,0,0.14)",
        }}
      >
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={2}
          sx={{ justifyContent: "space-between", alignItems: { xs: "stretch", sm: "flex-end" } }}
        >
        <Stack spacing={0.5}>
          <Typography variant="overline" sx={{ color: "#0A84FF", fontWeight: 700, letterSpacing: "1.5px", lineHeight: 1.3 }}>
            Organisation workspace
          </Typography>
          <Typography
            variant="h4"
            component="h1"
            sx={{ fontWeight: 700, letterSpacing: "-1px" }}
          >
            {organisation.name}
          </Typography>
          <Typography variant="body2" sx={{ color: "rgba(255,255,255,0.58)", maxWidth: 560 }}>
            Plan events, manage your members, and keep your organisation moving.
          </Typography>
        </Stack>
        <Stack direction="row" spacing={2} useFlexGap sx={{ flexWrap: "wrap", alignItems: "center" }}>
          <Stack spacing={0} sx={{ minWidth: 92, pr: { sm: 1 } }}>
            <Typography variant="caption" sx={{ color: "rgba(255,255,255,0.58)", textTransform: "uppercase", letterSpacing: "0.8px", fontWeight: 700 }}>
              Active events
            </Typography>
            <Typography variant="h4" sx={{ fontWeight: 720, letterSpacing: "-1px" }}>
              {totalEvents}
            </Typography>
          </Stack>
          <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap", alignItems: "center" }}>
            {admin ? (
              <Link href={`/dashboard/${organisation.slug}/settings`} style={{ textDecoration: "none" }}>
                <Button variant="outlined" size="small" sx={{ textTransform: "none", borderRadius: 2 }}>
                  Settings
                </Button>
              </Link>
            ) : null}
          </Stack>
        </Stack>
        </Stack>
      </Paper>

      {manage ? (
        <Paper
          variant="outlined"
          sx={{
            mt: 3,
            px: { xs: 2, sm: 2.5 },
            py: 1.5,
            borderRadius: "16px",
            borderColor: "rgba(255,255,255,0.08)",
            backgroundColor: "rgba(255,255,255,0.025)",
          }}
        >
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} sx={{ justifyContent: "space-between", alignItems: { xs: "flex-start", sm: "center" } }}>
            <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
              <Box sx={{ display: "grid", placeItems: "center", width: 30, height: 30, borderRadius: 2, color: "#0A84FF", backgroundColor: "rgba(10,132,255,0.14)" }}>
                <AddIcon fontSize="small" />
              </Box>
              <Typography variant="body2" sx={{ fontWeight: 650 }}>Create something new</Typography>
            </Stack>
            <Stack direction="row" spacing={1.25} sx={{ flexWrap: "wrap" }}>
              <CreateEventDialog organisationSlug={organisation.slug} canPublish={manage} variant="button" />
              <CreateSeriesDialog organisationSlug={organisation.slug} canPublish={manage} />
            </Stack>
          </Stack>
        </Paper>
      ) : null}

      <Stack direction="row" spacing={1} sx={{ mt: 4, mb: 1.5, alignItems: "center" }}>
        <RepeatIcon sx={{ color: "#8E8E93", fontSize: 20 }} />
        <Typography variant="h6" component="h2" sx={{ fontWeight: 700, letterSpacing: "-0.3px" }}>Event series</Typography>
      </Stack>
      {seriesList.length === 0 ? (
        <Paper variant="outlined" sx={{ p: { xs: 2, sm: 2.5 }, mb: 3, borderRadius: "16px", borderColor: "rgba(255,255,255,0.08)", backgroundColor: "rgba(255,255,255,0.025)" }}>
          <Typography color="text.secondary" variant="body2">
            No recurring series yet. Create one to keep a regular event rhythm.
          </Typography>
        </Paper>
      ) : (
        <Stack spacing={1} sx={{ mb: 3 }}>
          {seriesList.map((s) => (
            <Paper key={s.id} variant="outlined" sx={{ px: 1, py: 0.5, borderRadius: "14px", borderColor: "rgba(255,255,255,0.08)" }}>
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

      <Stack direction="row" spacing={1} sx={{ mt: 4, mb: 1.5, alignItems: "center" }}>
        <EventIcon sx={{ color: "#8E8E93", fontSize: 20 }} />
        <Typography variant="h6" component="h2" sx={{ fontWeight: 700, letterSpacing: "-0.3px" }}>Events</Typography>
      </Stack>

      {events.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 5, textAlign: "center", borderRadius: "16px", borderColor: "rgba(255,255,255,0.08)", backgroundColor: "rgba(255,255,255,0.025)" }}>
          <Typography color="text.secondary">
            No events yet.
            {manage ? " Create one with the button below." : ""}
          </Typography>
        </Paper>
      ) : (
        <Stack spacing={2.5}>
            <Grid container spacing={2.5}>
              {events.map((event) => (
              <Grid size={{ xs: 12, sm: 6 }} key={event.id}>
                <EventCard
                  orgSlug={organisation.slug}
                  compact
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
