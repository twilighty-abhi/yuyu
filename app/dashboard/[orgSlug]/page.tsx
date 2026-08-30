import Typography from "@mui/material/Typography";
import Stack from "@mui/material/Stack";
import Grid from "@mui/material/Grid";
import Paper from "@mui/material/Paper";
import Box from "@mui/material/Box";
import { prisma } from "@/lib/db";
import {
  canManageEvents,
  isOrgAdmin,
  requireOrgDashboardAccess,
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
import { EventStatus, type Prisma } from "@prisma/client";
import { paginationWindow } from "@/lib/pagination";

import type { Metadata } from "next";

type Props = {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<{ page?: string; seriesPage?: string; view?: string }>;
};

const EVENT_PAGE_SIZE = 6;
const SERIES_PAGE_SIZE = 6;
type EventView = "upcoming" | "past" | "draft" | "all";

function dashboardQuery(params: { view: EventView; page?: number; seriesPage?: number }) {
  const query = new URLSearchParams();
  if (params.view !== "upcoming") query.set("view", params.view);
  if (params.page && params.page > 1) query.set("page", String(params.page));
  if (params.seriesPage && params.seriesPage > 1) query.set("seriesPage", String(params.seriesPage));
  const value = query.toString();
  return value ? `?${value}` : "";
}

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
  const seriesPage = Math.max(1, parseInt(sp.seriesPage ?? "1", 10) || 1);
  const view: EventView = ["upcoming", "past", "draft", "all"].includes(sp.view ?? "")
    ? (sp.view as EventView)
    : "upcoming";

  const access = await requireOrgDashboardAccess(orgSlug);
  const { organisation, membership } = access;
  if (!membership) {
    const grants = await prisma.eventCollaborator.findMany({ where: { userId: access.userId, OR: [{ event: { organisationId: organisation.id } }, { series: { organisationId: organisation.id } }] }, include: { event: true, series: true } });
    return <Stack spacing={2}><Typography variant="h4">{organisation.name}</Typography><Typography color="text.secondary">Your assigned events</Typography>{grants.map((grant) => grant.event ? <Link key={grant.id} href={`/dashboard/${organisation.slug}/event/${grant.event.id}`}><Button variant="outlined">{grant.event.title}</Button></Link> : grant.series ? <Link key={grant.id} href={`/dashboard/${organisation.slug}/series/${grant.series.id}`}><Button variant="outlined">{grant.series.title}</Button></Link> : null)}</Stack>;
  }
  const manage = canManageEvents(membership);
  const admin = isOrgAdmin(membership.role);

  const now = new Date();
  const eventWhere: Prisma.EventWhereInput = {
    organisationId: organisation.id,
    ...(view === "upcoming" ? { status: EventStatus.PUBLISHED, endDateTime: { gte: now } } : {}),
    ...(view === "past" ? { status: EventStatus.PUBLISHED, endDateTime: { lt: now } } : {}),
    ...(view === "draft" ? { status: EventStatus.DRAFT } : {}),
  };
  const [activeEvents, totalEvents, totalSeries] = await Promise.all([
    prisma.event.count({ where: { organisationId: organisation.id, status: EventStatus.PUBLISHED, endDateTime: { gte: now } } }),
    prisma.event.count({ where: eventWhere }),
    prisma.eventSeries.count({ where: { organisationId: organisation.id } }),
  ]);
  const totalPages = Math.ceil(totalEvents / EVENT_PAGE_SIZE) || 1;
  const safePage = Math.min(page, totalPages);
  const totalSeriesPages = Math.ceil(totalSeries / SERIES_PAGE_SIZE) || 1;
  const safeSeriesPage = Math.min(seriesPage, totalSeriesPages);

  const [events, seriesList] = await Promise.all([
    prisma.event.findMany({
      where: eventWhere,
      orderBy: view === "past" ? { startDateTime: "desc" } : view === "all" || view === "draft" ? { createdAt: "desc" } : { startDateTime: "asc" },
      skip: (safePage - 1) * EVENT_PAGE_SIZE,
      take: EVENT_PAGE_SIZE,
    }),
    prisma.eventSeries.findMany({
      where: { organisationId: organisation.id },
      orderBy: { createdAt: "desc" },
      skip: (safeSeriesPage - 1) * SERIES_PAGE_SIZE,
      take: SERIES_PAGE_SIZE,
    }),
  ]);

  return (
    <>
      <Paper
        variant="outlined"
        sx={{
          p: { xs: 2.5, sm: 3.5 },
          borderRadius: "22px",
          borderColor: "divider",
          backgroundColor: "background.paper",
          backgroundImage: "linear-gradient(120deg, rgba(10,132,255,0.13), transparent 58%, rgba(48,209,88,0.08))",
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
          <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 560 }}>
            Plan events, manage your members, and keep your organisation moving.
          </Typography>
        </Stack>
        <Stack direction="row" spacing={2} useFlexGap sx={{ flexWrap: "wrap", alignItems: "center" }}>
          <Stack spacing={0} sx={{ minWidth: 92, pr: { sm: 1 } }}>
            <Typography variant="caption" color="text.secondary" sx={{ textTransform: "uppercase", letterSpacing: "0.8px", fontWeight: 700 }}>
              Active events
            </Typography>
            <Typography variant="h4" sx={{ fontWeight: 720, letterSpacing: "-1px" }}>
              {activeEvents}
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
            borderColor: "divider",
            backgroundColor: "background.paper",
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
          {totalSeriesPages > 1 ? (
            <Stack direction="row" spacing={1} sx={{ alignItems: "center", justifyContent: "flex-end" }}>
              <Button href={`/dashboard/${organisation.slug}${dashboardQuery({ view, page: safePage, seriesPage: safeSeriesPage - 1 })}`} size="small" disabled={safeSeriesPage <= 1}>Previous series</Button>
              <Chip label={`Series page ${safeSeriesPage} of ${totalSeriesPages}`} size="small" variant="outlined" />
              <Button href={`/dashboard/${organisation.slug}${dashboardQuery({ view, page: safePage, seriesPage: safeSeriesPage + 1 })}`} size="small" disabled={safeSeriesPage >= totalSeriesPages}>Next series</Button>
            </Stack>
          ) : null}
        </Stack>
      )}

      <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} sx={{ mt: 4, mb: 1.5, alignItems: { xs: "stretch", sm: "center" }, justifyContent: "space-between" }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          <EventIcon color="disabled" sx={{ fontSize: 20 }} />
          <Typography variant="h6" component="h2" sx={{ fontWeight: 700, letterSpacing: "-0.3px" }}>Events</Typography>
        </Stack>
        <Stack component="nav" direction="row" spacing={0.5} useFlexGap sx={{ flexWrap: "wrap" }} aria-label="Filter events">
          {(["upcoming", "past", "draft", "all"] as const).map((option) => (
            <Button
              key={option}
              href={`/dashboard/${organisation.slug}${dashboardQuery({ view: option, seriesPage: safeSeriesPage })}`}
              size="small"
              variant={view === option ? "contained" : "text"}
              aria-current={view === option ? "page" : undefined}
            >
              {option[0].toUpperCase() + option.slice(1)}
            </Button>
          ))}
        </Stack>
      </Stack>

      {events.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 5, textAlign: "center", borderRadius: "16px", borderColor: "divider", backgroundColor: "background.paper" }}>
          <Typography color="text.secondary">
            {view === "upcoming" ? "No upcoming published events." : `No ${view} events found.`}
            {manage && view === "upcoming" ? " Create one using New event." : ""}
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
              Showing {((safePage - 1) * EVENT_PAGE_SIZE) + 1}–{Math.min(safePage * EVENT_PAGE_SIZE, totalEvents)} of {totalEvents} event{totalEvents === 1 ? "" : "s"}
            </Typography>
            {totalPages > 1 ? (
              <Chip label={`Page ${safePage} of ${totalPages}`} size="small" variant="outlined" />
            ) : null}
          </Stack>

          {totalPages > 1 ? (
            <Stack direction="row" spacing={1} sx={{ justifyContent: "center", pt: 1 }}>
              {safePage <= 1 ? (
                <Button variant="outlined" size="small" disabled startIcon={<NavigateBeforeIcon />} sx={{ borderRadius: 2 }}>
                  Previous
                </Button>
              ) : (
                <Link href={`/dashboard/${organisation.slug}${dashboardQuery({ view, page: safePage - 1, seriesPage: safeSeriesPage })}`} style={{ textDecoration: "none" }}>
                  <Button component="span" variant="outlined" size="small" startIcon={<NavigateBeforeIcon />} sx={{ borderRadius: 2 }}>
                    Previous
                  </Button>
                </Link>
              )}
              {paginationWindow(safePage, totalPages).map((p) => (
                  <Link key={p} href={`/dashboard/${organisation.slug}${dashboardQuery({ view, page: p, seriesPage: safeSeriesPage })}`} style={{ textDecoration: "none" }}>
                    <Button
                      component="span"
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
                  </Link>
                ))}
              {safePage >= totalPages ? (
                <Button variant="outlined" size="small" disabled endIcon={<NavigateNextIcon />} sx={{ borderRadius: 2 }}>
                  Next
                </Button>
              ) : (
                <Link href={`/dashboard/${organisation.slug}${dashboardQuery({ view, page: safePage + 1, seriesPage: safeSeriesPage })}`} style={{ textDecoration: "none" }}>
                  <Button component="span" variant="outlined" size="small" endIcon={<NavigateNextIcon />} sx={{ borderRadius: 2 }}>
                    Next
                  </Button>
                </Link>
              )}
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
