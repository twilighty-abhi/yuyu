import Typography from "@mui/material/Typography";
import Stack from "@mui/material/Stack";
import Grid from "@mui/material/Grid";
import Button from "@mui/material/Button";
import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";
import Paper from "@mui/material/Paper";
import Box from "@mui/material/Box";
import InputAdornment from "@mui/material/InputAdornment";
import Chip from "@mui/material/Chip";
import Link from "next/link";
import SearchIcon from "@mui/icons-material/Search";
import FilterListIcon from "@mui/icons-material/FilterList";
import ClearIcon from "@mui/icons-material/Clear";
import NavigateBeforeIcon from "@mui/icons-material/NavigateBefore";
import NavigateNextIcon from "@mui/icons-material/NavigateNext";
import { EventPrivacyType, EventStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { EventCard } from "@/components/event/EventCard";
import { InstanceCard } from "@/components/event/InstanceCard";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Discover Events",
  description:
    "Browse upcoming public events and find something worth attending.",
};

const PAGE_SIZE = 12;

type SearchParams = Promise<{
  sort?: string;
  from?: string;
  to?: string;
  q?: string;
  page?: string;
}>;

function buildQueryString(params: Record<string, string | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v) p.set(k, v);
  }
  const s = p.toString();
  return s ? `?${s}` : "";
}

