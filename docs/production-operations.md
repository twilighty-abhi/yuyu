# Production operations

[Documentation index](README.md)

## Required managed services

- PostgreSQL with TLS, encryption at rest, point-in-time recovery, daily backups, and a tested restore process.
- Redis reachable through `REDIS_URL`; production writes fail closed when it is unavailable. Redis pub/sub also carries live ticket check-in notifications between replicas.
- A reverse proxy that does not buffer `text/event-stream` responses for `/api/ticket/:token/events` (nginx: `proxy_buffering off`; the route also sends `X-Accel-Buffering: no`) and allows idle reads of at least 30 seconds. A buffering proxy delays the live ticket tear until the client's 15-second status check.
- Private S3-compatible object storage for generated safe image derivatives.
- Transactional email with a verified sending domain, SPF, DKIM, DMARC, bounce handling, and delivery monitoring.
- Outbound HTTPS (ports 443 and 8443) from every app process to the receivers organisations configure for webhooks ([Organisation webhooks](WEBHOOKS.md)). If egress is restricted, deliveries fail and retry, then the endpoint is switched off after 20 consecutive failures; the user actions that raised them are unaffected.
- Edge TLS termination and WAF/rate limiting. Configure only proxy headers that the edge overwrites.
- If Cloudflare proxies the application, disable Email Address Obfuscation for the application hostname. Yuyu sends `Cache-Control: no-transform` on HTML responses so Cloudflare does not inject its unsigned email-decoder script into pages protected by the nonce-based CSP.

## Deploy procedure

Certificate designer releases require the `20260916000000_certificate_templates` migration before application rollout. Certificate artwork and image layers (logos, signatures, seals under `certificate-assets/`) are re-encoded as WebP in private storage and delivered through the application image route; upload blank artwork without personal data. Keep the Docker image's DejaVu fonts installed (Serif, Sans, and Sans Mono). Custom certificates use the saved layout snapshot on each response.

For a non-Kubernetes container host, follow the current
[production Docker deployment guide](DEPLOYMENT_DOCKER.md). The repository's
root Compose file is development-only, and `compose.staging.yml` is not a
production topology. Kubernetes operators should use the
[Helm chart](../charts/yuyu/README.md).

1. Build and test the immutable image in CI. The [Docker Hub Actions guide](DOCKERHUB_ACTIONS.md) covers automated publication of the application and migration images.
2. Run `npm run db:status`, then `npm run db:deploy` once as a release job using the migration database role. Run `npm run storage:migrate` when legacy database assets remain.
3. Deploy application instances using a least-privileged runtime database role and production secrets from a secrets manager.
4. Verify the in-process outbox worker has recorded a fresh heartbeat after deployment. Configure an independent scheduler to call `POST /api/internal/outbox` every minute with `Authorization: Bearer $CRON_SECRET` as a recovery path; also configure an authenticated readiness probe to call `GET /api/health/db` with `Authorization: Bearer $HEALTHCHECK_SECRET`.
5. Verify readiness, error rate, email queue depth, database connections, and Redis health before shifting traffic.

### Recent schema migrations

Apply these with `npm run db:deploy` before rolling out the matching application version. All are safe for existing rows; the notes call out the ones that are not purely additive.

| Migration | Change |
| --- | --- |
| `20261013000000_event_broadcasts` | `EventBroadcast` history for organiser emails |
| `20261015000000_registration_question_settings` | `EventRegistrationField.helpText`, `placeholder`, and nullable `settings` JSON |
| `20261016000000_event_listed_publicly` | `Event.listedPublicly` (default `false`) for listed approval-required events |
| `20261017000000_broadcast_design` | `EventBroadcast.design` (default `classic`) |
| `20261018000000_rsvp_user_index` | `RSVP(userId, createdAt)` index for account pages and the personal data export. A plain `CREATE INDEX` blocks RSVP writes while it builds, so run it in a quiet window on large installations |
| `20261019000000_event_short_code` | Nullable `Event.shortCode` with a unique index |
| `20261020000000_mobile_sessions` | New `MobileSession` table for the mobile API (SHA-256 token digests, each unique; cascades on `User`). Replaces the `CheckInEvent_known_source` CHECK to allow `mobile-scan` and `mobile-manual` (added `NOT VALID`, then `VALIDATE`, which scans `CheckInEvent`). Adds nullable `Event.registrationManuallyClosedAt`, `registrationCutoffBeforeManualClose`, and `registrationLeadBeforeManualClose` with the `Event_manual_close_snapshot_mode` CHECK. Not purely additive because it replaces a constraint; existing rows satisfy the wider list |
| `20261021000000_ops_alert_webhook` | `InstanceSetting` alert webhook columns (encrypted URL, enabled flag off by default, include-warnings flag); additive only |
| `20261021010000_realign_event_publication` | Data migration, no schema change. Re-aligns `EventPage.isPublished` with `Event.status = PUBLISHED` (the rule from `20260915000000_unify_event_publication`) and creates a released page row for published events that lack one. It repairs events that were published with the Overview **Publish event** button before the fix and stayed 404 (public page, RSVP, and short link) |
| `20261022030000_org_webhooks` | New `WebhookEndpoint` and `WebhookDelivery` tables and the `WebhookDeliveryStatus` enum for organisation webhooks, cascading on `Organisation` (endpoints) and `WebhookEndpoint` (deliveries), with CHECKs on URL/description length, event-type count, failure counter, attempts, error length and the lease shape. Purely additive; no existing table or row changes |
| `20261022000000_event_broadcast_drafts` | New `EventBroadcastDraft` table for saved Emails-tab drafts: one row per event and organiser (unique on `eventId`, `userId`), cascading on `Event` and `User`, with CHECKs bounding the subject to 150 characters and the audience to four statuses. Purely additive; no existing table or row changes |

