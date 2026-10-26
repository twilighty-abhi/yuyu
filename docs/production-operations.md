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
| `20261023000000_check_in_lists` | New `CheckInList`, `CheckInListRecord` and `CheckInListEvent` tables for custom check-in lists: a partial unique index on (`eventId`, `lower(name)`) for non-archived lists, a unique (`listId`, `rsvpId`) record per guest, CHECKs on the name shape, sort order, sources and history actions, cascades from `Event` and `RSVP` (history keeps a null `rsvpId`), and `SET NULL` on the acting `User`. Purely additive; entry check-in tables and rows are unchanged, and no backfill runs. `db:verify` now checks the three tables and their key constraints |
| `20261023010000_org_webhooks` | New `WebhookEndpoint` and `WebhookDelivery` tables and the `WebhookDeliveryStatus` enum for organisation webhooks, cascading on `Organisation` (endpoints) and `WebhookEndpoint` (deliveries), with CHECKs on URL/description length, event-type count, failure counter, attempts, error length and the lease shape. Purely additive; no existing table or row changes |
| `20261022000000_event_broadcast_drafts` | New `EventBroadcastDraft` table for saved Emails-tab drafts: one row per event and organiser (unique on `eventId`, `userId`), cascading on `Event` and `User`, with CHECKs bounding the subject to 150 characters and the audience to four statuses. Purely additive; no existing table or row changes |
| `20261024000000_team_registration` | Team registration: `Event.registrationMode` (default `INDIVIDUAL`), solo policy and team-size columns with CHECKs, new `Team`, `TeamSeekerProfile` and `TeamJoinRequest` tables, nullable `RSVP.teamId`. Existing events stay individual; no backfill. `ALTER TABLE "Event"` takes a brief ACCESS EXCLUSIVE lock (see the lock checklist below) |
| `20261024010000_hackathon_judging` | Submissions and judging tables (`Submission`, `SubmissionLink`, `JudgingCriterion`, `JudgeAssignment`, `JudgeScore`, `JudgeReview`, `EventAward`, `EventAwardWinner`) and judging columns on `Event` with defaults. Additive; `ALTER TABLE "Event"` as above |
| `20261024020000_judging_results_announced` | Nullable `Event.resultsAnnouncedAt`. Additive; `ALTER TABLE "Event"` as above |
| `20261025000000_judging_ops` | `Event.reviewsPerProject` and `Event.scoreNormalization` (default `RAW`) with a range CHECK. Additive; `ALTER TABLE "Event"` as above |
| `20261025010000_saved_views` | New `SavedView` table and `SavedViewSurface` enum, cascading on `Event`, `User` and `Organisation`. Purely additive |
| `20261026000000_large_event_indexes` | Six composite indexes on `RSVP`, `Team`, `Submission` and `EventInvite` (docs/PERFORMANCE.md). Plain `CREATE INDEX IF NOT EXISTS` inside the migration transaction: each build blocks writes to its table (RSVPs, check-ins, submissions, invites) until it finishes. Pre-build them concurrently on a large instance (below) |
| `20261027000000_drop_orphan_event_session_type` | Drops the unused `EventSessionType` enum (no column has used it since `20260915010000_simplify_event_session_fields`). No table changes; brings the database in line with `schema.prisma` so `prisma migrate diff` is empty |
| `20261028000000_attendance_confirmation` | New `AttendanceResponse` enum and `AttendanceCheck` table (CHECKs on the token digest, note length and response/time pair; foreign keys to `RSVP` and `Event`, which briefly lock those tables while they are added), and `Event.attendanceCheckReleaseOnDecline` (`NOT NULL DEFAULT false`, no rewrite). Additive; `ALTER TABLE "Event"` as above. Nothing is sent automatically after the upgrade |
| `20261028010000_hackathon_email_toggles` | `Event.emailEntrantsOnResults` and `Event.emailSubmissionReceipts`, both `NOT NULL DEFAULT false` (a constant default, so no table rewrite). Additive; `ALTER TABLE "Event"` as above. **Behaviour change for existing events:** both switches start off, so publishing results and submitting a project send no email until an organiser turns the switch on in Judging → Setup (docs/HACKATHON.md → Hackathon emails). Tell organisers who rely on those emails before upgrading |
| `20261029000000_event_crew` | Adds `CREW` to the `EventPageSectionType` enum, `RSVP.isCrew` (`NOT NULL DEFAULT false`, no rewrite), the `EventCrewMember` and `EventCrewJoinLink` tables, and the `RSVP_crew_shape` CHECK, added `NOT VALID` and validated in the same transaction while `ALTER TABLE "RSVP"` holds its ACCESS EXCLUSIVE lock (about 70 ms per million registrations). Once a `CREW` section exists, the previous release can no longer read event pages ([rollback](PRODUCTION_RELEASE.md#rollback)) |

#### Lock checklist for the team, judging and large-event migrations

Prisma applies each migration in one transaction, without a lock timeout. The
five migrations that alter `Event` wait for an ACCESS EXCLUSIVE lock, and while
they wait every new read and write of `Event` from the running pods queues
behind them; `20261026000000_large_event_indexes` blocks writes to `RSVP`,
`Team`, `Submission` and `EventInvite` while its indexes build. On a quiet
database the whole upgrade takes well under a second. Before running the
migration job:

1. Deploy at low traffic, and make sure nothing holds a long transaction:

   ```sql
   SELECT pid, state, now() - xact_start AS age, left(query, 80)
   FROM pg_stat_activity
   WHERE datname = current_database() AND xact_start IS NOT NULL
   ORDER BY xact_start;
   ```

   End long reports and `idle in transaction` sessions before you continue.
2. On a large instance, pre-build the large-event indexes on the existing
   tables without blocking writes. The migration's `IF NOT EXISTS` then skips
   them:

   ```sql
   CREATE INDEX CONCURRENTLY IF NOT EXISTS "RSVP_eventId_createdAt_id_idx" ON "RSVP"("eventId", "createdAt", "id");
   CREATE INDEX CONCURRENTLY IF NOT EXISTS "RSVP_eventId_checkedInAt_id_idx" ON "RSVP"("eventId", "checkedInAt", "id");
   CREATE INDEX CONCURRENTLY IF NOT EXISTS "EventInvite_eventId_createdAt_id_idx" ON "EventInvite"("eventId", "createdAt", "id");
   ```

   `Team` and `Submission` are created by earlier migrations in this release,
   so they do not exist yet and are empty when their indexes are built. A
   failed `CONCURRENTLY` build leaves an `INVALID` index: drop it and run the
   statement again before migrating.
3. If the job does wait on a lock, find the blocker with
   `SELECT pid, pg_blocking_pids(pid), left(query, 80) FROM pg_stat_activity WHERE cardinality(pg_blocking_pids(pid)) > 0;`
   and end it (`SELECT pg_terminate_backend(<pid>);`) rather than killing the
   migration job, which would leave a failed migration to resolve.

### Upgrading from production `bf7a04d`

The 2026-10-27 release applies the last 13 rows of the table above in one
`db:deploy`. Six of them alter `Event` and two alter `RSVP` (each a brief
ACCESS EXCLUSIVE lock), and `large_event_indexes` blocks writes to `RSVP`,
`Team`, `Submission` and `EventInvite` while it builds. Rehearsed on a copy
of production-shaped data, the whole set took 0.61 s at 20,000
registrations and 3.3 s at one million. The full runbook (pre-checks, lock
timeout, schema checks, swapping the app without overlap, post-deploy
checks and rollback) is in
[Production release → Upgrading from production `bf7a04d`](PRODUCTION_RELEASE.md#upgrading-from-production-bf7a04d).
Points specific to operations:

- **Migrator lock timeout.** Give only the migrator's `DATABASE_URL` a lock
  timeout (`…&options=-c%20lock_timeout%3D5s`). A migration that times out
  rolls back atomically; mark it with
  `npx prisma migrate resolve --rolled-back <migration_name>`, end the
  blocker, and run `npm run db:deploy` again.
- **No old/new overlap.** The previous release's outbox worker permanently
  fails the new email kinds (`team-created`, `team-member-added`,
  `submission-received`, `submission-link`, `results-published`,
  `attendance-check`). Stop the old app before the new one serves traffic;
  the Helm chart on `a952faf` always rolls, so scale the old Deployment to 0
  first.
- **Database time zone.** `SHOW timezone;` must return `UTC` for `a952faf`:
  the attendance reminder and webhook delivery claim compare timestamps in
  raw SQL.
- **Outbox capacity.** No new cron job: webhooks are delivered by the same
  in-process pass as email. On `a952faf` each pass sends at most 20 email
  messages in creation order, so a 10,000-guest attendance confirmation or
  broadcast takes hours and delays password resets behind it; keep the
  once-a-minute call to `POST /api/internal/outbox`.
- **Memory.** On `a952faf` each concurrent open of a 10,000+ registration
  event dashboard, and each action on it, costs about 1.2 GB of native
  memory. Keep the Helm limit at 4 GiB or more while large events are run.
- **Rollback** is image-only until a `JUDGE` grant or `CREW` section exists,
  and a restore of the pre-upgrade backup into an empty database afterwards
  ([Rollback](PRODUCTION_RELEASE.md#rollback)).

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

A browser that leaves or closes a page while it is still streaming is not an error: React aborts the render with "The destination stream closed early.", which Next.js still logs (`⨯ Error: … digest: …`) and passes to `onRequestError`. Neither path turns it into an alert.

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
