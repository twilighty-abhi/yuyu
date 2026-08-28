<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Yuyu agent guide

## Project at a glance

Yuyu is a self-hosted, multi-tenant platform for organizing and running free events. Yuyu does not support paid events, ticket sales, payments, refunds, or event revenue. Event registration and attendance are always free for attendees. It uses Next.js 16 App
Router, React 19, TypeScript, PostgreSQL with Prisma 6, Auth.js v5, Material
UI 9, Redis, S3-compatible private storage, Nodemailer, Vitest, and
Playwright. Deployment supports Docker standalone output and the Helm chart in
`charts/yuyu/`.

The product currently includes organisations and member roles, public/private
events and RRULE-based series, custom RSVP forms and waitlists, QR tickets and
offline check-in, feedback/certificates, transactional email, and a separate
super-admin operations and instance-settings area, plus a tenant-bound machine
API. Treat this as a production-oriented application:
tenant isolation, privacy, and secure operations are core behaviour rather
than optional polish.

Read the relevant page in `docs/` before changing an unfamiliar product area:

- `docs/ARCHITECTURE.md` for ownership, data flow, and deployment shape.
- `docs/ROUTES.md` for public, dashboard, admin, and operational routes.
- `docs/SECURITY.md` for non-negotiable security boundaries.
- `docs/CONFIGURATION.md` and `docs/production-operations.md` for environment
  and deployment changes.
- `docs/TESTING.md` for the appropriate verification level.

`prisma/schema.prisma` is authoritative for data model details. Do not infer a
field, constraint, or cascade from a component alone.

## Repository map

| Path | Purpose |
| --- | --- |
| `app/` | App Router pages/layouts, Server Actions, and HTTP route handlers |
| `app/actions/` | Authenticated dashboard and account mutations |
| `components/` | UI grouped by product area; client components are explicit |
| `lib/` | Auth, permissions, validation, RSVP, storage, email, rate limits, and domain services |
| `prisma/` | Prisma schema and ordered migrations |
| `tests/` | Unit, PostgreSQL integration, and Playwright suites |
| `scripts/` | Production checks, schema checks, storage migration, and standalone helpers |
| `charts/yuyu/` | Helm deployment chart and migration job |
| `docs/` | Product, security, development, and operational handbook |

## Working conventions

- Inspect nearby code and existing tests before introducing a pattern. Keep
  changes small, typed, and consistent with the established MUI/Emotion UI.
- Use Server Components by default. Add `"use client"` only for browser state,
  effects, event handlers, or browser APIs.
- Read the relevant current Next.js 16 guide in `node_modules/next/dist/docs/`
  before changing Next.js APIs, routing, caching/rendering, proxy behaviour,
  Server Actions, metadata, or configuration. This version has breaking
  differences from older Next.js releases.
- Prefer server-side domain helpers in `lib/` over duplicating business rules
  in actions, route handlers, or components.
- Validate all boundary inputs with the existing Zod validators. Return UI-safe
  errors; do not leak internal details.
- Use the project time-zone and recurrence helpers for dates and series. Avoid
  ad-hoc `Date` parsing or client-only permission decisions.
- Preserve accessibility: use MUI semantics/labels, keyboard-operable controls,
  and accessible feedback for async mutation state.

## Security and tenancy rules

- `Organisation` is the tenant boundary. Every dashboard read or mutation must
  resolve the organisation server-side and verify membership plus the required
  `OWNER`/`ADMIN`/`MEMBER` permission. UI visibility is never authorization.
- Super-admin access is distinct from organisation access. Keep its
  `SUPER_ADMIN_EMAIL` check, fresh TOTP step-up, generic not-found behaviour,
  and audit coverage intact. Instance-managed SMTP/Google secrets are
  write-only browser inputs, encrypted at rest through the domain-separated
  `MFA_ENCRYPTION_KEY` material, and must never be placed in UI props, logs, or
  audit metadata.
