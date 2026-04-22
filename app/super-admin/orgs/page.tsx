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
  searchParams: Promise<{ q?: string; page?: string }>;
};

export default async function SuperAdminOrgsPage({ searchParams }: Props) {
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const page = Math.max(0, Number.parseInt(sp.page ?? "0", 10) || 0);
  const take = 50;
  const skip = page * take;

  const orgs = await prisma.organisation.findMany({
    where: q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { slug: { contains: q, mode: "insensitive" } },
          ],
        }
      : undefined,
    orderBy: { createdAt: "desc" },
    take,
    skip,
    select: {
      id: true,
      name: true,
      slug: true,
      createdAt: true,
      _count: {
        select: { events: true, eventSeries: true, memberships: true },
      },
    },
  });

  return (
    <Stack spacing={2}>
      <Typography variant="h4" component="h1" sx={{ fontWeight: 800 }}>
        Organisations
      </Typography>

      <Paper variant="outlined" sx={{ p: 2.25, borderRadius: 3 }}>
        <Stack
          component="form"
          direction={{ xs: "column", sm: "row" }}
          spacing={1.5}
          action="/super-admin/orgs"
          method="GET"
        >
          <TextField
            name="q"
            label="Search by name or slug"
            defaultValue={q}
            size="small"
            fullWidth
          />
          <input type="hidden" name="page" value="0" />
          <Button type="submit" variant="contained">
            Search
          </Button>
        </Stack>
      </Paper>

      <Paper variant="outlined" sx={{ borderRadius: 3, overflow: "hidden" }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell>Slug</TableCell>
              <TableCell align="right">Members</TableCell>
              <TableCell align="right">Events</TableCell>
              <TableCell align="right">Series</TableCell>
              <TableCell>Created</TableCell>
              <TableCell>Link</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {orgs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7}>
                  <Typography color="text.secondary">No organisations.</Typography>
                </TableCell>
              </TableRow>
            ) : (
              orgs.map((o) => (
                <TableRow key={o.id} hover>
                  <TableCell sx={{ fontWeight: 650 }}>{o.name}</TableCell>
                  <TableCell sx={{ fontFamily: "monospace" }}>{o.slug}</TableCell>
                  <TableCell align="right">{o._count.memberships}</TableCell>
                  <TableCell align="right">{o._count.events}</TableCell>
                  <TableCell align="right">{o._count.eventSeries}</TableCell>
                  <TableCell>{o.createdAt.toLocaleString()}</TableCell>
                  <TableCell>
                    <Link
                      href={`/super-admin/orgs/${o.id}`}
                      style={{ textDecoration: "none" }}
                    >
                      View
                    </Link>
                    {" · "}
                    <Link href={`/${o.slug}`} style={{ textDecoration: "none" }}>
                      Public
                    </Link>
                    {" · "}
                    <Link
                      href={`/dashboard/${o.slug}`}
                      style={{ textDecoration: "none" }}
                    >
                      Dashboard
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
          href={`/super-admin/orgs?q=${encodeURIComponent(q)}&page=${Math.max(0, page - 1)}`}
          style={{ textDecoration: "none" }}
        >
          Prev
        </Link>
        <Typography color="text.secondary">·</Typography>
        <Typography color="text.secondary">Page {page + 1}</Typography>
        <Typography color="text.secondary">·</Typography>
        <Link
          href={`/super-admin/orgs?q=${encodeURIComponent(q)}&page=${page + 1}`}
          style={{ textDecoration: "none" }}
        >
          Next
        </Link>
      </Stack>
    </Stack>
  );
}