## Instance-managed services

Use `/super-admin/settings` with a fresh super-admin TOTP proof to configure SMTP, Google SSO, and displayed backup posture. Stored SMTP and Google client secrets are write-only and encrypted at rest; retain a source-of-truth copy in the deployment secrets manager for disaster recovery. Environment values are legacy fallbacks, so migrate deliberately and verify sign-in and outbox delivery after changing their source. Panel settings are read from PostgreSQL at send and sign-in time, so they apply on every replica, in Docker, Helm, and plain Node deployments, without a restart or rebuild.

**Upgrade note (SMTP settings):** saved panel SMTP now replaces the environment as a whole. Earlier releases filled a missing saved username or password from `SMTP_USER`/`SMTP_PASSWORD`; that no longer happens, and production refuses unauthenticated SMTP unless the private-relay option is set. Before deploying, run `node scripts/check-instance-secrets.mjs`; after deploying, use **Send test email** in Super admin → Settings, and if it fails, re-enter the SMTP username and password there. **Retry failed email** requeues only failures from the last 7 days, so stale broadcasts are not resent after an outage.

`MFA_ENCRYPTION_KEY` must be identical on every replica and job, and stable. A replica with a different key stays healthy but cannot send email, sign in with Google, post alerts, or verify TOTP. Before rotating or re-deploying, run `node scripts/check-instance-secrets.mjs` (or set `migration.checkInstanceSecrets=true` in Helm); it never prints decrypted values.

### Operational alerts webhook

The same page holds an optional **Alerts webhook**: a Mattermost (or Slack-compatible) incoming-webhook URL. When enabled, each app process posts to it:

- uncaught server errors from page renders, route handlers, Server Actions, and the proxy (Next.js `onRequestError`), with the route pattern rather than the request path;
- every server `console.error` line, and `console.warn` lines when **Include warnings** is on, which covers Next.js' own uncaught-exception and unhandled-rejection logging;
- Auth.js sign-in failures with their error type (for example `OAuthCallbackError`), outbox email delivery failures with the SMTP error code (a retried failure is a warning, a permanent one an error), and failed scheduler runs;
- browser crashes caught by the app error boundaries, through `POST /api/client-errors`;
- an *Instance started* note each time a process boots, which marks deploys and restarts.

The URL embeds its own credential, so it is encrypted like the SMTP password and only its host is shown. Use **Send test message** after saving. Alert text is redacted before it leaves the instance (URLs and connection strings, email addresses, bearer values, `token=`-style parameters, and long opaque strings), identical alerts are collapsed for five minutes with a repeat count afterwards, and each process sends at most 30 alerts a minute. Delivery is best effort with a 5-second timeout and never fails the request that raised it. With several replicas, expect one *Instance started* note per replica; each process re-reads the webhook setting at most every 60 seconds, so a change saved on one replica reaches the others within a minute. Every app process needs outbound HTTPS to the webhook host.

The backup fields do not run, retain, or restore backups. Keep those controls with the database provider and record successful backups and restore drills in the instance operations area.

## Backup and incident minimums

- The repository provides database archives for operator-initiated backups and restores. Install PostgreSQL `psql`, `pg_dump`, and `pg_restore` clients compatible with the managed PostgreSQL server in the production release environment. The commands use a temporary owner-only PostgreSQL password file rather than placing the database URL/password in child-process arguments. The `backups/` directory is gitignored, must reside on encrypted host storage, and retains the newest seven complete archive pairs.
- Create a local backup from the repository directory with `npm run db:backup`. The command loads `.env` when that file is present for local operation, while explicitly injected environment values retain precedence in CI and production. It reads only `DATABASE_URL` for the database connection, requires its TLS setting, queries the live database size to require 20% plus 256 MiB of free-space headroom, and writes a compressed custom PostgreSQL archive plus a SHA-256 metadata sidecar.
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
- Alert on failed backups, failed migrations, a stale outbox heartbeat, pending/processing email queue growth, outbox messages in `FAILED`, unavailable Redis, elevated 5xx rates, and database saturation. Treat a provider acceptance response as SMTP handoff, not inbox placement; monitor bounces and delivery events with the selected transactional-email provider.
- Rotate `AUTH_SECRET`, `CRON_SECRET`, OAuth credentials, SMTP credentials, and database credentials through the secrets manager; rehearse revocation.
- Keep an incident log, publish a security-contact address, and document breach notification responsibilities for each deployment region.

## Privacy operations

- Collect only fields necessary for each event and document the purpose/retention period.
- Users can download their own data from `/account/registrations` (`GET /api/exports/account`, audited as `ACCOUNT_DATA_EXPORTED`). Fulfil other access, correction, and deletion requests through audited administrator workflows.
- Purge expired verification tokens, old offline rosters, unused assets, and guest registration data according to the published retention policy.
- Do not place passwords, reset tokens, ticket tokens, full registration answers, or email addresses in application logs or audit metadata.
