import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Paper from "@mui/material/Paper";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Link from "next/link";
import { prisma } from "@/lib/db";

export default async function SuperAdminInvitesPage() {
  const [orgInvites, eventInvites, seriesInvites] = await Promise.all([
    prisma.organisationInvite.findMany({
      orderBy: { createdAt: "desc" },
      take: 200,
      select: {
        id: true,
        token: true,
        role: true,
        createdAt: true,
        expiresAt: true,
        usedAt: true,
        organisation: { select: { id: true, slug: true, name: true } },
        createdBy: { select: { email: true } },
        usedBy: { select: { email: true } },
      },
    }),
    prisma.eventInvite.findMany({
      orderBy: { createdAt: "desc" },
      take: 200,
      select: {
        id: true,
        email: true,
        createdAt: true,
        event: {
          select: {
            id: true,
            slug: true,
            title: true,
            organisation: { select: { id: true, slug: true, name: true } },
          },
        },
      },
    }),
    prisma.seriesInvite.findMany({
      orderBy: { createdAt: "desc" },
      take: 200,
      select: {
        id: true,
        email: true,
        createdAt: true,
        series: {
          select: {
            id: true,
            slug: true,
            title: true,
            organisation: { select: { id: true, slug: true, name: true } },
          },
        },
      },
    }),
  ]);

  return (
    <Stack spacing={2}>
      <Typography variant="h4" component="h1" sx={{ fontWeight: 800 }}>
        Invites
      </Typography>

      <Paper variant="outlined" sx={{ p: 2.25, borderRadius: 3 }}>
        <Typography variant="h6" sx={{ fontWeight: 700, mb: 1 }}>
          Organisation invite links
        </Typography>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Org</TableCell>
              <TableCell>Role</TableCell>
              <TableCell>Created</TableCell>
              <TableCell>Expires</TableCell>
              <TableCell>Used</TableCell>
              <TableCell>Created by</TableCell>
              <TableCell>Used by</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {orgInvites.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7}>
                  <Typography color="text.secondary">No org invites.</Typography>
                </TableCell>
              </TableRow>
            ) : (
              orgInvites.map((i) => (
                <TableRow key={i.id} hover>
                  <TableCell>
                    <Link
                      href={`/super-admin/orgs/${i.organisation.id}`}
                      style={{ textDecoration: "none" }}
                    >
                      {i.organisation.name}
                    </Link>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ display: "block" }}
                    >
                      /{i.organisation.slug}
                    </Typography>
                  </TableCell>
                  <TableCell>{i.role}</TableCell>
                  <TableCell>{i.createdAt.toLocaleString()}</TableCell>
                  <TableCell>
                    {i.expiresAt ? i.expiresAt.toLocaleString() : "—"}
                  </TableCell>
                  <TableCell>{i.usedAt ? i.usedAt.toLocaleString() : "—"}</TableCell>
                  <TableCell sx={{ fontFamily: "monospace" }}>
                    {i.createdBy.email ?? "—"}
                  </TableCell>
                  <TableCell sx={{ fontFamily: "monospace" }}>
                    {i.usedBy?.email ?? "—"}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Paper>

      <Paper variant="outlined" sx={{ p: 2.25, borderRadius: 3 }}>
        <Typography variant="h6" sx={{ fontWeight: 700, mb: 1 }}>
          Event invites
        </Typography>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Event</TableCell>
              <TableCell>Org</TableCell>
              <TableCell>Email</TableCell>
              <TableCell>Created</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {eventInvites.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4}>
                  <Typography color="text.secondary">No event invites.</Typography>
                </TableCell>
              </TableRow>
            ) : (
              eventInvites.map((i) => (
                <TableRow key={i.id} hover>
                  <TableCell>{i.event.title}</TableCell>
                  <TableCell>
                    <Link
                      href={`/super-admin/orgs/${i.event.organisation.id}`}
                      style={{ textDecoration: "none" }}
                    >
                      {i.event.organisation.name}
                    </Link>
                  </TableCell>
                  <TableCell sx={{ fontFamily: "monospace" }}>{i.email}</TableCell>
                  <TableCell>{i.createdAt.toLocaleString()}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Paper>

      <Paper variant="outlined" sx={{ p: 2.25, borderRadius: 3 }}>
        <Typography variant="h6" sx={{ fontWeight: 700, mb: 1 }}>
          Series invites
        </Typography>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Series</TableCell>
              <TableCell>Org</TableCell>
              <TableCell>Email</TableCell>
              <TableCell>Created</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {seriesInvites.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4}>
                  <Typography color="text.secondary">No series invites.</Typography>
                </TableCell>
              </TableRow>
            ) : (
              seriesInvites.map((i) => (
                <TableRow key={i.id} hover>
                  <TableCell>{i.series.title}</TableCell>
                  <TableCell>
                    <Link
                      href={`/super-admin/orgs/${i.series.organisation.id}`}
                      style={{ textDecoration: "none" }}
                    >
                      {i.series.organisation.name}
                    </Link>
                  </TableCell>
                  <TableCell sx={{ fontFamily: "monospace" }}>{i.email}</TableCell>
                  <TableCell>{i.createdAt.toLocaleString()}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Paper>
    </Stack>
  );
}

