import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Paper from "@mui/material/Paper";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Chip from "@mui/material/Chip";
import Grid from "@mui/material/Grid";
import { prisma } from "@/lib/db";
import { getApiMonitorSnapshot } from "@/lib/apiMonitor";
import { Histogram } from "@/components/super-admin/Histogram";

function OkChip(props: { ok: boolean; labelOk?: string; labelBad?: string }) {
  return (
    <Chip
      size="small"
      color={props.ok ? "success" : "error"}
      variant={props.ok ? "outlined" : "filled"}
      label={props.ok ? props.labelOk ?? "OK" : props.labelBad ?? "Error"}
    />
  );
}

export default async function SuperAdminMonitoringPage() {
  const snapshot = getApiMonitorSnapshot();

  let dbOk = true;
  let dbName: string | null = null;
  try {
    const rows = await prisma.$queryRaw<Array<{ db: string }>>`
      select current_database() as db
    `;
    dbName = rows?.[0]?.db ?? null;
  } catch {
    dbOk = false;
  }

  const configuredSuperAdmin = !!process.env.SUPER_ADMIN_EMAIL;
  const configuredAuthSecret = !!process.env.AUTH_SECRET;
  const configuredDbUrl = !!process.env.DATABASE_URL;

  return (
    <Stack spacing={2}>
      <Typography variant="h4" component="h1" sx={{ fontWeight: 800 }}>
        Monitoring
      </Typography>

      <Paper variant="outlined" sx={{ p: 2.25, borderRadius: 3 }}>
        <Stack spacing={1}>
          <Typography variant="h6" sx={{ fontWeight: 700 }}>
            Health checks
          </Typography>
          <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap" }}>
            <Chip
              size="small"
              variant="outlined"
              label={`DB: ${dbName ?? "unknown"}`}
            />
            <OkChip ok={dbOk} labelOk="DB reachable" labelBad="DB down" />
            <OkChip
              ok={configuredDbUrl}
              labelOk="DATABASE_URL set"
              labelBad="DATABASE_URL missing"
            />
            <OkChip
              ok={configuredAuthSecret}
              labelOk="AUTH_SECRET set"
              labelBad="AUTH_SECRET missing"
            />
            <OkChip
              ok={configuredSuperAdmin}
              labelOk="SUPER_ADMIN_EMAIL set"
              labelBad="SUPER_ADMIN_EMAIL missing"
            />
          </Stack>
          <Typography variant="body2" color="text.secondary">
            For external uptime monitors: use <code>/api/health</code> and{" "}
            <code>/api/health/db</code>.
          </Typography>
        </Stack>
      </Paper>

      <Paper variant="outlined" sx={{ p: 2.25, borderRadius: 3 }}>
        <Stack spacing={1.5}>
          <Typography variant="h6" sx={{ fontWeight: 700 }}>
            API request stats (in-memory)
          </Typography>
          <Typography variant="body2" color="text.secondary">
            These stats reset on server restart and are not shared across multiple
            instances.
          </Typography>

          {snapshot.routes.length === 0 ? (
            <Typography color="text.secondary">
              No traffic observed yet.
            </Typography>
          ) : (
            <Stack spacing={2}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Route</TableCell>
                    <TableCell align="right">Total</TableCell>
                    <TableCell align="right">Errors (5xx)</TableCell>
                    <TableCell>Last error</TableCell>
                    <TableCell>Last seen</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {snapshot.routes.map((r) => (
                    <TableRow key={r.routeId}>
                      <TableCell sx={{ fontFamily: "monospace" }}>
                        {r.routeId}
                      </TableCell>
                      <TableCell align="right">
                        {r.total.toLocaleString()}
                      </TableCell>
                      <TableCell align="right">
                        {r.errors.toLocaleString()}
                      </TableCell>
                      <TableCell>
                        {r.lastErrorAt
                          ? `${new Date(r.lastErrorAt).toLocaleString()} · ${r.lastErrorMessage ?? ""}`
                          : "—"}
                      </TableCell>
                      <TableCell>
                        {r.lastSeenAt
                          ? new Date(r.lastSeenAt).toLocaleString()
                          : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              <Grid container spacing={2}>
                {snapshot.routes.map((r) => (
                  <Grid key={`${r.routeId}:hist`} size={{ xs: 12, md: 6 }}>
                    <Histogram
                      title={`${r.routeId} · latency buckets`}
                      buckets={Object.entries(r.buckets).map(([label, count]) => ({
                        label,
                        count,
                      }))}
                    />
                  </Grid>
                ))}
              </Grid>
            </Stack>
          )}
        </Stack>
      </Paper>
    </Stack>
  );
}

