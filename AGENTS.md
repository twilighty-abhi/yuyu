<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Yuyu agent guide

## Project at a glance

Yuyu is a self-hosted, multi-tenant platform for organizing and running free events. Yuyu does not support paid events, ticket sales, payments, refunds, or event revenue. Event registration and attendance are always free for attendees. It uses Next.js 16 App
Router, React 19, TypeScript, PostgreSQL with Prisma 6, Auth.js v5, Tailwind
CSS 4 with Radix primitives, Redis, S3-compatible private storage, Nodemailer,
Vitest, and Playwright. Deployment supports Docker standalone output and the Helm chart in
`charts/yuyu/`.

The product currently includes organisations and member roles, event
collaborators with per-event grants, public/private events and RRULE-based
series, event websites (programme, speakers, sponsors), custom RSVP forms and
waitlists, event short links, QR tickets with live check-in updates and offline check-in, badge
printing, feedback and layered certificates, designed broadcast and
transactional email, a personal account area (registrations, organisations,
data export), and a separate super-admin operations, insights, and
instance-settings area with an operational alerts webhook, a tenant-bound
machine API, and a user-authenticated mobile API (`/api/mobile/v1`) for the
Yuyu apps. Treat this as a production-oriented application:
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
| `lib/core/` | Mutation cores shared by Server Actions and `/api/mobile/v1`; change behaviour here, not in one surface |
| `lib/mobile/` | Mobile API tokens, sessions, permissions, schemas, and DTOs |
| `prisma/` | Prisma schema and ordered migrations |
| `tests/` | Unit, PostgreSQL integration, and Playwright suites |
| `scripts/` | Production checks, schema checks, storage migration, and standalone helpers |
| `charts/yuyu/` | Helm deployment chart and migration job |
| `docs/` | Product, security, development, and operational handbook; `docs/mobile-api.openapi.yaml` and `docs/mobile-api-fixtures/` are the mobile contract, checked by `tests/unit/mobile-api-contract.test.ts` |

## Working conventions

- Inspect nearby code and existing tests before introducing a pattern. Keep
  changes small, typed, and consistent with the established UI: Tailwind CSS, Radix
  primitives and lucide icons via `components/ui/*` (see `docs/DESIGN.md`).
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
- Client animations must be restart-safe under React's development
  double-invoked effects (mount, cleanup, mount). With `useAnimate`, do not use
  a one-shot "started" ref guard; give each effect run its own local
  `current` flag, clear it in cleanup, and check it after every awaited step.
- In-process singletons that must be shared across Next.js bundles (Server
  Action vs route-handler copies of a module, such as an `EventEmitter`) live
  on `globalThis` under a `Symbol.for(...)` key, not in module scope.
- Verify CSS or Tailwind changes with a clean build; a stale
  `.next/cache`/Turbopack cache can keep serving old CSS.
- Use the project time-zone and recurrence helpers for dates and series. Avoid
  ad-hoc `Date` parsing or client-only permission decisions.
- Preserve accessibility: use labelled `components/ui` controls, keyboard-operable controls,
  and accessible feedback for async mutation state.

## Security and tenancy rules

- `Organisation` is the tenant boundary. Every dashboard read or mutation must
  resolve the organisation server-side and verify membership plus the required
  `OWNER`/`ADMIN`/`MEMBER` permission. UI visibility is never authorization.
- Super-admin access is distinct from organisation access. Keep its
  `SUPER_ADMIN_EMAIL` check, fresh TOTP step-up, generic not-found behaviour,
  and audit coverage intact. Every `app/super-admin/**/page.tsx` must call
  `await requireSuperAdminMfa()` itself, because layout checks do not re-run on
  client navigation; `tests/unit/super-admin-page-guards.test.ts` enforces it.
  Super-admin insights stay read-only, capped, and parameterised, and never
  load secrets, tokens, answers, or message bodies. Instance-managed SMTP/Google secrets are
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
- Realtime ticket check-in publishes only through `commitCheckInProjection`
  (`lib/checkInMutations.ts` → `lib/ticketCheckInEvents.ts`). Channels are
  keyed by RSVP id, never the ticket token; publishing is best effort and must
  never fail a check-in. `/api/ticket/:token/status` and `/events` return only
  check-in state, validate the token shape, and are rate limited per IP.
