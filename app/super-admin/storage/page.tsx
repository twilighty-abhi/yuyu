import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Paper from "@mui/material/Paper";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import { prisma } from "@/lib/db";

function formatBytes(bytes: number | null): string {
  if (bytes == null || Number.isNaN(bytes)) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"] as const;
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
  }
  return `${n.toFixed(i === 0 ? 0 : 2)} ${units[i]}`;
}

export default async function SuperAdminStoragePage() {
  let dbSizeBytes: number | null = null;
  let tableSizes:
    | Array<{ table_name: string; total_bytes: number; total_pretty: string }>
    | null = null;

  try {
    const dbRows = await prisma.$queryRaw<Array<{ bytes: bigint }>>`
      select pg_database_size(current_database()) as bytes
    `;
    dbSizeBytes = dbRows?.[0]?.bytes ? Number(dbRows[0].bytes) : null;

    tableSizes = await prisma.$queryRaw<
      Array<{ table_name: string; total_bytes: bigint; total_pretty: string }>
    >`
      select
        relname as table_name,
        pg_total_relation_size(quote_ident(relname)) as total_bytes,
        pg_size_pretty(pg_total_relation_size(quote_ident(relname))) as total_pretty
      from pg_stat_user_tables
      order by pg_total_relation_size(quote_ident(relname)) desc
      limit 25
    `.then((rows) =>
      rows.map((r) => ({
        table_name: r.table_name,
        total_bytes: Number(r.total_bytes),
        total_pretty: r.total_pretty,
      })),
    );
  } catch {
    // Some managed Postgres setups restrict these functions. We'll degrade gracefully.
  }

  const perOrgCounts = await prisma.organisation.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      name: true,
      slug: true,
      _count: { select: { events: true, eventSeries: true, memberships: true } },
    },
  });

  const assetTotals = await prisma.asset
    .groupBy({
      by: ["organisationId"],
      _sum: { byteSize: true },
      where: { organisationId: { not: null }, byteSize: { not: null } },
    })
    .then((rows) => {
      const m = new Map<string, number>();
      for (const r of rows) {
        const orgId = r.organisationId;
        if (!orgId) continue;
        const bytes = r._sum.byteSize ? Number(r._sum.byteSize) : 0;
        m.set(orgId, bytes);
      }
      return m;
    })
    .catch(() => new Map<string, number>());

  return (
    <Stack spacing={2}>
      <Typography variant="h4" component="h1" sx={{ fontWeight: 800 }}>
        Storage
      </Typography>

      <Paper variant="outlined" sx={{ p: 2.25, borderRadius: 3 }}>
        <Typography variant="h6" sx={{ fontWeight: 700, mb: 0.5 }}>
          Database size
        </Typography>
        <Typography color="text.secondary">
          {dbSizeBytes == null
            ? "Unavailable (DB functions may be restricted)."
            : formatBytes(dbSizeBytes)}
        </Typography>
      </Paper>

      <Paper variant="outlined" sx={{ p: 2.25, borderRadius: 3 }}>
        <Typography variant="h6" sx={{ fontWeight: 700, mb: 1 }}>
          Largest tables (top 25)
        </Typography>
        {tableSizes == null ? (
          <Typography color="text.secondary">
            Unavailable (DB functions may be restricted).
          </Typography>
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Table</TableCell>
                <TableCell align="right">Bytes</TableCell>
                <TableCell align="right">Pretty</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {tableSizes.map((t) => (
                <TableRow key={t.table_name}>
                  <TableCell sx={{ fontFamily: "monospace" }}>{t.table_name}</TableCell>
                  <TableCell align="right">{t.total_bytes.toLocaleString()}</TableCell>
                  <TableCell align="right">{t.total_pretty}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Paper>

      <Paper variant="outlined" sx={{ p: 2.25, borderRadius: 3 }}>
        <Typography variant="h6" sx={{ fontWeight: 700, mb: 1 }}>
          Per-org logical footprint (counts)
        </Typography>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Org</TableCell>
              <TableCell align="right">Assets bytes</TableCell>
              <TableCell align="right">Members</TableCell>
              <TableCell align="right">Events</TableCell>
              <TableCell align="right">Series</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {perOrgCounts.map((o) => (
              <TableRow key={o.id}>
                <TableCell sx={{ fontWeight: 650 }}>
                  {o.name}
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ display: "block" }}
                  >
                    /{o.slug}
                  </Typography>
                </TableCell>
                <TableCell align="right">
                  {formatBytes(assetTotals.get(o.id) ?? 0)}
                </TableCell>
                <TableCell align="right">{o._count.memberships}</TableCell>
                <TableCell align="right">{o._count.events}</TableCell>
                <TableCell align="right">{o._count.eventSeries}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Paper>
    </Stack>
  );
}

