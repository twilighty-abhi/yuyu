# Production release checklist

[Documentation index](README.md)

Yuyu must not be released until every item below is complete and recorded in the deployment change.

## Required managed services

- PostgreSQL with TLS, encryption at rest, daily backups, point-in-time recovery, and a documented restore drill.
- Redis configured through `REDIS_URL`. The application deliberately rejects security-sensitive traffic when Redis is unavailable in production.
- Private S3-compatible object storage configured with `S3_BUCKET` and `S3_REGION`. Use an IAM workload role where possible; keep the bucket private.
- A transactional email provider with a verified sending domain, SPF, DKIM, DMARC, bounce handling, and alerting.
- A scheduler that invokes `POST /api/internal/outbox` at least once per minute with `Authorization: Bearer $CRON_SECRET`. This delivers queued mail and purges expired operational records; monitor both delivery and cleanup results.
- WAF/CDN and TLS termination in front of the app. Forward only the configured trusted client-IP header.
- Centralized PII-scrubbed logs, error reporting, uptime checks, and alerts for database, Redis, outbox, mail, and backup failures.

## Deployment procedure

1. Review and approve the Prisma migration; take a backup before applying it. The secure-token migration rotates existing ticket and certificate links.
2. Run `npm ci`, `npm run production:check`, `npm run db:deploy`, `npm run db:verify`, `npm run storage:migrate`, `npm run lint`, `npx tsc --noEmit`, `npm run test:coverage`, and `npm run build` in staging.
3. Exercise auth, organisation permissions, RSVP capacity, duplicate RSVP, upload rejection, email delivery, and offline-check-in sync in staging.
4. Build an immutable image with `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` supplied as a build argument, inject that same value at runtime, run the authenticated `/api/health/db` readiness probe, and verify the outbox scheduler.
5. Confirm alert delivery and record the release, backup point, migration version, and rollback owner.

## Required operating controls

- Publish privacy, cookie, acceptable-use, retention, and incident-response policies.
- Define organiser data export approvals, account export/delete handling, retention periods, and a subprocessor register.
- Run periodic restore drills, access reviews, dependency scans, load tests, and security tests.
- Require high-risk organisers to enable authenticator MFA from `/dashboard/security`; Google-based users must also be covered by the organisation's Google MFA policy. Session revocation is available from the same page.
- Set `TRUSTED_PROXY_IP_HEADER` to the one client-IP header your CDN overwrites; do not expose the application directly to the internet behind an arbitrary forwarded header.
- Preserve `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` across every container serving a release. Rotating it invalidates outstanding Server Action forms.

## Cover-image safety

Cover images are signature/pixel validated, decoded, metadata-stripped, resized, and re-encoded as WebP before entering a private object-store bucket. Only generated derivatives are delivered through the application. Run `npm run storage:migrate` once after configuring S3 to remove legacy database blobs.
