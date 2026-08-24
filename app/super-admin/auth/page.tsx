import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Paper from "@mui/material/Paper";
import Grid from "@mui/material/Grid";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import { prisma } from "@/lib/db";

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

export default async function SuperAdminAuthPage() {
  const [accountsCount, sessionsCount, tokensCount] = await Promise.all([
    prisma.account.count(),
    prisma.session.count(),
    prisma.verificationToken.count(),
  ]);

  const [accounts, sessions, tokens] = await Promise.all([
    prisma.account.findMany({
      orderBy: { id: "desc" },
      take: 50,
      select: {
        id: true,
        provider: true,
        type: true,
        providerAccountId: true,
        user: { select: { id: true, email: true } },
      },
    }),
    prisma.session.findMany({
      orderBy: { expires: "desc" },
      take: 50,
      select: {
        id: true,
        expires: true,
        user: { select: { id: true, email: true } },
      },
    }),
    prisma.verificationToken.findMany({
      orderBy: { expires: "desc" },
      take: 50,
      select: { identifier: true, expires: true },
    }),
  ]);

  return (
    <Stack spacing={2}>
      <Typography variant="h4" component="h1" sx={{ fontWeight: 800 }}>
        Auth
      </Typography>

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, sm: 4 }}>
          <StatCard label="Accounts" value={accountsCount} />
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <StatCard label="Sessions" value={sessionsCount} />
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <StatCard label="Verification tokens" value={tokensCount} />
        </Grid>
      </Grid>

      <Paper variant="outlined" sx={{ p: 2.25, borderRadius: 3 }}>
        <Typography variant="h6" sx={{ fontWeight: 700, mb: 1 }}>
          Recent accounts
        </Typography>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Provider</TableCell>
              <TableCell>Type</TableCell>
              <TableCell>Provider account</TableCell>
              <TableCell>User</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {accounts.map((a) => (
              <TableRow key={a.id}>
                <TableCell>{a.provider}</TableCell>
                <TableCell>{a.type}</TableCell>
                <TableCell sx={{ fontFamily: "monospace" }}>
                  {a.providerAccountId}
                </TableCell>
                <TableCell sx={{ fontFamily: "monospace" }}>
                  {a.user.email ?? a.user.id}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Paper>

      <Paper variant="outlined" sx={{ p: 2.25, borderRadius: 3 }}>
        <Typography variant="h6" sx={{ fontWeight: 700, mb: 1 }}>
          Recent sessions
        </Typography>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>User</TableCell>
              <TableCell>Expires</TableCell>
              <TableCell>Session id</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {sessions.map((s) => (
              <TableRow key={s.id}>
                <TableCell sx={{ fontFamily: "monospace" }}>
                  {s.user.email ?? s.user.id}
                </TableCell>
                <TableCell>{s.expires.toLocaleString()}</TableCell>
                <TableCell sx={{ fontFamily: "monospace" }}>{s.id}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Paper>

      <Paper variant="outlined" sx={{ p: 2.25, borderRadius: 3 }}>
        <Typography variant="h6" sx={{ fontWeight: 700, mb: 1 }}>
          Recent verification tokens
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          Only token type and expiry are shown. Identifiers and token values are never exposed.
        </Typography>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Type</TableCell>
              <TableCell>Expires</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {tokens.map((t) => (
              <TableRow key={`${t.identifier}:${t.expires.toISOString()}`}>
                <TableCell>{t.identifier.startsWith("mfa:") ? "MFA enrollment" : t.identifier.startsWith("reset:") ? "Password reset" : "Other verification"}</TableCell>
                <TableCell>{t.expires.toLocaleString()}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Paper>
    </Stack>
  );
}