- Account self-service stays scoped to the signed-in user: the personal export
  (`/api/exports/account`) returns allow-listed own data only (no secrets or
  tokens), is rate limited, audited, and `no-store`; leaving an organisation
  removes only the caller's membership and blocks the sole owner under a row
  lock.
- Event publication is one switch: `Event.status = PUBLISHED` and
  `EventPage.isPublished` change together in one transaction (`createEvent`,
  `updateEvent`, and `publishEvent` in `app/actions/event.ts`; `publishEvent`
  creates a missing page row released). Never set one without the other;
  public pages, RSVP (`lib/rsvpCore.ts`), and short links require both.
- Event short codes resolve only for published events with a released
  website, and unknown, unreleased, and rate-limited codes share the
  unknown-organisation 404 so a code never reveals a hidden event's slug.
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
- Sent emails need an absolute `NEXT_PUBLIC_BASE_URL` for links and images;
  dashboard previews render stored paths site-relative. When no public address
  is configured, leave images out rather than sending `localhost` links.
  Organiser values in email designs are escaped and image/link URLs limited to
  absolute http(s).
- Instance settings override legacy environment fallbacks for SMTP, Google SSO,
  and backup posture; saved SMTP replaces the `SMTP_*` environment as a whole,
  and blank environment values count as unset. Backup settings are display-only; do not imply that the
  app creates, retains, or restores provider backups.
- Mobile API sessions are user identities, never machine clients: tokens are
  stored only as SHA-256 digests, refresh tokens rotate and reuse revokes the
  session, sessions are bound to `sessionVersion`, mutations go through
  `lib/core/*`, responses are strict DTOs, and ticket tokens go only to their
  owner or `CHECK_IN` roster holders.
- Operational alerts leave the instance: keep them redacted through
  `lib/opsAlerts.ts`, keep the webhook URL write-only and encrypted, and keep
  the public `POST /api/client-errors` same-origin, size-capped, rate limited,
  and answering an empty `204`.
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
npm run test:integration       # requires TEST_DATABASE_URL for a disposable PostgreSQL
npm run build
npm run test:e2e               # routing/auth/public-flow changes
npm run test:e2e:production    # security, headers, auth, tickets, public flows
```

For schema or production configuration work, also run `npm run db:status`,
`npm run db:verify`, and/or `npm run production:check` as applicable. Do not
run integration tests against any non-disposable database. Report checks that
were not run and why.

Other sessions may edit this tree in parallel. Commit with explicit paths, and
do not sweep in or revert other sessions' uncommitted files. The user manual
(`docs/manual/`, `docs/Yuyu-User-Manual.pdf`) is committed only when asked.

### Branching: one branch per feature, merged by pull request

Every new feature or fix gets its own branch from `main` and reaches `main`
only through a reviewed, tested pull request. Never commit a feature straight
onto `main`. (`v1-design-overhaul` was the integration branch until the V1
release landed on `main`; it is no longer used for new work.)

- Branch from the latest `main`: `git fetch origin && git switch -c
  feat/<short-name> origin/main` (use `fix/<short-name>` for a bug fix). One
  feature per branch.
- Commit the work there with the full checks passing: lint,
  `npx next typegen && npx tsc --noEmit`, unit, integration (disposable
  `TEST_DATABASE_URL`), build, the relevant e2e specs in production mode, and
  the stronger checks above where they apply.
- Push the branch and open a pull request into `main`
  (`gh pr create --base main`). Describe what changed and how it was tested.
- Merge only when the PR's CI and Quality gate are green, with a merge commit
  so the feature stays visible in history (`gh pr merge --merge`, never
  squash or rebase). When several PRs are open, merge one at a time and update
  or re-test the others against the new `main`.
- Delete a merged feature branch only when asked.
- When other sessions are working in parallel, use a separate worktree per
  branch (`git worktree add ../yuyu-<short-name> -b feat/<short-name>
  origin/main`) so branches don't switch under someone else's uncommitted work.

## Deployment-sensitive changes

- Production requires TLS-backed PostgreSQL, `rediss://`, private S3 storage,
  authenticated SMTP, stable build/runtime Server Action encryption keys, and
  matching HTTPS `AUTH_URL`/`NEXT_PUBLIC_BASE_URL` values. Multiple replicas
  need a shared `REDIS_URL` for live ticket check-in; without Redis the
  in-process fallback only reaches tickets on the same instance.
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
