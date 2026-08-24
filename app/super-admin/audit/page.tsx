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
import { redactSensitiveText } from "@/lib/redactSensitiveText";

type Props = {
  searchParams: Promise<{ q?: string; page?: string }>;
};

function metadataSummary(value: unknown) {
  if (value == null) return "—";
  return redactSensitiveText(JSON.stringify(value)).slice(0, 500);
}

export default async function SuperAdminAuditPage({ searchParams }: Props) {
  const sp = await searchParams;
  const q = (sp.q ?? "").trim().slice(0, 120);
  const page = Math.max(0, Number.parseInt(sp.page ?? "0", 10) || 0);
  const take = 50;

  const events = await prisma.auditEvent.findMany({
    where: q
      ? {
          OR: [
            { action: { contains: q, mode: "insensitive" } },
            { targetType: { contains: q, mode: "insensitive" } },
            { actor: { is: { email: { contains: q, mode: "insensitive" } } } },
            { organisation: { is: { name: { contains: q, mode: "insensitive" } } } },
          ],
        }
      : undefined,
    orderBy: { createdAt: "desc" },
    skip: page * take,
    take,
    select: {
      id: true,
      action: true,
      targetType: true,
      targetId: true,
      metadata: true,
      createdAt: true,
      actor: { select: { name: true, email: true } },
      organisation: { select: { id: true, name: true, slug: true } },
    },
  });

  return (
    <Stack spacing={2}>
      <Stack spacing={0.5}>
        <Typography variant="h4" component="h1" sx={{ fontWeight: 800 }}>Audit log</Typography>
        <Typography color="text.secondary">Append-only security and application activity. Sensitive values are redacted before display.</Typography>
      </Stack>

      <Paper variant="outlined" sx={{ p: 2.25, borderRadius: 3 }}>
        <Stack component="form" direction={{ xs: "column", sm: "row" }} spacing={1.5} action="/super-admin/audit" method="GET">
          <TextField name="q" label="Search action, actor email, org, or target type" defaultValue={q} size="small" fullWidth />
          <input type="hidden" name="page" value="0" />
          <Button type="submit" variant="contained">Search</Button>
        </Stack>
      </Paper>

      <Paper variant="outlined" sx={{ borderRadius: 3, overflowX: "auto" }}>
        <Table size="small" sx={{ minWidth: 900 }}>
          <TableHead>
            <TableRow>
              <TableCell>When</TableCell>
              <TableCell>Action</TableCell>
              <TableCell>Actor</TableCell>
              <TableCell>Organisation</TableCell>
              <TableCell>Target</TableCell>
              <TableCell>Metadata</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {events.length === 0 ? (
              <TableRow><TableCell colSpan={6}><Typography color="text.secondary">No audit events found.</Typography></TableCell></TableRow>
            ) : events.map((event) => (
              <TableRow key={event.id} hover>
                <TableCell sx={{ whiteSpace: "nowrap" }}>{event.createdAt.toLocaleString()}</TableCell>
                <TableCell sx={{ fontFamily: "monospace", overflowWrap: "anywhere" }}>{event.action}</TableCell>
                <TableCell>{event.actor?.name ?? event.actor?.email ?? "System"}<Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>{event.actor?.email && event.actor.name ? event.actor.email : ""}</Typography></TableCell>
                <TableCell>{event.organisation ? <Link href={`/super-admin/orgs/${event.organisation.id}`} style={{ textDecoration: "none" }}>{event.organisation.name}<Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>/{event.organisation.slug}</Typography></Link> : "—"}</TableCell>
                <TableCell sx={{ fontFamily: "monospace", overflowWrap: "anywhere" }}>{event.targetType ? `${event.targetType}${event.targetId ? ` · ${event.targetId}` : ""}` : "—"}</TableCell>
                <TableCell sx={{ fontFamily: "monospace", maxWidth: 280, overflowWrap: "anywhere" }}>{metadataSummary(event.metadata)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Paper>

      <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap" }}>
        <Link href={`/super-admin/audit?q=${encodeURIComponent(q)}&page=${Math.max(0, page - 1)}`} style={{ textDecoration: "none" }}>Prev</Link>
        <Typography color="text.secondary">· Page {page + 1} ·</Typography>
        <Link href={`/super-admin/audit?q=${encodeURIComponent(q)}&page=${page + 1}`} style={{ textDecoration: "none" }}>Next</Link>
      </Stack>
    </Stack>
  );
}