export default async function DiscoverPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const sp = await searchParams;
  const sort = sp.sort === "popular" ? "popular" : "upcoming";
  const q = sp.q?.trim() || "";
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);

  const fromDate = sp.from ? new Date(sp.from) : null;
  const toDate = sp.to ? new Date(sp.to) : null;

  const eventWhere = {
    status: EventStatus.PUBLISHED,
    privacyType: EventPrivacyType.PUBLIC,
    ...(q
      ? {
          OR: [
            { title: { contains: q, mode: "insensitive" as const } },
            { description: { contains: q, mode: "insensitive" as const } },
          ],
        }
      : {}),
    ...((fromDate || toDate) && {
      startDateTime: {
        ...(fromDate && !Number.isNaN(fromDate.getTime()) ? { gte: fromDate } : {}),
        ...(toDate && !Number.isNaN(toDate.getTime()) ? { lte: toDate } : {}),
      },
    }),
  } as const;

  const instanceWhere = {
    series: {
      status: EventStatus.PUBLISHED,
      privacyType: EventPrivacyType.PUBLIC,
      ...(q
        ? {
            OR: [
              { title: { contains: q, mode: "insensitive" as const } },
              { description: { contains: q, mode: "insensitive" as const } },
            ],
          }
        : {}),
    },
    ...((fromDate || toDate) && {
      startDateTime: {
        ...(fromDate && !Number.isNaN(fromDate.getTime()) ? { gte: fromDate } : {}),
        ...(toDate && !Number.isNaN(toDate.getTime()) ? { lte: toDate } : {}),
      },
    }),
  };

  // Get total counts for pagination
  const [eventCount, instanceCount] = await Promise.all([
    prisma.event.count({ where: eventWhere }),
    prisma.eventInstance.count({ where: instanceWhere }),
  ]);
  const totalItems = eventCount + instanceCount;
  const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);

  // Fetch all matching items (we need to merge events + instances before paginating)
  // For efficiency, fetch only what we need with a reasonable limit
  const fetchLimit = Math.min(totalItems, 200);

  const [events, instances] = await Promise.all([
    prisma.event.findMany({
      where: eventWhere,
      include: {
        organisation: { select: { slug: true, name: true } },
        _count: {
          select: {
            rsvps: {
              where: { status: "CONFIRMED" },
            },
          },
        },
      },
      orderBy:
        sort === "popular"
          ? { rsvps: { _count: "desc" } }
          : { startDateTime: "asc" },
      take: fetchLimit,
    }),
    prisma.eventInstance.findMany({
      where: instanceWhere,
      include: {
        series: {
          include: {
            organisation: { select: { slug: true, name: true } },
          },
        },
        _count: {
          select: {
            rsvps: {
              where: { status: "CONFIRMED" },
            },
          },
        },
      },
      orderBy:
        sort === "popular"
          ? { rsvps: { _count: "desc" } }
          : { startDateTime: "asc" },
      take: fetchLimit,
    }),
  ]);

  type Row =
    | {
        kind: "event";
        id: string;
        sortKey: number;
        popular: number;
        orgSlug: string;
        event: (typeof events)[0];
      }
    | {
        kind: "instance";
        id: string;
        sortKey: number;
        popular: number;
        orgSlug: string;
        instance: (typeof instances)[0];
      };

  const merged: Row[] = [
    ...events.map((event) => ({
      kind: "event" as const,
      id: `e-${event.id}`,
      sortKey: event.startDateTime.getTime(),
      popular: event._count.rsvps,
      orgSlug: event.organisation.slug,
      event,
    })),
    ...instances.map((instance) => ({
      kind: "instance" as const,
      id: `i-${instance.id}`,
      sortKey: instance.startDateTime.getTime(),
      popular: instance._count.rsvps,
      orgSlug: instance.series.organisation.slug,
      instance,
    })),
  ];

  merged.sort((a, b) =>
    sort === "popular"
      ? b.popular - a.popular || a.sortKey - b.sortKey
      : a.sortKey - b.sortKey,
  );

  // Apply pagination to the merged list
  const startIdx = (safePage - 1) * PAGE_SIZE;
  const pageItems = merged.slice(startIdx, startIdx + PAGE_SIZE);

  const hasActiveFilters = q || sp.from || sp.to || sort !== "upcoming";

  // Build base params for pagination links (preserving current filters)
  const baseParams = {
    ...(q ? { q } : {}),
    ...(sort !== "upcoming" ? { sort } : {}),
    ...(sp.from ? { from: sp.from } : {}),
    ...(sp.to ? { to: sp.to } : {}),
  };

  return (
    <Stack spacing={4} sx={{ py: 3 }}>
      {/* Apple Style Minimalist Header */}
      <Stack
        spacing={0.5}
        sx={{
          pb: 2.5,
          borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
        }}
      >
        <Typography
          variant="h3"
          component="h1"
          sx={{
            fontWeight: 700,
            letterSpacing: "-1px",
            color: "#FFFFFF",
          }}
        >
          Discover events
        </Typography>
        <Typography variant="body2" sx={{ color: "#8E8E93" }}>
          Explore open gatherings, dynamic workshops, and local meetups across all organisations on Yuyu.
        </Typography>
      </Stack>

      {/* Modern Filter panel */}
      <Paper
        variant="outlined"
        component="form"
        action="/discover"
        method="get"
        sx={{
          p: 3,
          borderRadius: 3.5,
          backgroundColor: "#1C1C1E",
          borderColor: "rgba(255, 255, 255, 0.08)",
        }}
      >
        <Stack spacing={2.5}>
          {/* Main Search & Dropdown filters */}
          <Stack direction={{ xs: "column", md: "row" }} spacing={2} sx={{ alignItems: "center" }}>
            <TextField
              name="q"
              placeholder="Search by event title or description..."
              size="small"
              defaultValue={q}
              slotProps={{
                input: {
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchIcon sx={{ color: "rgba(255, 255, 255, 0.44)" }} />
                    </InputAdornment>
                  ),
                },
              }}
              sx={{ flexGrow: 1, minWidth: { xs: "100%", md: 320 } }}
            />

            <TextField
              select
              name="sort"
              label="Sort By"
              size="small"
              defaultValue={sort}
              sx={{ minWidth: { xs: "100%", md: 170 } }}
            >
              <MenuItem value="upcoming">Upcoming First</MenuItem>
              <MenuItem value="popular">Popularity</MenuItem>
            </TextField>

          </Stack>

          {/* Date Picker Range & Buttons */}
          <Stack
            direction={{ xs: "column", sm: "row" }}
            spacing={2}
            sx={{
              alignItems: "center",
              justifyContent: "space-between",
              pt: 2,
              borderTop: "1px solid rgba(255, 255, 255, 0.08)",
            }}
          >
            <Stack direction="row" spacing={2} sx={{ width: { xs: "100%", sm: "auto" } }}>
              <TextField
                name="from"
                label="From Date"
                type="date"
                size="small"
                slotProps={{ inputLabel: { shrink: true } }}
                defaultValue={sp.from ?? ""}
                sx={{ width: "100%" }}
              />
              <TextField
                name="to"
                label="To Date"
                type="date"
                size="small"
                slotProps={{ inputLabel: { shrink: true } }}
                defaultValue={sp.to ?? ""}
                sx={{ width: "100%" }}
              />
            </Stack>

            <Stack
              direction="row"
              spacing={1.5}
              sx={{ width: { xs: "100%", sm: "auto" }, justifyContent: "flex-end" }}
            >
              {hasActiveFilters && (
                <Button
                  component={Link}
                  href="/discover"
                  variant="text"
                  startIcon={<ClearIcon />}
                  sx={{
                    color: "#8E8E93",
                    transition: "color 0.2s",
                    "&:hover": { color: "#ffffff", backgroundColor: "rgba(255, 255, 255, 0.04)" },
                  }}
                >
                  Clear Filters
                </Button>
              )}
              <Button
                type="submit"
                variant="contained"
                startIcon={<FilterListIcon />}
                sx={{
                  backgroundColor: "#0A84FF",
                  color: "#FFFFFF",
                  fontWeight: 600,
                  px: 3.5,
                  borderRadius: "8px",
                  "&:hover": {
                    backgroundColor: "#0A84FF",
                    opacity: 0.9,
                  },
                }}
              >
                Apply Filters
              </Button>
            </Stack>
          </Stack>
        </Stack>
      </Paper>

      {/* Results count */}
      {totalItems > 0 ? (
        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          <Typography variant="body2" color="text.secondary">
            Showing {startIdx + 1}–{Math.min(startIdx + PAGE_SIZE, totalItems)} of{" "}
            {totalItems} event{totalItems === 1 ? "" : "s"}
          </Typography>
          {totalPages > 1 ? (
            <Chip
              label={`Page ${safePage} of ${totalPages}`}
              size="small"
              variant="outlined"
            />
          ) : null}
        </Stack>
      ) : null}

      {pageItems.length === 0 ? (
        <Typography color="text.secondary" sx={{ textAlign: "center", py: 4 }}>
          No public events match the selected filters. Try clearing some criteria!
        </Typography>
      ) : (
        <Grid container spacing={2}>
          {pageItems.map((row) =>
            row.kind === "event" ? (
              <Grid size={{ xs: 12, sm: 6, md: 4 }} key={row.id}>
                <EventCard orgSlug={row.orgSlug} event={row.event} />
              </Grid>
            ) : (
              <Grid size={{ xs: 12, sm: 6, md: 4 }} key={row.id}>
                <InstanceCard
                  orgSlug={row.orgSlug}
                  instanceId={row.instance.id}
                  title={row.instance.series.title}
                  description={row.instance.series.description}
                  startDateTime={row.instance.startDateTime}
                  endDateTime={row.instance.endDateTime}
                  timezone={row.instance.series.timezone}
                />
              </Grid>
            ),
          )}
        </Grid>
      )}

      {/* Pagination controls */}
      {totalPages > 1 ? (
        <Stack
          direction="row"
          spacing={1}
          sx={{
            justifyContent: "center",
            alignItems: "center",
            pt: 2,
          }}
        >
          <Button
            component={Link}
            href={`/discover${buildQueryString({ ...baseParams, page: String(safePage - 1) })}`}
            variant="outlined"
            size="small"
            disabled={safePage <= 1}
            startIcon={<NavigateBeforeIcon />}
            sx={{ borderRadius: 2 }}
          >
            Previous
          </Button>

          {/* Page number buttons - show up to 7 pages */}
          {(() => {
            const pages: number[] = [];
            let start = Math.max(1, safePage - 3);
            const end = Math.min(totalPages, start + 6);
            start = Math.max(1, end - 6);
            for (let i = start; i <= end; i++) pages.push(i);

            return pages.map((p) => (
              <Button
                key={p}
                component={Link}
                href={`/discover${buildQueryString({ ...baseParams, page: String(p) })}`}
                variant={p === safePage ? "contained" : "text"}
                size="small"
                sx={{
                  minWidth: 40,
                  borderRadius: 2,
                  ...(p === safePage
                    ? {
                        backgroundColor: "#0A84FF",
                        color: "#FFFFFF",
                        fontWeight: 600,
                      }
                    : {
                        color: "#8E8E93",
                      }),
                }}
              >
                {p}
              </Button>
            ));
          })()}

          <Button
            component={Link}
            href={`/discover${buildQueryString({ ...baseParams, page: String(safePage + 1) })}`}
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
  );
}
