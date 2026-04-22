import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Paper from "@mui/material/Paper";
import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Link from "next/link";
import { prisma } from "@/lib/db";

type Props = {
  searchParams: Promise<{ q?: string; org?: string; page?: string }>;
};

export default async function SuperAdminEventsPage({ searchParams }: Props) {
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const org = (sp.org ?? "").trim();
  const page = Math.max(0, Number.parseInt(sp.page ?? "0", 10) || 0);
  const take = 50;
  const skip = page * take;

  const events = await prisma.event.findMany({
    where: {
      ...(org ? { organisationId: org } : {}),
      ...(q
        ? {
            OR: [
              { title: { contains: q, mode: "insensitive" } },
              { slug: { contains: q, mode: "insensitive" } },
              {
                organisation: { name: { contains: q, mode: "insensitive" } },
              },
            ],
          }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    take,
    skip,
    select: {
      id: true,
      title: true,
      slug: true,
      status: true,
      privacyType: true,
      startDateTime: true,
      createdAt: true,
      organisation: { select: { id: true, slug: true, name: true } },
      _count: { select: { rsvps: true } },
    },
  });

  return (
    <Stack spacing={2}>
      <Typography variant="h4" component="h1" sx={{ fontWeight: 800 }}>
        Events
      </Typography>

      <Paper variant="outlined" sx={{ p: 2.25, borderRadius: 3 }}>
        <Stack
          component="form"
          direction={{ xs: "column", sm: "row" }}
          spacing={1.5}
          action="/super-admin/events"
          method="GET"
        >
          <TextField
            name="q"
            label="Search by title, slug, org"
            defaultValue={q}
            size="small"
            fullWidth
          />
          <TextField
            name="org"
            label="Filter by orgId"
            defaultValue={org}
            size="small"
            sx={{ minWidth: 240 }}
          />
          <input type="hidden" name="page" value="0" />
          <Button type="submit" variant="contained">
            Apply
          </Button>
        </Stack>
      </Paper>

      <Paper variant="outlined" sx={{ borderRadius: 3, overflow: "hidden" }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Event</TableCell>
              <TableCell>Org</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Privacy</TableCell>
              <TableCell>Start</TableCell>
              <TableCell align="right">RSVPs</TableCell>
              <TableCell>Links</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {events.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7}>
                  <Typography color="text.secondary">No events.</Typography>
                </TableCell>
              </TableRow>
            ) : (
              events.map((e) => (
                <TableRow key={e.id} hover>
                  <TableCell sx={{ fontWeight: 650 }}>
                    {e.title}
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ display: "block" }}
                    >
                      {e.id}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography sx={{ fontWeight: 650 }}>{e.organisation.name}</Typography>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ display: "block" }}
                    >
                      /{e.organisation.slug}
                    </Typography>
                  </TableCell>
                  <TableCell>{e.status}</TableCell>
                  <TableCell>{e.privacyType}</TableCell>
                  <TableCell>{e.startDateTime.toLocaleString()}</TableCell>
                  <TableCell align="right">{e._count.rsvps}</TableCell>
                  <TableCell>
                    <Link
                      href={`/${e.organisation.slug}/${e.slug}`}
                      style={{ textDecoration: "none" }}
                    >
                      Public
                    </Link>
                    {" · "}
                    <Link
                      href={`/dashboard/${e.organisation.slug}/event/${e.id}`}
                      style={{ textDecoration: "none" }}
                    >
                      Manage
                    </Link>
                    {" · "}
                    <Link
                      href={`/super-admin/orgs/${e.organisation.id}`}
                      style={{ textDecoration: "none" }}
                    >
                      Org
                    </Link>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Paper>

      <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap" }}>
        <Link
          href={`/super-admin/events?q=${encodeURIComponent(q)}&org=${encodeURIComponent(org)}&page=${Math.max(0, page - 1)}`}
          style={{ textDecoration: "none" }}
        >
          Prev
        </Link>
        <Typography color="text.secondary">·</Typography>
        <Typography color="text.secondary">Page {page + 1}</Typography>
        <Typography color="text.secondary">·</Typography>
        <Link
          href={`/super-admin/events?q=${encodeURIComponent(q)}&org=${encodeURIComponent(org)}&page=${page + 1}`}
          style={{ textDecoration: "none" }}
        >
          Next
        </Link>
      </Stack>
    </Stack>
  );
}

