# Production Docker deployment

[Documentation index](README.md)

This guide describes the Docker deployment that the repository supports today.
It is intended for a single host or another container platform that does not use
Kubernetes. For Kubernetes, use the [Helm chart](../charts/yuyu/README.md).

Yuyu does **not** currently provide a production `docker compose up` installer.
The root `docker-compose.yml` is for local PostgreSQL development, and
`compose.staging.yml` deliberately enables insecure CI/staging exceptions. Do
not use either file for production or real attendee data.

## Production topology

Run the Yuyu application container behind a TLS-terminating reverse proxy or
load balancer. Supply these production services separately:

- PostgreSQL with TLS, encryption at rest, point-in-time recovery, and tested
  backups;
- Redis over TLS (`rediss://`);
- private S3-compatible object storage, using an HTTPS endpoint when one is
  configured;
- authenticated transactional SMTP; and
- a CDN/WAF or reverse proxy that overwrites the configured trusted client-IP
  header.

The application image contains only the application. It does not run
PostgreSQL, Redis, object storage, TLS termination, or SMTP. Keep the container
port private and expose it only through the trusted proxy.

## Build immutable images

Build the application and migration targets from the same reviewed commit and
give both the same immutable release version:

```bash
export YUYU_VERSION=1.0.0

docker build \
  --target migrator \
  --tag registry.example.com/yuyu-migrator:${YUYU_VERSION} \
  .

docker build \
  --target runner \
  --build-arg NEXT_SERVER_ACTIONS_ENCRYPTION_KEY="$NEXT_SERVER_ACTIONS_ENCRYPTION_KEY" \
  --tag registry.example.com/yuyu:${YUYU_VERSION} \
  .
```

The Server Actions key is required only by the application build. Supply the
same stable value to the running application. Build it in trusted CI without
printing it, and do not publish or reuse the key between independent Yuyu
instances. Rotating it invalidates outstanding Server Action forms.

Push immutable version tags to a private registry. Do not deploy a mutable
`latest` tag.

## Configure the runtime

Create a production environment file outside the repository, restrict it to its
owner, and populate the variables documented in
[Configuration](CONFIGURATION.md). A deployment-platform secrets manager is
preferred; an owner-only environment file is the minimum single-host option.

```bash
umask 077
touch /secure/path/yuyu.env
```

At minimum, verify that:

- `AUTH_URL` and `NEXT_PUBLIC_BASE_URL` are the same public HTTPS origin;
- `DATABASE_URL` requires TLS;
- `REDIS_URL` starts with `rediss://`;
- a custom `S3_ENDPOINT`, when used, starts with `https://`;
- the S3 bucket is private;
- `EMAIL_FROM` and an authenticated `SMTP_SERVICE` or `SMTP_HOST` fallback are
  configured for bootstrap and disaster recovery;
- `TRUSTED_PROXY_IP_HEADER` names a header overwritten by the edge; and
- `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` is exactly the value used for the
  application image build.

Run the preflight from a trusted release checkout before deploying:

```bash
node --env-file=/secure/path/yuyu.env scripts/check-production-env.mjs
```

Do not expose the contents of the environment file in logs, shell tracing, or a
deployment record.

## First installation

For a new empty database, run the one-shot migration image before starting the
application:

```bash
docker pull registry.example.com/yuyu-migrator:${YUYU_VERSION}
docker pull registry.example.com/yuyu:${YUYU_VERSION}

docker run --rm \
  --env-file /secure/path/yuyu.env \
  registry.example.com/yuyu-migrator:${YUYU_VERSION}

node --env-file=/secure/path/yuyu.env scripts/verify-production-schema.mjs
```

Start the application on a loopback-only port when the reverse proxy runs on
the host:

```bash
docker run -d \
  --name yuyu \
  --restart unless-stopped \
  --env-file /secure/path/yuyu.env \
  --publish 127.0.0.1:3000:3000 \
  registry.example.com/yuyu:${YUYU_VERSION}
```

If the proxy is another container, use a private Docker network instead of a
published host port. Do not publish PostgreSQL, Redis, or object-storage
administration ports to the internet.

Verify liveness locally and through the public HTTPS origin:

```bash
curl --fail http://127.0.0.1:3000/api/health
curl --fail https://events.example.com/api/health
```

Also call `GET /api/health/db` from the monitoring system with the
`Authorization` header set to `Bearer $HEALTHCHECK_SECRET`. Do not place that
bearer value in a URL.

After the first sign-in, enroll authenticator MFA for the super-admin account,
then verify or replace the bootstrap SMTP fallback and configure optional
Google SSO under `/super-admin/settings`. Test email delivery before accepting
registrations. Keep the environment SMTP credentials in the deployment secret
store as a disaster-recovery fallback.

## Upgrade an existing installation

Use this order for every release:

1. Complete the [production release checklist](PRODUCTION_RELEASE.md).
2. Take and verify a database backup and record the current application image.
3. Pull the new application and migrator images.
4. Run the new migrator image once. A failed migration blocks the rollout.
5. Replace the application container with the new immutable image.
6. Verify liveness, authenticated database readiness, outbox heartbeat, email
   delivery, Redis health, and error rate before completing the deployment.

Example container replacement after a successful migration:

```bash
docker stop yuyu
docker rename yuyu yuyu-previous

docker run -d \
  --name yuyu \
  --restart unless-stopped \
  --env-file /secure/path/yuyu.env \
  --publish 127.0.0.1:3000:3000 \
  registry.example.com/yuyu:${YUYU_VERSION}
```

Remove `yuyu-previous` only after the new release is healthy. Reverting the
application image does not reverse a database migration; migrations must be
reviewed for backward compatibility and restored from a verified backup when a
database rollback is genuinely required.

## Outbox scheduling and readiness

Each application process runs the outbox worker once per minute. In production,
also configure an independent scheduler to call `POST /api/internal/outbox`
with `Authorization: Bearer $CRON_SECRET` as a recovery path. Monitor the
worker heartbeat and failed queue items.

Use `/api/health` for dependency-free liveness. Use the bearer-protected
`/api/health/db` endpoint for readiness. Never expose either bearer secret in
monitoring URLs or logs.

## Current image-packaging limitations

The `runner` image does not contain the Prisma CLI or operational scripts. The
`migrator` image contains Prisma migrations but not the storage migration,
backup, or restore scripts. Consequently:

- run `npm run storage:migrate` from a trusted checkout when legacy
  database-backed assets still exist; and
- run `npm run db:backup` and `npm run db:restore` from a trusted operational
  host with compatible PostgreSQL client tools.

Follow [Production operations](production-operations.md) for backup storage,
restore acknowledgement, retention, monitoring, and incident requirements.
An image-only production installer and bundled production Compose stack are
future deployment work, not current repository capabilities.
