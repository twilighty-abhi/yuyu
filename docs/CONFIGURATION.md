# Configuration

[Documentation index](README.md)

Copy `.env.example` to `.env` for local development. Production secrets must come from a secrets manager or the deployment platform, never from a committed file.

## Core and authentication

| Variable | Production | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Required | PostgreSQL URL; production requires `sslmode=require`, `verify-ca`, or `verify-full` |
| `AUTH_SECRET` | Required | Auth.js signing/encryption secret, at least 32 characters |
| `AUTH_URL` | Required | Canonical Auth.js HTTPS origin |
| `NEXT_PUBLIC_BASE_URL` | Required | Public link origin; must exactly match `AUTH_URL` |
| `AUTH_GOOGLE_ID` | Optional | Google OAuth client ID |
| `AUTH_GOOGLE_SECRET` | Optional | Google OAuth client secret |
| `NEXT_PUBLIC_AUTH_GOOGLE_CONFIGURED` | Optional | Set to `1` to render Google sign-in; this is build-visible configuration |
| `SUPER_ADMIN_EMAIL` | Recommended | Sole email allowed into the instance administration area |

## Application secrets

| Variable | Production | Purpose |
| --- | --- | --- |
| `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` | Required | Stable base64 AES key shared by the build and every replica; 16, 24, or 32 decoded bytes |
| `MFA_ENCRYPTION_KEY` | Required | Independent base64 key used to encrypt TOTP seeds; exactly 32 decoded bytes |
| `CRON_SECRET` | Required | Bearer secret for the outbox scheduler, at least 32 characters |
| `HEALTHCHECK_SECRET` | Required | Bearer secret for database readiness, at least 32 characters |

Generate independent keys with `openssl rand -base64 32`. Rotating the Server Action key invalidates outstanding action forms. Rotating the MFA key without re-encrypting stored seeds prevents enrolled users from validating TOTP codes.

## Redis and request trust

| Variable | Production | Purpose |
| --- | --- | --- |
| `REDIS_URL` | Required | Distributed rate limiter; production requires `rediss://` |
| `TRUSTED_PROXY_IP_HEADER` | Required | One of `cf-connecting-ip`, `x-forwarded-for`, or `x-real-ip`; the edge must overwrite it |
| `ALLOWED_ACTION_ORIGINS` | Optional | Comma-separated trusted proxy/CDN hosts allowed to invoke Server Actions |
| `NEXT_DEV_ALLOWED_ORIGINS` | Development only | Comma-separated LAN hosts permitted to request development assets |

Do not expose the application directly while trusting a client-controlled forwarding header.

## Email and retention

| Variable | Production | Purpose |
| --- | --- | --- |
| `EMAIL_FROM` | Required | Verified sender identity |
| `SMTP_SERVICE` | One SMTP mode required | Nodemailer service name |
| `SMTP_HOST` | One SMTP mode required | Custom SMTP hostname |
| `SMTP_PORT` | With custom SMTP | SMTP port, commonly 587 or 465 |
| `SMTP_SECURE` | With custom SMTP | Whether to establish implicit TLS |
| `SMTP_USER` / `SMTP_PASSWORD` | Normally required | SMTP credentials |
| `SMTP_ALLOW_UNAUTHENTICATED` | Exceptional | Set to `1` only for a deliberately unauthenticated private relay |
| `OUTBOX_RETENTION_DAYS` | Optional | Retention for sent outbox records; defaults to 30 |

Production SMTP connections require TLS with certificate verification.

## Object storage

| Variable | Production | Purpose |
| --- | --- | --- |
| `S3_BUCKET` | Required | Private object-store bucket |
| `S3_REGION` | Required | Bucket region |
| `S3_ENDPOINT` | Provider-dependent | Custom HTTPS endpoint for R2, MinIO, or another compatible service |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | Provider-dependent | Configure both, or neither when using a workload/IAM role |
| `S3_FORCE_PATH_STYLE` | Optional | Set to `1` for providers that require path-style addressing |

The bucket must remain private. Existing database-backed assets can be moved with `npm run storage:migrate` after S3 is configured.

## Operational metadata

| Variable | Purpose |
| --- | --- |
| `BACKUP_PROVIDER` | Name displayed on the operations screen |
| `BACKUP_LAST_SUCCESS_AT` | ISO timestamp supplied by the backup job |
| `BACKUP_RETENTION_DAYS` | Displayed backup-retention target |

## Test-only bypass

`ALLOW_INSECURE_PRODUCTION_TESTS=1` has an effect only when `CI=true`. Together they permit local HTTP, non-TLS test services, and the controlled in-memory Redis fallback while exercising a production build. Never configure this pair in a deployed environment.

Validate production configuration with:

```bash
npm run production:check
```