- Server Actions need authentication, authorization, Zod validation, rate
  limiting where applicable, and audit behaviour before mutation. Public RSVP,
  feedback, and search endpoints use route handlers and need equivalent
  protections.
- Preserve event privacy, invite/allowlist checks, capacity transactions,
  duplicate-RSVP protection, ticket eligibility, and feedback anonymity. These
  rules are server-owned and must not be weakened for a UI shortcut.
- Treat ticket, certificate, invite, password-reset, MFA, scheduler, and
  readiness values as secrets/bearer capabilities. Never log, expose, test
  with, or place them in audit metadata, URLs in diagnostics, or analytics.
- Do not read, print, commit, or copy `.env` values. Use `.env.example` for
  variable names and redacted examples. If a credential is exposed in a chat,
  editor, commit, or log, advise rotation rather than repeating it.
- Keep production storage private. Uploaded cover images must continue through
  validation, decode/resize, metadata stripping, WebP re-encoding, and the
  application-controlled delivery route.
- Do not loosen CSP nonces, security headers, trusted proxy-IP handling,
  Server Action origins, Redis fail-closed behaviour, or production TLS checks
  without a documented security and deployment change.

## Data, schema, and background work

- Use Prisma transactions for multi-record state changes, especially RSVP
  capacity/waitlist flows. Rely on database constraints as the final integrity
  layer, not a prior UI check.
- For schema changes, create and review a Prisma migration. Inspect generated
  SQL for indexes, nullability, backfills, constraints, and cascades. Do not
  use `db:push` for deployable changes.
- Keep migration application separate from application startup: production uses
  `npm run db:deploy` as a release/migration job, including the Helm migration
  job where applicable.
- Email is queued in `OutboxMessage`; request paths must not wait for SMTP.
  Preserve safe concurrent claims, retry behaviour, retention cleanup, and the
  one-minute worker/`POST /api/internal/outbox` recovery path.
- Instance settings override legacy environment fallbacks for SMTP, Google SSO,
  and backup posture. Backup settings are display-only; do not imply that the
  app creates, retains, or restores provider backups.
- Machine API clients are tenant-bound bearer identities, not Auth.js users.
  Require explicit scopes, resolve the tenant solely from the credential, use
  explicit DTOs/selects, and never log or persist a raw credential.
- Operational changes must preserve `/api/health` as dependency-free liveness
  and protect `/api/health/db` and `/api/internal/outbox` with their respective
  bearer secrets and generic unauthorized responses.

## Verification

Run the narrowest relevant checks while developing, then proportionate project
checks before handoff:

```bash
npm run lint
npx tsc --noEmit
npm run test:unit
npm run test:integration       # requires disposable local PostgreSQL
npm run build
npm run test:e2e               # routing/auth/public-flow changes
npm run test:e2e:production    # security, headers, auth, tickets, public flows
```

For schema or production configuration work, also run `npm run db:status`,
`npm run db:verify`, and/or `npm run production:check` as applicable. Do not
run integration tests against any non-disposable database. Report checks that
were not run and why.

## Deployment-sensitive changes

- Production requires TLS-backed PostgreSQL, `rediss://`, private S3 storage,
  authenticated SMTP, stable build/runtime Server Action encryption keys, and
  matching HTTPS `AUTH_URL`/`NEXT_PUBLIC_BASE_URL` values.
- Changes to public build-visible variables (including
  `NEXT_PUBLIC_BASE_URL`) require a rebuild. Google SSO is runtime
  instance-managed; do not reintroduce a build-visible feature flag for it.
- A hostname change also needs OAuth callback/origin, DNS/TLS/CDN, scheduler,
  monitoring, and trusted-host review; retain an HTTPS redirect for shared
  event, invitation, ticket, and certificate links.
- Keep `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` stable across all replicas and the
  build. Rotate it only deliberately because outstanding Server Action forms
  will no longer be valid. Never rotate MFA encryption without a seed
  re-encryption plan.
