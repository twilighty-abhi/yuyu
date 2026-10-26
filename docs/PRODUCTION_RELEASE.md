# Production release checklist

[Documentation index](README.md)

Yuyu must not be released until every item below is complete and recorded in the deployment change.

## Required managed services

- PostgreSQL with TLS, encryption at rest, daily backups, point-in-time recovery, and a documented restore drill.
- Redis configured through `REDIS_URL`. The application deliberately rejects security-sensitive traffic when Redis is unavailable in production.
- Private S3-compatible object storage configured with `S3_BUCKET` and `S3_REGION`. Use an IAM workload role where possible; keep the bucket private.
- A transactional email provider with a verified sending domain, SPF, DKIM, DMARC, bounce handling, and alerting.
- The self-hosted Node.js service runs an in-process outbox worker once per minute. Keep `POST /api/internal/outbox` with `Authorization: Bearer $CRON_SECRET` available as an independent scheduler or recovery trigger, and monitor both delivery and cleanup results.
- WAF/CDN and TLS termination in front of the app. Forward only the configured trusted client-IP header, overwritten with the address the edge saw (never appended to a client-supplied value).
- A reverse proxy or ingress that does not buffer `/api/ticket/:token/events` and allows idle reads of at least 30 seconds (see [Production operations](production-operations.md)).
- Centralized PII-scrubbed logs, error reporting, uptime checks, and alerts for database, Redis, outbox, mail, and backup failures.

## Deployment procedure

