# Configuration

[Documentation index](README.md)

Copy `.env.example` to `.env` for local development. Production secrets must come from a secrets manager or the deployment platform, never from a committed file.

Blank values (for example `SMTP_HOST=""` left over from `.env.example`) are treated as unset by the production startup check and by `npm run production:check`, so placeholders for panel-managed settings do not stop the server from starting.

## Core and authentication

| Variable | Production | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Required | PostgreSQL URL; production requires `sslmode=require`, `verify-ca`, or `verify-full` |
| `AUTH_SECRET` | Required | Auth.js signing/encryption secret, at least 32 characters |
| `AUTH_URL` | Required | Canonical Auth.js HTTPS origin |
| `NEXT_PUBLIC_BASE_URL` | Required | Public link origin; must exactly match `AUTH_URL`. Sent emails also use it to make site-relative images and links (event cover, organisation logo, event page) absolute; without it those are left out of delivered broadcasts, while the dashboard preview still renders them |
| `AUTH_GOOGLE_ID` | Legacy fallback | Google OAuth client ID; configure new instances in Super admin → Settings |
| `AUTH_GOOGLE_SECRET` | Legacy fallback | Google OAuth client secret; configure new instances in Super admin → Settings |
| `SUPER_ADMIN_EMAIL` | Recommended | Sole email allowed into the instance administration area |
| `GOOGLE_MOBILE_CLIENT_IDS` | Optional | Comma-separated Google OAuth client ids of the Yuyu mobile apps (Android and iOS). Mobile Google sign-in accepts ID tokens whose `aud` is the web Google client id or one of these; when set, a token issued for the web client id must also name one of these as `azp`. Available only when web Google sign-in is configured |
| `ANDROID_APP_SHA256_CERT_FINGERPRINTS` | Optional | Comma-separated SHA-256 signing-certificate fingerprints (`AA:BB:…`) published in `/.well-known/assetlinks.json` for Android App Links (package `com.twilighty.yuyu`); unset serves `[]` |
| `APPLE_APP_IDS` | Optional | Comma-separated `TEAMID.bundle.id` values (for example `ABCDE12345.com.twilighty.yuyu`) published in `/.well-known/apple-app-site-association` for iOS Universal Links (tickets, event pages and feedback forms; see [Mobile API](MOBILE_API.md#app-links)); unset serves empty details |

`.env.example` also lists `NEXTAUTH_SECRET`/`NEXTAUTH_URL`, commented out. Yuyu's code and `npm run production:check` read only `AUTH_SECRET` and `AUTH_URL`; the `NEXTAUTH_*` names are Auth.js compatibility aliases and are not a substitute in production.

### Deployment example: `events.example.com`

Configure both canonical URL settings to the exact same HTTPS origin:

```env
AUTH_URL=https://events.example.com
NEXT_PUBLIC_BASE_URL=https://events.example.com
```

If Google OAuth is enabled, register this callback with Google Cloud:

```text
https://events.example.com/api/auth/callback/google
```

Leave `ALLOWED_ACTION_ORIGINS` empty when browsers reach the application on this same hostname. Configure it only if a trusted CDN or reverse proxy uses a different host for Server Action requests.

### Changing the public domain

When the application moves to a new hostname, update `AUTH_URL` and `NEXT_PUBLIC_BASE_URL`, update the Google OAuth callback/origin if used, then rebuild and deploy because `NEXT_PUBLIC_BASE_URL` is build-visible. Update DNS, TLS, the CDN/WAF, scheduler and uptime-monitor targets, and any reverse-proxy host allowlists at the same time.

Keep an HTTPS redirect from the old hostname to the new one for as long as invitation, ticket, certificate, and shared event links may be used. Auth cookies are host-specific, so existing users may need to sign in again after the change.

## Application secrets

| Variable | Production | Purpose |
| --- | --- | --- |
| `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` | Required | Stable base64 AES key shared by the build and every replica; 16, 24, or 32 decoded bytes |
| `MFA_ENCRYPTION_KEY` | Required | Independent base64 key used to encrypt TOTP seeds; exactly 32 decoded bytes. A domain-separated subkey also encrypts the SMTP password, Google client secret, and alert webhook URL saved in Super admin → Settings, and another one the organisation webhook signing secrets. Must be identical on every replica and job (app pods, migration job, any one-off container) and stable |
| `CRON_SECRET` | Required | Bearer secret for the outbox scheduler, at least 32 characters |
| `HEALTHCHECK_SECRET` | Required | Bearer secret for database readiness, at least 32 characters |

Generate independent keys with `openssl rand -base64 32`. Rotating the Server Action key invalidates outstanding action forms. Rotating the MFA key without re-encrypting stored seeds prevents enrolled users from validating TOTP codes.

**`MFA_ENCRYPTION_KEY` mismatch or rotation.** The server validates only the key's format at startup, so a replica with a different key still starts and passes health checks — it does not crash-loop — but on that replica every use of a value encrypted with the original key fails: outbox delivery fails and is retried until the outbox gives up, Google sign-in fails, alerts are not sent, and TOTP verification fails (including the super-admin step-up needed to fix settings). Behind a load balancer this looks intermittent. Detect it with the same environment the application receives:

```bash
node --env-file=/secure/path/yuyu.env scripts/check-instance-secrets.mjs
```

It reports which stored values cannot be decrypted, never printing them, and exits non-zero (it is also included in the `migrator` image and can run in the Helm migration job with `migration.checkInstanceSecrets=true`). Fix it by restoring the original key on every replica and job. If the original key is lost, set one new key everywhere, re-enter the SMTP password, Google client secret, and alert webhook in Super admin → Settings, and have enrolled users re-enrol MFA (recovery codes are hashed, not encrypted, and still work).

## Redis and request trust

| Variable | Production | Purpose |
| --- | --- | --- |
| `REDIS_URL` | Required | Distributed rate limiter and pub/sub for live ticket check-in across replicas; production requires `rediss://` |
| `TRUSTED_PROXY_IP_HEADER` | Required | One of `cf-connecting-ip`, `x-forwarded-for`, or `x-real-ip`; the edge must overwrite it |
| `ALLOWED_ACTION_ORIGINS` | Optional | Comma-separated trusted proxy/CDN hosts allowed to invoke Server Actions |
| `ALLOWED_EMBED_ORIGINS` | Optional | Exact HTTPS origins permitted to frame public event embeds; blank disables cross-site framing |
| `NEXT_DEV_ALLOWED_ORIGINS` | Development only | Comma-separated LAN hosts permitted to request development assets, in addition to the built-in `127.0.0.1` and `*.trycloudflare.com` (Cloudflare quick tunnels for phone testing; `next.config.ts`) |

Do not expose the application directly while trusting a client-controlled forwarding header.

Rate-limit windows are defined in code (`lib/rateLimit.ts`), not configured by environment. Recent buckets: `dataExport` (5 personal data exports per user per hour), `broadcastTest` (20 broadcast test sends per hour), `broadcastDraft` (60 email draft saves or discards per minute, per user and per IP), `ticketStatus` (120 ticket status reads per IP per minute), `ticketEvents` (60 ticket event-stream connections per IP per minute), `shortLink` (30 short-link lookups per IP per minute), `mobileAuth` (30 mobile token refreshes per IP per minute), `mobileApi` (300 mobile API requests per user per minute), and `clientError` (10 browser crash reports per IP per minute), `webhookManage` (30 webhook endpoint changes per minute) and `webhookTest` (20 webhook test sends or redeliveries per hour). The ticket buckets are generous because attendees at one venue often share a NAT address.

The live ticket stream at `/api/ticket/:token/events` is a long-lived `text/event-stream` response. Any reverse proxy in front of the application must not buffer it (for nginx, `proxy_buffering off`; the route also sends `X-Accel-Buffering: no`) and must allow idle reads of at least 30 seconds.

## Email and retention

| Variable | Production | Purpose |
| --- | --- | --- |
| `EMAIL_FROM` | Optional fallback | Verified sender identity; configure new instances in Super admin → Settings |
| `SMTP_*` | Optional fallback | SMTP settings; configure new instances in Super admin → Settings. The names are `SMTP_SERVICE` (a Nodemailer well-known service such as `gmail`, used instead of host/port), `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE` (`true`/`false`), `SMTP_USER`, `SMTP_PASSWORD`, and `SMTP_ALLOW_UNAUTHENTICATED` (`1` only for a private unauthenticated relay). When `SMTP_SERVICE`/`SMTP_HOST` is set without `SMTP_ALLOW_UNAUTHENTICATED=1`, `production:check` requires `SMTP_USER` and `SMTP_PASSWORD` |
| `OUTBOX_RETENTION_DAYS` | Optional | Retention for non-capability sent/failed outbox history; defaults to 30 (capability-bearing rows are deleted immediately after delivery or terminal failure) |

Configure SMTP, Google SSO, backup status, and operational alerts under **Super admin → Settings**. SMTP and Google client secrets and the alert webhook URL are encrypted at rest with a domain-separated key derived from `MFA_ENCRYPTION_KEY`, are never displayed after saving, and require the super-admin fresh-TOTP step-up. Production SMTP connections require TLS with certificate verification.

### Panel settings and environment fallbacks

- **Database overrides environment.** Panel values are read from the database at send and sign-in time on every replica, so a change applies on the next email or sign-in without a restart, redeploy, or rebuild. None of them is build-visible.
- **SMTP is all-or-nothing.** Once SMTP (a service or a host) is saved in the panel, every `SMTP_*` variable is ignored: service, host, port, TLS, username, password, and the private-relay flag all come from the panel, and no single field falls back to the environment. Clear both Service and Host and save to return to the environment configuration. The sender address falls back on its own: the saved value, then `EMAIL_FROM`, then `Yuyu Events <noreply@localhost>`. **Send test email** sends to your own super-admin address with the saved settings (15-second limit). In production, SMTP must be authenticated unless *Private unauthenticated relay* (or `SMTP_ALLOW_UNAUTHENTICATED=1`) is set; TLS 1.2+ with certificate verification is required except in CI/staging mode (`CI=true` with `ALLOW_INSECURE_PRODUCTION_TESTS=1`, e.g. Mailpit on port 1025).
- **Google SSO** uses a saved client ID only with the saved secret. If that secret is missing or cannot be decrypted, Google sign-in is off rather than paired with an environment secret, and password sign-in keeps working. With no saved client ID, `AUTH_GOOGLE_ID`/`AUTH_GOOGLE_SECRET` (or the legacy `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`) apply, and the panel cannot switch those off; remove the variables instead. Register `${AUTH_URL}/api/auth/callback/google` with Google.
- **Backup posture:** any saved backup field replaces the `BACKUP_*` values together; the last successful backup is entered in UTC.
- **Not required in the environment.** Neither the startup check nor `npm run production:check` requires `EMAIL_FROM`, `SMTP_*`, or `AUTH_GOOGLE_*`; the preflight only notes when no SMTP fallback exists. Until SMTP is saved in the panel (or provided as a fallback), production email stays queued. Keeping an environment SMTP fallback is still recommended for bootstrap and disaster recovery (for example, a lost `MFA_ENCRYPTION_KEY`).
- **Operational alerts** are configured only in the panel. Every application process posts them directly to the webhook (for example Mattermost) over outbound HTTPS, so app containers/pods need egress to the webhook host on port 443, in addition to SMTP (typically 465/587), PostgreSQL, Redis, and object storage. Browser crash reports reach the app at `/api/client-errors` and are forwarded the same way.

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

| Variable | Production | Purpose |
| --- | --- | --- |
| `BACKUP_PROVIDER` | Legacy fallback | Displayed backup provider name (up to 80 characters) |
| `BACKUP_LAST_SUCCESS_AT` | Legacy fallback | Displayed time of the last successful backup, as an ISO 8601 datetime |
| `BACKUP_RETENTION_DAYS` | Legacy fallback | Displayed retention period, 1 to 3650 days |

These values are display-only and do not run or retain backups; configure new instances in Super admin → Settings.

## Organisation webhooks

| Variable | Production | Purpose |
| --- | --- | --- |
| `WEBHOOKS_ALLOW_PRIVATE_TARGETS` | **Never** (development/test only) | `1` lets organisation webhooks use `http://` and private or loopback receivers on any port, for a local test receiver. A production server ignores it except in the CI-only test mode below, and `npm run production:check` fails when it is set |

Webhook signing secrets are encrypted with a domain-separated key derived from `MFA_ENCRYPTION_KEY`; no new secret is needed. App processes need outbound HTTPS (ports 443 and 8443) to the receivers organisations configure. See [Organisation webhooks](WEBHOOKS.md).

## Test-only bypass

`ALLOW_INSECURE_PRODUCTION_TESTS=1` has an effect only when `CI=true`. Together they permit local HTTP, non-TLS test services, the controlled in-memory Redis fallback, and `WEBHOOKS_ALLOW_PRIVATE_TARGETS` while exercising a production build. Never configure this pair in a deployed environment.

Validate production configuration with:

```bash
npm run production:check
```
