import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Paper from "@mui/material/Paper";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Chip from "@mui/material/Chip";
import Link from "next/link";
import { prisma } from "@/lib/db";

type Props = {
  params: Promise<{ orgId: string }>;
};

export default async function SuperAdminOrgDetailPage({ params }: Props) {
  const { orgId } = await params;

  const org = await prisma.organisation.findUnique({
    where: { id: orgId },
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      logoUrl: true,
      createdAt: true,
      _count: { select: { events: true, eventSeries: true, memberships: true } },
    },
  });

  if (!org) {
    return (
      <Typography color="text.secondary">Organisation not found.</Typography>
    );
  }

  const [members, events, series, invites] = await Promise.all([
    prisma.membership.findMany({
      where: { organisationId: org.id },
      orderBy: { createdAt: "desc" },
      take: 200,
      select: {
        id: true,
        role: true,
        createdAt: true,
        user: { select: { id: true, email: true, name: true } },
      },
    }),
    prisma.event.findMany({
      where: { organisationId: org.id },
      orderBy: { createdAt: "desc" },
      take: 200,
      select: {
        id: true,
        title: true,
        slug: true,
        status: true,
        privacyType: true,
        startDateTime: true,
        createdAt: true,
        _count: { select: { rsvps: true } },
      },
    }),
    prisma.eventSeries.findMany({
      where: { organisationId: org.id },
      orderBy: { createdAt: "desc" },
      take: 200,
      select: {
        id: true,
        title: true,
        slug: true,
        status: true,
        privacyType: true,
        createdAt: true,
        _count: { select: { instances: true, invites: true } },
      },
    }),
    prisma.organisationInvite.findMany({
      where: { organisationId: org.id },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        token: true,
        role: true,
        createdAt: true,
        expiresAt: true,
        usedAt: true,
        createdBy: { select: { email: true } },
        usedBy: { select: { email: true } },
      },
    }),
  ]);

  return (
    <Stack spacing={2}>
      <Stack spacing={0.5}>
        <Typography variant="h4" component="h1" sx={{ fontWeight: 800 }}>
          {org.name}
        </Typography>
        <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap" }}>
          <Chip
            size="small"
            variant="outlined"
            label={`/${org.slug}`}
            sx={{ fontFamily: "monospace" }}
          />
          <Chip size="small" variant="outlined" label={`${org._count.memberships} members`} />
          <Chip size="small" variant="outlined" label={`${org._count.events} events`} />
          <Chip size="small" variant="outlined" label={`${org._count.eventSeries} series`} />
        </Stack>
        <Typography color="text.secondary" variant="body2">
          Created {org.createdAt.toLocaleString()}
        </Typography>
        <Typography color="text.secondary" sx={{ whiteSpace: "pre-wrap" }}>
          {org.description || "—"}
        </Typography>
        <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap" }}>
          <Link href={`/${org.slug}`} style={{ textDecoration: "none" }}>
            Public page
          </Link>
          <Typography color="text.secondary">·</Typography>
          <Link href={`/dashboard/${org.slug}`} style={{ textDecoration: "none" }}>
            Org dashboard
          </Link>
        </Stack>
      </Stack>

      <Paper variant="outlined" sx={{ p: 2.25, borderRadius: 3 }}>
        <Typography variant="h6" sx={{ fontWeight: 700, mb: 1 }}>
          Members
        </Typography>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>User</TableCell>
              <TableCell>Email</TableCell>
              <TableCell>Role</TableCell>
              <TableCell>Joined</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {members.map((m) => (
              <TableRow key={m.id}>
                <TableCell>{m.user?.name ?? "—"}</TableCell>
                <TableCell sx={{ fontFamily: "monospace" }}>
                  {m.user?.email ?? "—"}
                </TableCell>
                <TableCell>{m.role}</TableCell>
                <TableCell>{m.createdAt.toLocaleString()}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Paper>

      <Paper variant="outlined" sx={{ p: 2.25, borderRadius: 3 }}>
        <Typography variant="h6" sx={{ fontWeight: 700, mb: 1 }}>
          Events
        </Typography>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Title</TableCell>
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
                <TableCell colSpan={6}>
                  <Typography color="text.secondary">No events.</Typography>
                </TableCell>
              </TableRow>
            ) : (
              events.map((e) => (
                <TableRow key={e.id} hover>
                  <TableCell sx={{ fontWeight: 650 }}>{e.title}</TableCell>
                  <TableCell>{e.status}</TableCell>
                  <TableCell>{e.privacyType}</TableCell>
                  <TableCell>{e.startDateTime.toLocaleString()}</TableCell>
                  <TableCell align="right">{e._count.rsvps}</TableCell>
                  <TableCell>
                    <Link
                      href={`/${org.slug}/${e.slug}`}
                      style={{ textDecoration: "none" }}
                    >
                      Public
                    </Link>
                    {" · "}
                    <Link
                      href={`/dashboard/${org.slug}/event/${e.id}`}
                      style={{ textDecoration: "none" }}
                    >
                      Manage
                    </Link>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Paper>

      <Paper variant="outlined" sx={{ p: 2.25, borderRadius: 3 }}>
        <Typography variant="h6" sx={{ fontWeight: 700, mb: 1 }}>
          Series
        </Typography>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Title</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Privacy</TableCell>
              <TableCell align="right">Instances</TableCell>
              <TableCell align="right">Invites</TableCell>
              <TableCell>Link</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {series.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6}>
                  <Typography color="text.secondary">No series.</Typography>
                </TableCell>
              </TableRow>
            ) : (
              series.map((s) => (
                <TableRow key={s.id} hover>
                  <TableCell sx={{ fontWeight: 650 }}>{s.title}</TableCell>
                  <TableCell>{s.status}</TableCell>
                  <TableCell>{s.privacyType}</TableCell>
                  <TableCell align="right">{s._count.instances}</TableCell>
                  <TableCell align="right">{s._count.invites}</TableCell>
                  <TableCell>
                    <Link
                      href={`/dashboard/${org.slug}/series/${s.id}`}
                      style={{ textDecoration: "none" }}
                    >
                      Manage
                    </Link>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Paper>

      <Paper variant="outlined" sx={{ p: 2.25, borderRadius: 3 }}>
        <Typography variant="h6" sx={{ fontWeight: 700, mb: 1 }}>
          Org invite links
        </Typography>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Role</TableCell>
              <TableCell>Created</TableCell>
              <TableCell>Expires</TableCell>
              <TableCell>Used</TableCell>
              <TableCell>Created by</TableCell>
              <TableCell>Used by</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {invites.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6}>
                  <Typography color="text.secondary">No org invites.</Typography>
                </TableCell>
              </TableRow>
            ) : (
              invites.map((i) => (
                <TableRow key={i.id}>
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
    </Stack>
  );
}

