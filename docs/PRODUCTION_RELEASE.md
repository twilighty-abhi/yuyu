# Production release checklist

Yuyu must not be released until every item below is complete and recorded in the deployment change.

## Required managed services

- PostgreSQL with TLS, encryption at rest, daily backups, point-in-time recovery, and a documented restore drill.
- Redis configured through `REDIS_URL`. The application deliberately rejects security-sensitive traffic when Redis is unavailable in production.
- A transactional email provider with a verified sending domain, SPF, DKIM, DMARC, bounce handling, and alerting.
- A scheduler that invokes `POST /api/internal/outbox` at least once per minute with `Authorization: Bearer $CRON_SECRET`. This delivers queued mail and purges expired operational records; monitor both delivery and cleanup results.
- WAF/CDN and TLS termination in front of the app. Forward only the configured trusted client-IP header.
- Centralized PII-scrubbed logs, error reporting, uptime checks, and alerts for database, Redis, outbox, mail, and backup failures.

## Deployment procedure

1. Review and approve the Prisma migration; take a backup before applying it.
2. Run `npm ci`, `npm run production:check`, `npm run db:deploy`, `npm run db:verify`, `npm run lint`, `npx tsc --noEmit`, and `npm run build` in staging.
3. Exercise auth, organisation permissions, RSVP capacity, duplicate RSVP, upload rejection, email delivery, and offline-check-in sync in staging.
4. Build an immutable image with `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` supplied as a build argument, inject that same value at runtime, run the authenticated `/api/health/db` readiness probe, and verify the outbox scheduler.
5. Confirm alert delivery and record the release, backup point, migration version, and rollback owner.

## Required operating controls

- Publish privacy, cookie, acceptable-use, retention, and incident-response policies.
- Define organiser data export approvals, account export/delete handling, retention periods, and a subprocessor register.
- Run periodic restore drills, access reviews, dependency scans, load tests, and security tests.
- MFA and device/session revocation are required before permitting high-risk organiser accounts in a public multi-tenant deployment.
- Set `TRUSTED_PROXY_IP_HEADER` to the one client-IP header your CDN overwrites; do not expose the application directly to the internet behind an arbitrary forwarded header.
- Preserve `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` across every container serving a release. Rotating it invalidates outstanding Server Action forms.

## Current product limitation

Cover images are signature- and pixel-validated, but are still stored in PostgreSQL and publicly delivered for event pages. Before high-volume production usage, migrate to private S3-compatible object storage, malware scanning, metadata stripping, and generated safe derivatives.
