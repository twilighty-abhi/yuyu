# Production operations

[Documentation index](README.md)

## Required managed services

- PostgreSQL with TLS, encryption at rest, point-in-time recovery, daily backups, and a tested restore process.
- Redis reachable through `REDIS_URL`; production writes fail closed when it is unavailable.
- Private S3-compatible object storage for generated safe image derivatives.
- Transactional email with a verified sending domain, SPF, DKIM, DMARC, bounce handling, and delivery monitoring.
- Edge TLS termination and WAF/rate limiting. Configure only proxy headers that the edge overwrites.

## Deploy procedure

1. Build and test the immutable image in CI.
2. Run `npm run db:status`, then `npm run db:deploy` once as a release job using the migration database role. Run `npm run storage:migrate` when legacy database assets remain.
3. Deploy application instances using a least-privileged runtime database role and production secrets from a secrets manager.
4. Verify the in-process outbox worker has recorded a fresh heartbeat after deployment. Optionally configure an independent scheduler to call `POST /api/internal/outbox` every minute with `Authorization: Bearer $CRON_SECRET`; also configure an authenticated readiness probe to call `GET /api/health/db` with `Authorization: Bearer $HEALTHCHECK_SECRET`.
5. Verify readiness, error rate, email queue depth, database connections, and Redis health before shifting traffic.

## Instance-managed services

Use `/super-admin/settings` with a fresh super-admin TOTP proof to configure SMTP, Google SSO, and displayed backup posture. Stored SMTP and Google client secrets are write-only and encrypted at rest; retain a source-of-truth copy in the deployment secrets manager for disaster recovery. Environment values are legacy fallbacks, so migrate deliberately and verify sign-in and outbox delivery after changing their source.

The backup fields do not run, retain, or restore backups. Keep those controls with the database provider and record successful backups and restore drills in the instance operations area.

## Backup and incident minimums

- The repository provides database archives for operator-initiated backups and restores. Install PostgreSQL `psql`, `pg_dump`, and `pg_restore` clients compatible with the managed PostgreSQL server in the production release environment. The commands use a temporary owner-only PostgreSQL password file rather than placing the database URL/password in child-process arguments. The `backups/` directory is gitignored, must reside on encrypted host storage, and retains the newest seven complete archive pairs.
- Create a local backup from the repository directory with `npm run db:backup`. This reads only `DATABASE_URL`, requires its TLS setting, queries the live database size to require 20% plus 256 MiB of free-space headroom, and writes a compressed custom PostgreSQL archive plus a SHA-256 metadata sidecar.
- To additionally copy an archive to a **dedicated private backup bucket**, pass all S3 settings only to the command (never save them in application settings or repository files):

  ```bash
  npm run db:backup -- \
    --s3-bucket yuyu-production-backups \
    --s3-region region-name \
    --s3-endpoint https://s3.example.com \
    --s3-access-key-id short-lived-access-key \
    --s3-secret-access-key short-lived-secret \
    --s3-prefix yuyu-production
  ```

  Add `--s3-force-path-style` only for providers that require it. The bucket must be private, use provider-side encryption at rest, and grant this credential only the object operations needed for the selected prefix. Prefer short-lived bucket-scoped credentials; command-line secrets can be exposed through shell history or process inspection.
- Restore is deliberately destructive. It refuses development/test/localhost targets and requires both the parsed database name and an explicit production acknowledgement. It creates a local safety backup before replacing data, then runs the migration status and production schema verification checks:

  ```bash
  npm run db:restore -- \
    --file backups/yuyu-backup-2026-08-30T00-00-00-000Z.dump \
    --production \
    --confirm-database yuyu
  ```

  To restore a remote archive, replace `--file` with `--s3-key yuyu-production/yuyu-backup-2026-08-30T00-00-00-000Z.dump` and supply the same required S3 options used for upload. Archives are streamed for upload and download rather than loaded into process memory; remote restores are downloaded temporarily, checksum-verified, restored, and removed from local temporary storage. Keep the provider bucket as the disaster-recovery source and perform a documented restore drill at least quarterly.

  ```bash
  npm run db:restore -- \
    --s3-key yuyu-production/yuyu-backup-2026-08-30T00-00-00-000Z.dump \
    --s3-bucket yuyu-production-backups \
    --s3-region region-name \
    --s3-endpoint https://s3.example.com \
    --s3-access-key-id short-lived-access-key \
    --s3-secret-access-key short-lived-secret \
    --s3-prefix yuyu-production \
    --production \
    --confirm-database yuyu
  ```
- Test a point-in-time database restore every quarter and record the recovery time and data-loss window.
- Alert on failed backups, failed migrations, outbox messages in `FAILED`, unavailable Redis, elevated 5xx rates, and database saturation.
- Rotate `AUTH_SECRET`, `CRON_SECRET`, OAuth credentials, SMTP credentials, and database credentials through the secrets manager; rehearse revocation.
- Keep an incident log, publish a security-contact address, and document breach notification responsibilities for each deployment region.

## Privacy operations

- Collect only fields necessary for each event and document the purpose/retention period.
- Fulfil access, export, correction, and deletion requests through audited administrator workflows.
- Purge expired verification tokens, old offline rosters, unused assets, and guest registration data according to the published retention policy.
- Do not place passwords, reset tokens, ticket tokens, full registration answers, or email addresses in application logs or audit metadata.
