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
4. Configure a scheduler to call `POST /api/internal/outbox` every minute with `Authorization: Bearer $CRON_SECRET`, and an authenticated readiness probe to call `GET /api/health/db` with `Authorization: Bearer $HEALTHCHECK_SECRET`.
5. Verify readiness, error rate, email queue depth, database connections, and Redis health before shifting traffic.

## Backup and incident minimums

- Test a point-in-time database restore every quarter and record the recovery time and data-loss window.
- Alert on failed backups, failed migrations, outbox messages in `FAILED`, unavailable Redis, elevated 5xx rates, and database saturation.
- Rotate `AUTH_SECRET`, `CRON_SECRET`, OAuth credentials, SMTP credentials, and database credentials through the secrets manager; rehearse revocation.
- Keep an incident log, publish a security-contact address, and document breach notification responsibilities for each deployment region.

## Privacy operations

- Collect only fields necessary for each event and document the purpose/retention period.
- Fulfil access, export, correction, and deletion requests through audited administrator workflows.
- Purge expired verification tokens, old offline rosters, unused assets, and guest registration data according to the published retention policy.
- Do not place passwords, reset tokens, ticket tokens, full registration answers, or email addresses in application logs or audit metadata.
