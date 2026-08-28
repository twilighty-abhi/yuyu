import Grid from "@mui/material/Grid";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import Box from "@mui/material/Box";
import { OutboxStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { InstanceOperationsControls } from "@/components/super-admin/InstanceOperationsControls";
import { OUTBOX_SCHEDULER_HEARTBEAT_KEY } from "@/lib/operationalHeartbeat";
import { redactSensitiveText } from "@/lib/redactSensitiveText";
import { INSTANCE_SETTINGS_ID } from "@/lib/instanceSettings";

function StatusChip(props: { ok: boolean; ready: string; missing: string }) {
  return <Chip size="small" color={props.ok ? "success" : "warning"} variant="outlined" label={props.ok ? props.ready : props.missing} />;
}

function ageLabel(value: Date | null) {
  if (!value) return "Not recorded";
  const hours = Math.max(0, Math.floor((Date.now() - value.getTime()) / 3_600_000));
  if (hours < 1) return "Less than an hour ago";
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function safeErrorSummary(value: string | null) {
  return value ? redactSensitiveText(value).slice(0, 500) : "No error detail recorded.";
}

export default async function SuperAdminOperationsPage() {
  const now = new Date();
  const heartbeat = (prisma as unknown as {
    operationalHeartbeat?: Pick<typeof prisma.operationalHeartbeat, "findUnique">;
  }).operationalHeartbeat;
  const [outboxGroups, expiredTokens, lastRestoreDrill, oldestPending, schedulerHeartbeat, failedMessages, instanceSettings] = await Promise.all([
    prisma.outboxMessage.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.verificationToken.count({ where: { expires: { lt: now } } }),
    prisma.auditEvent.findFirst({
      where: { action: "BACKUP_RESTORE_VERIFIED" },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
    prisma.outboxMessage.findFirst({
      where: { status: OutboxStatus.PENDING },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    }),
    heartbeat
      ? heartbeat.findUnique({
          where: { key: OUTBOX_SCHEDULER_HEARTBEAT_KEY },
          select: {
            lastStartedAt: true,
            lastSucceededAt: true,
            lastSent: true,
            lastFailed: true,
            lastError: true,
          },
        })
      : Promise.resolve(null),
    prisma.outboxMessage.findMany({
      where: { status: OutboxStatus.FAILED },
      orderBy: { createdAt: "desc" },
      take: 25,
      select: { id: true, kind: true, attempts: true, lastError: true, createdAt: true },
    }),
    prisma.instanceSetting.findUnique({ where: { id: INSTANCE_SETTINGS_ID } }),
  ]);
  const outbox = new Map(outboxGroups.map((row) => [row.status, row._count._all]));
  const backupProvider = instanceSettings?.backupProvider ?? env?.BACKUP_PROVIDER;
  const backupRetentionDays = instanceSettings?.backupRetentionDays ?? env?.BACKUP_RETENTION_DAYS;
  const reportedBackupAt = instanceSettings?.backupLastSuccessAt ?? (env?.BACKUP_LAST_SUCCESS_AT ? new Date(env.BACKUP_LAST_SUCCESS_AT) : null);
  const backupFresh = reportedBackupAt != null && now.getTime() - reportedBackupAt.getTime() < 26 * 3_600_000;
  const schedulerFresh = schedulerHeartbeat?.lastSucceededAt != null
    && now.getTime() - schedulerHeartbeat.lastSucceededAt.getTime() < 3 * 60_000;

  return (
    <Stack spacing={3}>
      <Stack spacing={0.5}>
        <Typography variant="h4" component="h1" sx={{ fontWeight: 800 }}>Instance operations</Typography>
        <Typography color="text.secondary">Backup posture, queue health, retention jobs, and safe maintenance controls for this deployment.</Typography>
      </Stack>

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 7 }}>
          <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 3, height: "100%" }}>
            <Stack spacing={1.5}>
              <Typography variant="h6" sx={{ fontWeight: 700 }}>Database backups</Typography>
              <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap" }}>
                <StatusChip ok={Boolean(backupProvider)} ready={`Provider: ${backupProvider}`} missing="Backup provider not configured" />
                <StatusChip ok={backupFresh} ready="Latest backup is fresh" missing="Backup status is stale or unknown" />
                <StatusChip ok={Boolean(backupRetentionDays)} ready={`${backupRetentionDays} day retention`} missing="Retention not configured" />
              </Stack>
              <Typography variant="body2" color="text.secondary">Last successful backup: {reportedBackupAt ? `${reportedBackupAt.toLocaleString()} (${ageLabel(reportedBackupAt)})` : "not reported by the backup job"}.</Typography>
              <Typography variant="body2" color="text.secondary">Last restore drill: {lastRestoreDrill ? `${lastRestoreDrill.createdAt.toLocaleString()} (${ageLabel(lastRestoreDrill.createdAt)})` : "not recorded"}.</Typography>
              <Typography variant="caption" color="text.secondary">Update backup posture in Instance settings; backup creation remains external to the application.</Typography>
            </Stack>
          </Paper>
        </Grid>
        <Grid size={{ xs: 12, md: 5 }}>
          <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 3, height: "100%" }}>
            <Stack spacing={1.5}>
              <Typography variant="h6" sx={{ fontWeight: 700 }}>Service prerequisites</Typography>
              <StatusChip ok={Boolean(env?.REDIS_URL)} ready="Redis configured" missing="Redis missing — production writes will fail closed" />
              <StatusChip ok={Boolean(process.env.CRON_SECRET)} ready="Outbox scheduler secret configured" missing="Outbox scheduler secret missing" />
              <StatusChip ok={Boolean(process.env.HEALTHCHECK_SECRET)} ready="Readiness probe protected" missing="Readiness probe secret missing" />
              <StatusChip ok={Boolean(instanceSettings?.smtpHost || instanceSettings?.smtpService || env?.SMTP_HOST || env?.SMTP_SERVICE)} ready="Transactional email configured" missing="Transactional email not configured" />
            </Stack>
          </Paper>
        </Grid>
      </Grid>

      <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 3 }}>
        <Stack spacing={1.5}>
          <Typography variant="h6" sx={{ fontWeight: 700 }}>Delivery and retention</Typography>
          <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap" }}>
            <Chip size="small" label={`${outbox.get(OutboxStatus.PENDING) ?? 0} queued`} />
            <Chip size="small" color={(outbox.get(OutboxStatus.FAILED) ?? 0) > 0 ? "error" : "success"} variant="outlined" label={`${outbox.get(OutboxStatus.FAILED) ?? 0} failed`} />
            <Chip size="small" variant="outlined" label={`${outbox.get(OutboxStatus.SENT) ?? 0} sent`} />
            <Chip size="small" color={expiredTokens > 0 ? "warning" : "success"} variant="outlined" label={`${expiredTokens} expired verification token${expiredTokens === 1 ? "" : "s"}`} />
          </Stack>
          <Stack spacing={0.5}>
            <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap" }}>
              <StatusChip ok={schedulerFresh} ready="Outbox scheduler healthy" missing="Outbox scheduler stale or unknown" />
              {schedulerHeartbeat ? <Chip size="small" variant="outlined" label={`Last batch: ${schedulerHeartbeat.lastSent} sent, ${schedulerHeartbeat.lastFailed} failed`} /> : null}
            </Stack>
            <Typography variant="body2" color="text.secondary">
              Last scheduler success: {schedulerHeartbeat?.lastSucceededAt ? `${schedulerHeartbeat.lastSucceededAt.toLocaleString()} (${ageLabel(schedulerHeartbeat.lastSucceededAt)})` : "not recorded"}.
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Last scheduler start: {schedulerHeartbeat?.lastStartedAt ? `${schedulerHeartbeat.lastStartedAt.toLocaleString()} (${ageLabel(schedulerHeartbeat.lastStartedAt)})` : "not recorded"}.
            </Typography>
            {schedulerHeartbeat?.lastError ? <Typography variant="body2" color="error">Last scheduler error: {safeErrorSummary(schedulerHeartbeat.lastError)}</Typography> : null}
          </Stack>
          <Typography variant="body2" color="text.secondary">Oldest queued message: {oldestPending ? `${oldestPending.createdAt.toLocaleString()} (${ageLabel(oldestPending.createdAt)})` : "none"}.</Typography>
          <Divider />
          <InstanceOperationsControls />
        </Stack>
      </Paper>

      <Paper variant="outlined" sx={{ borderRadius: 3, overflow: "hidden" }}>
        <Stack spacing={0.5} sx={{ p: 2.5, pb: 1.5 }}>
          <Typography variant="h6" sx={{ fontWeight: 700 }}>Failed email deliveries</Typography>
          <Typography variant="body2" color="text.secondary">Recipient addresses, message payloads, and bearer links are never shown here.</Typography>
        </Stack>
        {failedMessages.length === 0 ? (
          <Typography color="text.secondary" sx={{ px: 2.5, pb: 2.5 }}>No failed email deliveries.</Typography>
        ) : (
          <Box component="table" sx={{ width: "100%", borderCollapse: "collapse", "& th, & td": { p: 1.5, borderTop: "1px solid", borderColor: "divider", textAlign: "left", verticalAlign: "top" } }}>
            <Box component="thead"><Box component="tr"><Box component="th">Kind</Box><Box component="th">Attempts</Box><Box component="th">Failed</Box><Box component="th">Last error</Box></Box></Box>
            <Box component="tbody">
              {failedMessages.map((message) => (
                <Box component="tr" key={message.id}>
                  <Box component="td" sx={{ fontFamily: "monospace" }}>{message.kind}</Box>
                  <Box component="td">{message.attempts}</Box>
                  <Box component="td">{message.createdAt.toLocaleString()}</Box>
                  <Box component="td" sx={{ overflowWrap: "anywhere" }}>{safeErrorSummary(message.lastError)}</Box>
                </Box>
              ))}
            </Box>
          </Box>
        )}
      </Paper>

      <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 3, backgroundColor: "rgba(10,132,255,0.06)" }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5 }}>Operational guardrail</Typography>
        <Typography variant="body2" color="text.secondary">These controls do not create or delete provider backups. Backup creation, retention, encryption, and restore access must remain controlled by the managed database provider and deployment credentials. Use this page to verify posture and record evidence, not to expose infrastructure secrets in the application.</Typography>
      </Paper>
    </Stack>
  );
}
