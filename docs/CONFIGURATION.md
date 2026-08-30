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
| `AUTH_GOOGLE_ID` | Legacy fallback | Google OAuth client ID; configure new instances in Super admin → Settings |
| `AUTH_GOOGLE_SECRET` | Legacy fallback | Google OAuth client secret; configure new instances in Super admin → Settings |
| `SUPER_ADMIN_EMAIL` | Recommended | Sole email allowed into the instance administration area |

### Deployment example: `events.dev.idliapps.com`

For the current deployment hostname, configure both canonical URL settings to the exact same HTTPS origin:

```env
AUTH_URL=https://events.dev.idliapps.com
NEXT_PUBLIC_BASE_URL=https://events.dev.idliapps.com
```

If Google OAuth is enabled, register this callback with Google Cloud:

```text
https://events.dev.idliapps.com/api/auth/callback/google
```

Leave `ALLOWED_ACTION_ORIGINS` empty when browsers reach the application on this same hostname. Configure it only if a trusted CDN or reverse proxy uses a different host for Server Action requests.

### Changing the public domain

When the application moves to a new hostname, update `AUTH_URL` and `NEXT_PUBLIC_BASE_URL`, update the Google OAuth callback/origin if used, then rebuild and deploy because `NEXT_PUBLIC_BASE_URL` is build-visible. Update DNS, TLS, the CDN/WAF, scheduler and uptime-monitor targets, and any reverse-proxy host allowlists at the same time.

Keep an HTTPS redirect from the old hostname to the new one for as long as invitation, ticket, certificate, and shared event links may be used. Auth cookies are host-specific, so existing users may need to sign in again after the change.

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
| `EMAIL_FROM` | Legacy fallback | Verified sender identity; configure new instances in Super admin → Settings |
| `SMTP_*` | Legacy fallback | SMTP settings; configure new instances in Super admin → Settings |
| `OUTBOX_RETENTION_DAYS` | Optional | Retention for non-capability sent/failed outbox history; defaults to 30 (capability-bearing rows are deleted immediately after delivery or terminal failure) |

Configure SMTP, Google SSO, and backup status under **Super admin → Settings**. SMTP and Google client secrets are encrypted at rest with a domain-separated key derived from `MFA_ENCRYPTION_KEY`, are never displayed after saving, and require the super-admin fresh-TOTP step-up. Environment values remain supported as migration fallbacks. Production SMTP connections require TLS with certificate verification.

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
| `BACKUP_*` | Legacy fallback | Backup status metadata; configure new instances in Super admin → Settings |

## Test-only bypass

`ALLOW_INSECURE_PRODUCTION_TESTS=1` has an effect only when `CI=true`. Together they permit local HTTP, non-TLS test services, and the controlled in-memory Redis fallback while exercising a production build. Never configure this pair in a deployed environment.

Validate production configuration with:

```bash
npm run production:check
```