1. Configure the canonical production hostname. Set both `AUTH_URL` and `NEXT_PUBLIC_BASE_URL` to it (for example `https://events.example.com`); they must match exactly. Configure DNS, a valid TLS certificate, CDN/WAF origin routing, and the trusted proxy-IP header.
2. If Google OAuth is enabled, register `https://events.example.com/api/auth/callback/google` (your hostname) as an authorized callback URL.
3. Review and approve the pending Prisma migrations (see [Recent schema migrations](production-operations.md#recent-schema-migrations) and the [changelog](../CHANGELOG.md) upgrade notes); take a backup before applying them. For the first deploy over production `bf7a04d`, follow [Upgrading from production `bf7a04d`](#upgrading-from-production-bf7a04d).
4. Run `node scripts/check-instance-secrets.mjs` with the production environment so `MFA_ENCRYPTION_KEY` is known to decrypt the settings saved in Super admin → Settings.
5. Run `npm ci`, `npm run production:check`, `npm run db:deploy`, `npm run db:verify`, `npm run storage:migrate`, `npm run lint`, `npx tsc --noEmit`, `npm run test:coverage`, and `npm run build` in staging.
6. Exercise auth, organisation permissions, RSVP capacity, duplicate RSVP, upload rejection, email delivery, and offline-check-in sync in staging. Publish a draft event from the Overview checklist and confirm its public page, RSVP, and short link work at once, and that an open ticket tears on check-in through the production proxy without waiting for its 15-second status check.
7. Build an immutable image with `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` supplied as a BuildKit secret, inject that same value at runtime, run the authenticated `/api/health/db` readiness probe, and verify the outbox scheduler.
8. Use **Send test email** in Super admin → Settings, and **Send test message** for the alerts webhook if one is configured. If the mobile apps are released, set `GOOGLE_MOBILE_CLIENT_IDS`, `ANDROID_APP_SHA256_CERT_FINGERPRINTS`, and `APPLE_APP_IDS` and check `/.well-known/assetlinks.json` and `/.well-known/apple-app-site-association`.
9. Confirm alert delivery and record the release, backup point, migration version, and rollback owner.

## Domain changes

When replacing the current hostname, update the two canonical URL variables, OAuth callback/origin settings, DNS, TLS, CDN/WAF, scheduler, monitoring targets, and any trusted host configuration in one deployment. Rebuild the application because public environment values are embedded at build time. Preserve an HTTPS redirect from the old host so shared event, ticket, certificate, and invitation links continue to work; users may need to sign in again because cookies are host-specific.

## Required operating controls

- Publish privacy, cookie, acceptable-use, retention, and incident-response policies.
- Define organiser data export approvals, account export/delete handling, retention periods, and a subprocessor register.
- Run periodic restore drills, access reviews, dependency scans, load tests, and security tests.
- Require high-risk organisers to enable authenticator MFA from `/account/security`; Google-based users must also be covered by the organisation's Google MFA policy. Super-admin access additionally requires a fresh TOTP step-up and cannot be used until application MFA is enrolled. Session revocation is available from the same page.
- Set `TRUSTED_PROXY_IP_HEADER` to the one client-IP header your CDN overwrites; do not expose the application directly to the internet behind an arbitrary forwarded header.
- Preserve `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` across every container serving a release. Rotating it invalidates outstanding Server Action forms.

## Cover-image safety

Cover images are signature/pixel validated, decoded, metadata-stripped, resized, and re-encoded as WebP before entering a private object-store bucket. Only generated derivatives are delivered through the application. Run `npm run storage:migrate` once after configuring S3 to remove legacy database blobs.

## Upgrading from production `bf7a04d`

The 2026-10-27 release deploys the latest `main` (including the release-gate
fixes from pull requests #27 and #29) over production `bf7a04d`, the 1.0.0 release of 2026-10-21. It
brings about 125 commits and 13 migrations: team registration, hackathon
submissions and judging, event crew, attendance confirmation, custom check-in
lists, organisation webhooks, saved views and filtered exports, large-event
paging and indexes, mobile teams, judging and programme routes, and the
in-app help centre. What changed is in the [changelog](../CHANGELOG.md).
This section is the release runbook. It was rehearsed on an isolated copy
with production-shaped data (an upgrade from `bf7a04d`, old data on the new
build, the old build on the new schema, and a restore drill).

### What the upgrade changes

- **Migrations.** 13 forward-only migrations, all dated after production's
  last one, none editing an earlier migration. `bf7a04d` has 56 migrations;
  after the upgrade there are 69.

  | Migration | Lock impact |
  | --- | --- |
  | `20261022000000_event_broadcast_drafts` | New table only |
  | `20261023000000_check_in_lists` | New tables only |
  | `20261023010000_org_webhooks` | New tables only |
  | `20261024000000_team_registration` | `ALTER TABLE` on `Event` and `RSVP` (brief ACCESS EXCLUSIVE locks), new tables |
  | `20261024010000_hackathon_judging` | Adds the `JUDGE` permission value; `ALTER TABLE "Event"`; new tables |
  | `20261024020000_judging_results_announced` | `ALTER TABLE "Event"` (nullable column) |
  | `20261025000000_judging_ops` | `ALTER TABLE "Event"` (defaulted columns and a CHECK) |
  | `20261025010000_saved_views` | New table only |
  | `20261026000000_large_event_indexes` | Six `CREATE INDEX IF NOT EXISTS`: blocks writes to `RSVP`, `Team`, `Submission` and `EventInvite` while they build |
  | `20261027000000_drop_orphan_event_session_type` | Drops an unused enum; no table changes |
  | `20261028000000_attendance_confirmation` | `ALTER TABLE "Event"`; new table with foreign keys to `RSVP` and `Event` |
  | `20261028010000_hackathon_email_toggles` | `ALTER TABLE "Event"` (constant defaults, no rewrite) |
  | `20261029000000_event_crew` | Adds the `CREW` page section value; `ALTER TABLE "RSVP"` plus a CHECK validated under that lock; new tables |

  Details for each are in
  [Recent schema migrations](production-operations.md#recent-schema-migrations).
- **Measured timings.** On a 51 MB rehearsal database (20,120-registration
  event, 40,000 answers, 3,000 check-ins) all 13 migrations applied in
  0.61 s wall time (about 0.07 s of database time). At one million
  registrations they took 3.3 s wall time. The only material step is
  `large_event_indexes`, which blocks registration and check-in writes for
  about 2 s per million registrations; `event_crew` validates its `RSVP`
  CHECK under its lock in about 70 ms per million. Production is far smaller
  than either test, so expect well under a second.
- **Existing data.** Every pre-existing table keeps its rows unchanged. Old
  events get the new defaults: individual registration, judging not started,
  and both hackathon email switches off. Machine API v1 responses are
  unchanged; mobile API responses only gain fields.
- **No new required environment variables and no new cron job.** Webhook
  delivery runs in the same in-process outbox pass as email.
- **Behaviour organisers will notice.** Hackathon results and
  submission-receipt emails are off by default on every event (Judging →
  Setup); team mode cannot be switched on for an event that already has
  registrations; attendance confirmation is sent only by hand.

### Before the deploy window

1. **Choose the commit.** Deploy the latest `origin/main`, and
   confirm its Quality gate run is green (it builds the Docker image and
   smoke-tests the container). Fetch first: a local `main` checkout may be
   behind `origin/main`.
2. **Image publishing.** The **Publish Docker Hub images** workflow needs the
   repository variables `DOCKERHUB_USERNAME` and `DOCKERHUB_NAMESPACE` and the
   secret `DOCKERHUB_TOKEN`, plus the `NEXT_PUBLIC_BASE_URL` variable and the
   `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` secret
   ([Docker Hub Actions](DOCKERHUB_ACTIONS.md)). Without them the publish
   fails; build the application and migrator images from source instead.
3. **Environment.** Remove `WEBHOOKS_ALLOW_PRIVATE_TARGETS`, `CI` and
   `ALLOW_INSECURE_PRODUCTION_TESTS` if any is set (`npm run production:check`
   refuses the first). Keep `NEXT_PUBLIC_BASE_URL` on `https`: in production
   the outbox refuses and deletes capability emails (verification, password
   reset, attendance confirmation and similar) whose links would be `http`.
   Make sure `TRUSTED_PROXY_IP_HEADER` names the header your edge overwrites
   (for example `cf-connecting-ip` behind Cloudflare); a wrong value puts
   every user in one per-IP budget of 10 sign-ins a minute. Allow outbound
   HTTPS on 443 and 8443 for organisation webhooks.
4. **Database time zone.** Any server `TimeZone` works: raw SQL converts
   timestamps to UTC explicitly. `SHOW timezone;` is still worth knowing when
   reading rows by hand.
5. **Container memory.** Date formatters are cached, so opening a
   15,000-registration event dashboard takes about 0.3 s, and 20 concurrent
   opens peak at about 1.4 GB. Keep the Helm default limit of 4 GiB.
6. **Record the rollback point.** Note the running image tag. Then, on a
   trusted host with PostgreSQL client tools and the production
   `DATABASE_URL` (which must use `sslmode=require`), run `npm run db:backup`.
   Copy the `.dump` and its `.dump.json` sidecar off the host and write down
   the file name. Keep the backup until the new release has run for a while:
   it is the full rollback path.
7. **Read-only pre-checks.** With the production environment, run
   `node scripts/check-instance-secrets.mjs`. From a checkout of `bf7a04d`, run
   `npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma`
   to spot hand-made drift. Expect only three known differences, which this
   release's migrations resolve: the definition of the RSVP attendance index
   `RSVP_eventId_status_checkedInAt_createdAt_id_idx`, the
   `EventFeedbackForm_eventId_idx` index, and the orphaned `EventSessionType`
   enum. Resolve anything else before upgrading.
8. **Pick a quiet window.** Avoid exports, PDF reports and large sends during
   it. Optionally pre-build the large-event indexes on `RSVP` and
   `EventInvite` with `CREATE INDEX CONCURRENTLY` so the migration skips them
   ([lock checklist](production-operations.md#lock-checklist-for-the-team-judging-and-large-event-migrations)).
9. **Tell organisers** about the behaviour changes above, and that an
   attendance confirmation or broadcast to about 10,000 guests drains at the
   outbox rate. Each pass sends batches of 50 for up to 40 seconds, and
   password-reset, ticket and verification email is always sent before bulk
   sends, so it does not wait behind them.

### Deploy steps

1. **End long transactions.** Just before migrating, list open transactions
   and end long reports and `idle in transaction` sessions:

   ```sql
   SELECT pid, now() - xact_start AS age, left(query, 80)
   FROM pg_stat_activity
   WHERE datname = current_database() AND xact_start IS NOT NULL
   ORDER BY xact_start;
   ```

2. **Migrate with a lock timeout.** Run the new release's migrator (the
   `migrator` image, the Helm migration Job, or `npm run db:deploy` from a
   checkout of the commit) with a lock timeout on the migrator's
   `DATABASE_URL` only, for example by appending
   `&options=-c%20lock_timeout%3D5s` (`?options=…` when the URL has no query
   string). If a migration fails with `lock timeout`, it has already rolled
   back as a whole: find and end the blocker, mark it with
   `npx prisma migrate resolve --rolled-back <migration_name>`, and run
   `npm run db:deploy` again. Never kill a running migration job.
3. **Check the instance secrets** with `node scripts/check-instance-secrets.mjs`
   in the same image and environment. It fails if `MFA_ENCRYPTION_KEY`
   cannot decrypt the settings saved in Super admin → Settings.
4. **Verify the schema.** `npm run db:verify`, `npx prisma migrate status`
   (up to date), and
   `npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --exit-code`,
   which must exit 0.
5. **Swap the application without overlap.** The old release's outbox worker
   permanently fails the new email kinds (`team-created`,
   `team-member-added`, `submission-received`, `submission-link`,
   `results-published`, `attendance-check`), so the old and new releases must
   not run side by side. With Docker, stop and rename the old container, then
   start the new one, as in the
   [Docker upgrade order](DEPLOYMENT_DOCKER.md#upgrade-an-existing-installation).
   With Helm, deploy with
   `--set updateStrategy.type=Recreate --set updateStrategy.rollingUpdate=null`
   (a short outage). As a safety net, the new release returns to the queue,
   once, any new-kind email the old worker failed in the last 7 days.
6. **Watch the start.** With an alerts webhook configured, each new process
   posts an *Instance started* note. Then use **Send test email** and **Send
   test message** in Super admin → Settings.

### After the deploy

- `GET /api/health` returns 200, and `GET /api/health/db` with
  `Authorization: Bearer $HEALTHCHECK_SECRET` returns 200.
- The outbox heartbeat advances about every 60 seconds:
  `SELECT key, "lastSucceededAt", "lastSent", "lastFailed", "lastError" FROM "OperationalHeartbeat";`
  (the `outbox-scheduler` row). Keep the independent once-a-minute call to
  `POST /api/internal/outbox`; it doubles throughput.
- No new email has failed permanently:
  `SELECT kind, count(*) FROM "OutboxMessage" WHERE status = 'FAILED' AND "lastError" LIKE '%PermanentOutboxError%' AND "createdAt" > now() - interval '1 day' GROUP BY kind;`
  (Super admin → Email shows the queue by kind). If any appeared during an
  overlap, use **Retry failed email (last 7 days)** in Super admin →
  Operations.
- Smoke-test `/help`, one published event page, one old ticket, one short
  link, a check-in, and a machine API v1 call.

### Fixed by the release gate

The release gate on `a952faf` found no blocker. Pull requests
[#27](https://github.com/twilighty-abhi/yuyu/pull/27) and
[#29](https://github.com/twilighty-abhi/yuyu/pull/29) fixed what it found and
are part of this release. The fixes cover large-event dashboard memory, outbox
throughput and transactional-first ordering, raw SQL time zones, the false MFA
"Sign-in failed" alert, and missing sections on new events' public pages. They
also cover the submission receipt message, edits to live events, and the iOS
app-link exclusions.

### Rollback

Migrations cannot be reversed in place. Choose the path by whether
new-feature data exists yet.

**Image-only rollback** is safe only while no new-feature data exists. The
old release's Prisma client cannot read the new enum values, so once a
`JUDGE` co-organiser grant or a `CREW` event-page section has been saved, the
old public event pages answer 500 and its dashboards throw. Check first:

```sql
SELECT count(*) FROM "EventPageSection" WHERE type = 'CREW';
SELECT count(*) FROM "EventCollaborator" WHERE 'JUDGE' = ANY(permissions);
```

When both are 0, stop the new release and start the recorded `bf7a04d`
image. In rehearsal the old release served 61 of 61 sampled public, machine
and mobile responses unchanged on the migrated schema. It ignores crew,
team, judging and attendance-confirmation data (it counts crew against
capacity and treats team events as individual events), and its outbox worker
marks any queued email of the new kinds `FAILED`.

**Restore the backup** once new-feature data exists. This discards
everything written since the backup.

1. Stop the application.
2. Create a new, **empty** database for the restore (for example
   `yuyu_restore`; the name must not contain a `dev` or `test` segment).
   `db:restore` runs `pg_restore --clean` in one transaction, which fails on
   the upgraded database because the new tables depend on the old ones.
3. From a checkout of `bf7a04d`, with `DATABASE_URL` pointing at the empty
   database, run
   `npm run db:restore -- --file backups/<name>.dump --production --confirm-database <dbname>`.
   The host must not be `localhost`, `127.0.0.1` or `::1`; through a local
   tunnel, address it as `localhost.` (with the trailing dot). The command
   then runs `db:status` and `db:verify`; run `npm run db:status` and
   `npm run db:verify` again if you want to see them yourself. Do not use
   the new release's `db:restore` for this backup: the data restores, but its
   follow-up `db:status` sees 13 unapplied migrations and reports "Restore
   failed."
4. Point the application at the restored database (or rename the databases
   while nothing is connected), and start the `bf7a04d` image.

The rehearsed restore took 1.4 s and matched the pre-upgrade data exactly.

**If a restore is not acceptable**, the minimum cleanup before running
`bf7a04d` on the upgraded database is to remove the values its Prisma client
cannot read, accepting that crew pages and judge access are lost:

```sql
BEGIN;
DELETE FROM "EventPageSection" WHERE type = 'CREW';
DELETE FROM "EventCollaborator" WHERE permissions = ARRAY['JUDGE']::"EventPermission"[];
UPDATE "EventCollaborator"
SET permissions = array_remove(permissions, 'JUDGE'::"EventPermission")
WHERE 'JUDGE' = ANY(permissions);
COMMIT;
```

**A failed migration** is not a rollback case: it rolled back atomically.
Mark it with `npx prisma migrate resolve --rolled-back <migration_name>`, fix
the cause (usually a lock held by another session), and run
`npm run db:deploy` again.
