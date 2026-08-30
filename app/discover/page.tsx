import Typography from "@mui/material/Typography";
import Stack from "@mui/material/Stack";
import Grid from "@mui/material/Grid";
import Button from "@mui/material/Button";
import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";
import Paper from "@mui/material/Paper";
import InputAdornment from "@mui/material/InputAdornment";
import Chip from "@mui/material/Chip";
import Link from "next/link";
import SearchIcon from "@mui/icons-material/Search";
import FilterListIcon from "@mui/icons-material/FilterList";
import ClearIcon from "@mui/icons-material/Clear";
import NavigateBeforeIcon from "@mui/icons-material/NavigateBefore";
import NavigateNextIcon from "@mui/icons-material/NavigateNext";
import { EventPrivacyType, EventStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { DiscoverEventCard } from "@/components/event/DiscoverEventCard";
import { InstanceCard } from "@/components/event/InstanceCard";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Discover Events",
  description:
    "Browse upcoming public events and find something worth attending.",
};

const PAGE_SIZE = 12;
const MAX_DISCOVERY_PAGES = 100;
const MAX_QUERY_LENGTH = 120;

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
  const q = (sp.q?.trim() || "").slice(0, MAX_QUERY_LENGTH);
  const page = Math.min(MAX_DISCOVERY_PAGES, Math.max(1, parseInt(sp.page ?? "1", 10) || 1));

  const fromDate = sp.from ? new Date(sp.from) : null;
  const toDate = sp.to ? new Date(sp.to) : null;

  const eventWhere = {
    status: EventStatus.PUBLISHED,
    privacyType: EventPrivacyType.PUBLIC,
    page: { is: { isPublished: true } },
    endDateTime: { gte: new Date() },
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
    endDateTime: { gte: new Date() },
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
  const totalPages = Math.min(MAX_DISCOVERY_PAGES, Math.max(1, Math.ceil(totalItems / PAGE_SIZE)));
  const safePage = Math.min(page, totalPages);
  const startIdx = (safePage - 1) * PAGE_SIZE;
  const validFrom = fromDate && !Number.isNaN(fromDate.getTime()) ? fromDate : null;
  const validTo = toDate && !Number.isNaN(toDate.getTime()) ? toDate : null;
  const searchPattern = `%${q}%`;
  const eventFilters = [
    Prisma.sql`e."status" = ${EventStatus.PUBLISHED}::"EventStatus"`,
    Prisma.sql`e."privacyType" = ${EventPrivacyType.PUBLIC}::"EventPrivacyType"`,
    Prisma.sql`EXISTS (SELECT 1 FROM "EventPage" ep WHERE ep."eventId" = e."id" AND ep."isPublished" = TRUE)`,
    Prisma.sql`e."endDateTime" >= NOW()`,
    ...(q ? [Prisma.sql`(e."title" ILIKE ${searchPattern} OR e."description" ILIKE ${searchPattern})`] : []),
    ...(validFrom ? [Prisma.sql`e."startDateTime" >= ${validFrom}`] : []),
    ...(validTo ? [Prisma.sql`e."startDateTime" <= ${validTo}`] : []),
  ];
  const instanceFilters = [
    Prisma.sql`s."status" = ${EventStatus.PUBLISHED}::"EventStatus"`,
    Prisma.sql`s."privacyType" = ${EventPrivacyType.PUBLIC}::"EventPrivacyType"`,
    Prisma.sql`i."endDateTime" >= NOW()`,
    ...(q ? [Prisma.sql`(s."title" ILIKE ${searchPattern} OR s."description" ILIKE ${searchPattern})`] : []),
    ...(validFrom ? [Prisma.sql`i."startDateTime" >= ${validFrom}`] : []),
    ...(validTo ? [Prisma.sql`i."startDateTime" <= ${validTo}`] : []),
  ];
  const ordering = sort === "popular"
    ? Prisma.sql`"popularity" DESC, "startDateTime" ASC, "id" ASC`
    : Prisma.sql`"startDateTime" ASC, "id" ASC`;
  const indexRows = await prisma.$queryRaw<Array<{ kind: "event" | "instance"; id: string }>>(Prisma.sql`
    WITH candidates AS (
      SELECT 'event'::text AS "kind", e."id", e."startDateTime",
        (SELECT COUNT(*)::int FROM "RSVP" r WHERE r."eventId" = e."id" AND r."status" = 'CONFIRMED'::"RsvpStatus") AS "popularity"
      FROM "Event" e
      WHERE ${Prisma.join(eventFilters, " AND ")}
      UNION ALL
      SELECT 'instance'::text AS "kind", i."id", i."startDateTime",
        (SELECT COUNT(*)::int FROM "RSVP" r WHERE r."eventInstanceId" = i."id" AND r."status" = 'CONFIRMED'::"RsvpStatus") AS "popularity"
      FROM "EventInstance" i
      INNER JOIN "EventSeries" s ON s."id" = i."eventSeriesId"
      WHERE ${Prisma.join(instanceFilters, " AND ")}
    )
    SELECT "kind", "id" FROM candidates
    ORDER BY ${ordering}
    LIMIT ${PAGE_SIZE} OFFSET ${startIdx}
  `);
  const eventIds = indexRows.filter((row) => row.kind === "event").map((row) => row.id);
  const instanceIds = indexRows.filter((row) => row.kind === "instance").map((row) => row.id);
  const [events, instances] = await Promise.all([
    prisma.event.findMany({ where: { id: { in: eventIds } }, include: { organisation: { select: { slug: true, name: true } } } }),
    prisma.eventInstance.findMany({ where: { id: { in: instanceIds } }, include: { series: { include: { organisation: { select: { slug: true, name: true } } } } } }),
  ]);
  const eventsById = new Map(events.map((event) => [event.id, event]));
  const instancesById = new Map(instances.map((instance) => [instance.id, instance]));
  type PageItem =
    | { kind: "event"; id: string; orgSlug: string; event: (typeof events)[number] }
    | { kind: "instance"; id: string; orgSlug: string; instance: (typeof instances)[number] };
  const pageItems: PageItem[] = [];
  for (const row of indexRows) {
    if (row.kind === "event") {
      const event = eventsById.get(row.id);
      if (event) pageItems.push({ kind: "event", id: `e-${event.id}`, orgSlug: event.organisation.slug, event });
      continue;
    }
    const instance = instancesById.get(row.id);
    if (instance) pageItems.push({ kind: "instance", id: `i-${instance.id}`, orgSlug: instance.series.organisation.slug, instance });
  }

  const hasActiveFilters = q || sp.from || sp.to || sort !== "upcoming";

  // Build base params for pagination links (preserving current filters)
  const baseParams = {
    ...(q ? { q } : {}),
    ...(sort !== "upcoming" ? { sort } : {}),
    ...(sp.from ? { from: sp.from } : {}),
    ...(sp.to ? { to: sp.to } : {}),
  };

  return (
    <Stack spacing={3} sx={{ py: { xs: 3, sm: 4 } }}>
      <Stack spacing={0.5}>
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
        <Typography variant="body2" sx={{ color: "rgba(255,255,255,0.58)" }}>
          Browse public events from organisations on Yuyu.
        </Typography>
      </Stack>

      {/* Modern Filter panel */}
      <Paper
        variant="outlined"
        component="form"
        action="/discover"
        method="get"
        sx={{
          p: 1.25,
          borderRadius: "16px",
          backgroundColor: "rgba(28,28,30,0.82)",
          borderColor: "rgba(255, 255, 255, 0.09)",
          boxShadow: "0 6px 18px rgba(0,0,0,0.1)",
        }}
      >
        <Stack direction={{ xs: "column", lg: "row" }} spacing={1} sx={{ alignItems: { xs: "stretch", lg: "center" } }}>
            <TextField
              name="q"
              placeholder="Search events"
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
              sx={{ flexGrow: 1, minWidth: { xs: "100%", lg: 220 } }}
            />

            <TextField
              select
              name="sort"
              label="Sort By"
              size="small"
              defaultValue={sort}
              sx={{ minWidth: { xs: "100%", sm: 155 }, flexShrink: 0 }}
            >
              <MenuItem value="upcoming">Upcoming First</MenuItem>
              <MenuItem value="popular">Popularity</MenuItem>
            </TextField>

            <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ width: { xs: "100%", lg: "auto" } }}>
              <TextField
                name="from"
                label="From Date"
                type="date"
                size="small"
                slotProps={{ inputLabel: { shrink: true } }}
                defaultValue={sp.from ?? ""}
                sx={{ width: { xs: "100%", sm: 142 } }}
              />
              <TextField
                name="to"
                label="To Date"
                type="date"
                size="small"
                slotProps={{ inputLabel: { shrink: true } }}
                defaultValue={sp.to ?? ""}
                sx={{ width: { xs: "100%", sm: 142 } }}
              />
            </Stack>
            <Stack
              direction="row"
              spacing={1}
              sx={{ width: { xs: "100%", lg: "auto" }, justifyContent: "flex-end", flexShrink: 0 }}
            >
              {hasActiveFilters && (
                <Button
                  component={Link}
                  href="/discover"
                  variant="text"
                  startIcon={<ClearIcon />}
                  sx={{
                    color: "#8E8E93",
                    minWidth: 0,
                    px: 1,
                    textTransform: "none",
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
                  px: 2,
                  borderRadius: "8px",
                  textTransform: "none",
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
      </Paper>

      {/* Results */}
      {totalItems > 0 ? (
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ justifyContent: "space-between", alignItems: { xs: "flex-start", sm: "center" } }}>
          <Stack spacing={0.25}>
            <Typography variant="h6" component="h2" sx={{ fontWeight: 700, letterSpacing: "-0.3px" }}>
              {q ? "Search results" : "Upcoming events"}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Showing {startIdx + 1}–{Math.min(startIdx + PAGE_SIZE, totalItems)} of {totalItems} event{totalItems === 1 ? "" : "s"}
            </Typography>
          </Stack>
          {totalPages > 1 ? <Chip label={`Page ${safePage} of ${totalPages}`} size="small" variant="outlined" /> : null}
        </Stack>
      ) : null}

      {pageItems.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 6, textAlign: "center", borderRadius: "18px", borderColor: "rgba(255,255,255,0.08)", backgroundColor: "rgba(255,255,255,0.025)" }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>Nothing matches just yet</Typography>
          <Typography color="text.secondary" variant="body2" sx={{ mt: 0.75 }}>
            Try clearing a filter or searching for something else.
          </Typography>
        </Paper>
      ) : (
        <Grid container spacing={1.5}>
          {pageItems.map((row) =>
            row.kind === "event" ? (
              <Grid size={{ xs: 12, sm: 6, md: 4 }} key={row.id}>
                <DiscoverEventCard
                  orgSlug={row.orgSlug}
                  organisationName={row.event.organisation.name}
                  event={row.event}
                />
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
