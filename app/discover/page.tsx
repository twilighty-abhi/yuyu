import Typography from "@mui/material/Typography";
import Stack from "@mui/material/Stack";
import Grid from "@mui/material/Grid";
import Button from "@mui/material/Button";
import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";
import Paper from "@mui/material/Paper";
import { EventPrivacyType, EventStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { EventCard } from "@/components/event/EventCard";
import { InstanceCard } from "@/components/event/InstanceCard";

type SearchParams = Promise<{
  sort?: string;
  org?: string;
  from?: string;
  to?: string;
}>;

export default async function DiscoverPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const sp = await searchParams;
  const sort = sp.sort === "popular" ? "popular" : "upcoming";
  const orgFilter = sp.org?.trim() || "";

  const fromDate = sp.from ? new Date(sp.from) : null;
  const toDate = sp.to ? new Date(sp.to) : null;

  const orgs = await prisma.organisation.findMany({
    where: {
      OR: [
        {
          events: {
            some: {
              status: EventStatus.PUBLISHED,
              privacyType: EventPrivacyType.PUBLIC,
            },
          },
        },
        {
          eventSeries: {
            some: {
              status: EventStatus.PUBLISHED,
              privacyType: EventPrivacyType.PUBLIC,
            },
          },
        },
      ],
    },
    orderBy: { name: "asc" },
    select: { id: true, name: true, slug: true },
  });

  const eventWhere = {
    status: EventStatus.PUBLISHED,
    privacyType: EventPrivacyType.PUBLIC,
    ...(orgFilter ? { organisationId: orgFilter } : {}),
    ...((fromDate || toDate) && {
      startDateTime: {
        ...(fromDate && !Number.isNaN(fromDate.getTime()) ? { gte: fromDate } : {}),
        ...(toDate && !Number.isNaN(toDate.getTime()) ? { lte: toDate } : {}),
      },
    }),
  } as const;

  const events = await prisma.event.findMany({
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
  });

  const instanceWhere = {
    series: {
      status: EventStatus.PUBLISHED,
      privacyType: EventPrivacyType.PUBLIC,
      ...(orgFilter ? { organisationId: orgFilter } : {}),
    },
    ...((fromDate || toDate) && {
      startDateTime: {
        ...(fromDate && !Number.isNaN(fromDate.getTime()) ? { gte: fromDate } : {}),
        ...(toDate && !Number.isNaN(toDate.getTime()) ? { lte: toDate } : {}),
      },
    }),
  };

  const instances = await prisma.eventInstance.findMany({
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
    take: 60,
  });

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

  return (
    <Stack spacing={3} sx={{ py: 2 }}>
      <Typography variant="h3" component="h1">
        Discover events
      </Typography>
      <Typography variant="body2" color="text.secondary">
        Public listings from all organisations on Yuyu.
      </Typography>

      <Paper variant="outlined" sx={{ p: 2 }} component="form" action="/discover" method="get">
        <Stack
          direction={{ xs: "column", md: "row" }}
          spacing={2}
          useFlexGap
          sx={{ flexWrap: "wrap", alignItems: { md: "center" } }}
        >
          <TextField
            select
            name="sort"
            label="Sort"
            size="small"
            defaultValue={sort}
            sx={{ minWidth: 180 }}
          >
            <MenuItem value="upcoming">Upcoming</MenuItem>
            <MenuItem value="popular">Popular (confirmed)</MenuItem>
          </TextField>
          <TextField
            select
            name="org"
            label="Organisation"
            size="small"
            defaultValue={orgFilter}
            sx={{ minWidth: 220 }}
          >
            <MenuItem value="">All</MenuItem>
            {orgs.map((o) => (
              <MenuItem key={o.id} value={o.id}>
                {o.name}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            name="from"
            label="From"
            type="date"
            size="small"
            slotProps={{ inputLabel: { shrink: true } }}
            defaultValue={sp.from ?? ""}
          />
          <TextField
            name="to"
            label="To"
            type="date"
            size="small"
            slotProps={{ inputLabel: { shrink: true } }}
            defaultValue={sp.to ?? ""}
          />
          <Button type="submit" variant="contained">
            Apply
          </Button>
        </Stack>
      </Paper>

      {merged.length === 0 ? (
        <Typography color="text.secondary">No public events match.</Typography>
      ) : (
        <Grid container spacing={2}>
          {merged.map((row) =>
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

    </Stack>
  );
}
