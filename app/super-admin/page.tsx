import Typography from "@mui/material/Typography";
import Stack from "@mui/material/Stack";
import Paper from "@mui/material/Paper";
import Grid from "@mui/material/Grid";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { SparklineCard } from "@/components/super-admin/Sparkline";

function StatCard(props: { label: string; value: number }) {
  return (
    <Paper variant="outlined" sx={{ p: 2.25, borderRadius: 3 }}>
      <Stack spacing={0.5}>
        <Typography variant="body2" color="text.secondary">
          {props.label}
        </Typography>
        <Typography variant="h4" sx={{ fontWeight: 700 }}>
          {props.value.toLocaleString()}
        </Typography>
      </Stack>
    </Paper>
  );
}

export default async function SuperAdminOverviewPage() {
  const [
    orgs,
    users,
    events,
    series,
    instances,
    rsvps,
    memberships,
    orgInvites,
  ] = await Promise.all([
    prisma.organisation.count(),
    prisma.user.count(),
    prisma.event.count(),
    prisma.eventSeries.count(),
    prisma.eventInstance.count(),
    prisma.rSVP.count(),
    prisma.membership.count(),
    prisma.organisationInvite.count(),
  ]);

  const [{ orgs24h, events24h, rsvps24h, rsvps7d }] = await prisma.$queryRaw<
    Array<{ orgs24h: bigint; events24h: bigint; rsvps24h: bigint; rsvps7d: bigint }>
  >`
    select
      (select count(*) from "Organisation" where "createdAt" >= (now() - interval '24 hours')) as "orgs24h",
      (select count(*) from "Event" where "createdAt" >= (now() - interval '24 hours')) as "events24h",
      (select count(*) from "RSVP" where "createdAt" >= (now() - interval '24 hours')) as "rsvps24h",
      (select count(*) from "RSVP" where "createdAt" >= (now() - interval '7 days')) as "rsvps7d"
  `.then((rows) => [
    {
      orgs24h: Number(rows?.[0]?.orgs24h ?? 0),
      events24h: Number(rows?.[0]?.events24h ?? 0),
      rsvps24h: Number(rows?.[0]?.rsvps24h ?? 0),
      rsvps7d: Number(rows?.[0]?.rsvps7d ?? 0),
    },
  ]);

  const activity7d = await prisma.$queryRaw<
    Array<{ day: string; orgs: bigint; events: bigint; rsvps: bigint }>
  >`
    with days as (
      select generate_series(
        date_trunc('day', now()) - interval '6 days',
        date_trunc('day', now()),
        interval '1 day'
      ) as day
    )
    select
      to_char(d.day, 'Mon DD') as day,
      (select count(*) from "Organisation" o where date_trunc('day', o."createdAt") = d.day) as orgs,
      (select count(*) from "Event" e where date_trunc('day', e."createdAt") = d.day) as events,
      (select count(*) from "RSVP" r where date_trunc('day', r."createdAt") = d.day) as rsvps
    from days d
    order by d.day asc
  `.then((rows) =>
    rows.map((r) => ({
      day: r.day,
      orgs: Number(r.orgs),
      events: Number(r.events),
      rsvps: Number(r.rsvps),
    })),
  );

  const [recentOrgs, recentEvents, topOrgsByEvents] = await Promise.all([
    prisma.organisation.findMany({
      orderBy: { createdAt: "desc" },
      take: 8,
      select: { id: true, name: true, slug: true, createdAt: true },
    }),
    prisma.event.findMany({
      orderBy: { createdAt: "desc" },
      take: 8,
      select: {
        id: true,
        title: true,
        slug: true,
        createdAt: true,
        organisation: { select: { slug: true, name: true } },
      },
    }),
    prisma.organisation.findMany({
      orderBy: { events: { _count: "desc" } },
      take: 10,
      select: {
        id: true,
        name: true,
        slug: true,
        _count: { select: { events: true, memberships: true } },
      },
    }),
  ]);

  // Top orgs by RSVPs is easiest via SQL join (kept small + read-only).
  const topOrgsByRsvps = await prisma
    .$queryRaw<Array<{ organisation_id: string; slug: string; name: string; rsvps: bigint }>>`
      select
        o.id as organisation_id,
        o.slug as slug,
        o.name as name,
        count(r.id) as rsvps
      from "Organisation" o
      left join "Event" e on e."organisationId" = o.id
      left join "RSVP" r on r."eventId" = e.id
      group by o.id, o.slug, o.name
      order by count(r.id) desc
      limit 10
    `
    .then((rows) =>
      rows.map((r) => ({
        organisation_id: r.organisation_id,
        slug: r.slug,
        name: r.name,
        rsvps: Number(r.rsvps),
      })),
    )
    .catch(() => []);

  return (
    <Stack spacing={2}>
      <Typography variant="h4" component="h1" sx={{ fontWeight: 800 }}>
        Super admin
      </Typography>
      <Typography color="text.secondary">
        Instance-wide master data and operational controls.
      </Typography>

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <StatCard label="Organisations" value={orgs} />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <StatCard label="Users" value={users} />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <StatCard label="Events" value={events} />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <StatCard label="RSVPs" value={rsvps} />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <StatCard label="Series" value={series} />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <StatCard label="Instances" value={instances} />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <StatCard label="Memberships" value={memberships} />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <StatCard label="Org invite links" value={orgInvites} />
        </Grid>
      </Grid>

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 4 }}>
          <SparklineCard
            title="Orgs (7d)"
            subtitle="Created per day"
            points={activity7d.map((d) => ({ xLabel: d.day, y: d.orgs }))}
          />
        </Grid>
        <Grid size={{ xs: 12, md: 4 }}>
          <SparklineCard
            title="Events (7d)"
            subtitle="Created per day"
            points={activity7d.map((d) => ({ xLabel: d.day, y: d.events }))}
          />
        </Grid>
        <Grid size={{ xs: 12, md: 4 }}>
          <SparklineCard
            title="RSVPs (7d)"
            subtitle="Created per day"
            points={activity7d.map((d) => ({ xLabel: d.day, y: d.rsvps }))}
          />
        </Grid>
      </Grid>

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 6 }}>
          <Paper variant="outlined" sx={{ p: 2.25, borderRadius: 3 }}>
            <Typography variant="h6" sx={{ fontWeight: 700, mb: 1 }}>
              Recent activity
            </Typography>
            <Table size="small">
              <TableBody>
                <TableRow>
                  <TableCell>Orgs created (24h)</TableCell>
                  <TableCell align="right">{orgs24h.toLocaleString()}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>Events created (24h)</TableCell>
                  <TableCell align="right">{events24h.toLocaleString()}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>RSVPs created (24h)</TableCell>
                  <TableCell align="right">{rsvps24h.toLocaleString()}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>RSVPs created (7d)</TableCell>
                  <TableCell align="right">{rsvps7d.toLocaleString()}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </Paper>
        </Grid>
        <Grid size={{ xs: 12, md: 6 }}>
          <Paper variant="outlined" sx={{ p: 2.25, borderRadius: 3 }}>
            <Typography variant="h6" sx={{ fontWeight: 700, mb: 1 }}>
              Top orgs
            </Typography>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Org</TableCell>
                  <TableCell align="right">Events</TableCell>
                  <TableCell align="right">Members</TableCell>
                  <TableCell align="right">RSVPs</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {topOrgsByEvents.map((o) => {
                  const r = topOrgsByRsvps.find((x) => x.organisation_id === o.id);
                  return (
                    <TableRow key={o.id} hover>
                      <TableCell sx={{ fontWeight: 650 }}>
                        <Link href={`/super-admin/orgs/${o.id}`} style={{ textDecoration: "none" }}>
                          {o.name}
                        </Link>
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          sx={{ display: "block" }}
                        >
                          /{o.slug}
                        </Typography>
                      </TableCell>
                      <TableCell align="right">{o._count.events}</TableCell>
                      <TableCell align="right">{o._count.memberships}</TableCell>
                      <TableCell align="right">{r?.rsvps?.toLocaleString?.() ?? "—"}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Paper>
        </Grid>
      </Grid>

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 6 }}>
          <Paper variant="outlined" sx={{ p: 2.25, borderRadius: 3 }}>
            <Typography variant="h6" sx={{ fontWeight: 700, mb: 1 }}>
              Recent organisations
            </Typography>
            <Table size="small">
              <TableBody>
                {recentOrgs.map((o) => (
                  <TableRow key={o.id} hover>
                    <TableCell sx={{ fontWeight: 650 }}>
                      <Link href={`/super-admin/orgs/${o.id}`} style={{ textDecoration: "none" }}>
                        {o.name}
                      </Link>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ display: "block" }}
                      >
                        /{o.slug}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">{o.createdAt.toLocaleString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Paper>
        </Grid>
        <Grid size={{ xs: 12, md: 6 }}>
          <Paper variant="outlined" sx={{ p: 2.25, borderRadius: 3 }}>
            <Typography variant="h6" sx={{ fontWeight: 700, mb: 1 }}>
              Recent events
            </Typography>
            <Table size="small">
              <TableBody>
                {recentEvents.map((e) => (
                  <TableRow key={e.id} hover>
                    <TableCell sx={{ fontWeight: 650 }}>{e.title}</TableCell>
                    <TableCell>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ display: "block" }}
                      >
                        {e.organisation.name}
                      </Typography>
                      <Link
                        href={`/${e.organisation.slug}/${e.slug}`}
                        style={{ textDecoration: "none" }}
                      >
                        /{e.organisation.slug}/{e.slug}
                      </Link>
                    </TableCell>
                    <TableCell align="right">{e.createdAt.toLocaleString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Paper>
        </Grid>
      </Grid>
    </Stack>
  );
}

