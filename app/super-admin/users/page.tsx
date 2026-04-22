import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Paper from "@mui/material/Paper";
import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";
import Link from "next/link";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import { prisma } from "@/lib/db";

type Props = {
  searchParams: Promise<{ q?: string; page?: string }>;
};

export default async function SuperAdminUsersPage({ searchParams }: Props) {
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const page = Math.max(0, Number.parseInt(sp.page ?? "0", 10) || 0);
  const take = 50;
  const skip = page * take;

  const users = await prisma.user.findMany({
    where: q
      ? {
          OR: [
            { email: { contains: q, mode: "insensitive" } },
            { name: { contains: q, mode: "insensitive" } },
          ],
        }
      : undefined,
    orderBy: { createdAt: "desc" },
    take,
    skip,
    select: {
      id: true,
      name: true,
      email: true,
      createdAt: true,
      _count: {
        select: { memberships: true, accounts: true, sessions: true, rsvps: true },
      },
    },
  });

  return (
    <Stack spacing={2}>
      <Typography variant="h4" component="h1" sx={{ fontWeight: 800 }}>
        Users
      </Typography>

      <Paper variant="outlined" sx={{ p: 2.25, borderRadius: 3 }}>
        <Stack
          component="form"
          direction={{ xs: "column", sm: "row" }}
          spacing={1.5}
          action="/super-admin/users"
          method="GET"
        >
          <TextField
            name="q"
            label="Search by name or email"
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
              <TableCell>User</TableCell>
              <TableCell>Email</TableCell>
              <TableCell align="right">Orgs</TableCell>
              <TableCell align="right">Accounts</TableCell>
              <TableCell align="right">Sessions</TableCell>
              <TableCell align="right">RSVPs</TableCell>
              <TableCell>Created</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {users.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7}>
                  <Typography color="text.secondary">No users.</Typography>
                </TableCell>
              </TableRow>
            ) : (
              users.map((u) => (
                <TableRow key={u.id} hover>
                  <TableCell sx={{ fontWeight: 650 }}>
                    {u.name ?? "—"}
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ display: "block" }}
                    >
                      {u.id}
                    </Typography>
                  </TableCell>
                  <TableCell sx={{ fontFamily: "monospace" }}>
                    {u.email ?? "—"}
                  </TableCell>
                  <TableCell align="right">{u._count.memberships}</TableCell>
                  <TableCell align="right">{u._count.accounts}</TableCell>
                  <TableCell align="right">{u._count.sessions}</TableCell>
                  <TableCell align="right">{u._count.rsvps}</TableCell>
                  <TableCell>{u.createdAt.toLocaleString()}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Paper>

      <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap" }}>
        <Link
          href={`/super-admin/users?q=${encodeURIComponent(q)}&page=${Math.max(0, page - 1)}`}
          style={{ textDecoration: "none" }}
        >
          Prev
        </Link>
        <Typography color="text.secondary">·</Typography>
        <Typography color="text.secondary">Page {page + 1}</Typography>
        <Typography color="text.secondary">·</Typography>
        <Link
          href={`/super-admin/users?q=${encodeURIComponent(q)}&page=${page + 1}`}
          style={{ textDecoration: "none" }}
        >
          Next
        </Link>
      </Stack>
    </Stack>
  );
}

