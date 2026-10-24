# Testing and quality gates

[Documentation index](README.md)

## Test suites

### Unit tests

```bash
npm run test:unit
```

Fast Vitest tests cover validation and isolated domain/security behavior. Watch mode is available with `npm run test:unit:watch`.

Machine API coverage includes bearer parsing and hashing, credential state, strict DTOs, cursor validation, scope behavior, and forbidden-field regression checks.

Mobile API coverage includes token hashing, rotation and refresh-reuse revocation, version-stale session rejection, envelope/error mapping, DTO forbidden-field regressions, Google ID-token verification failures (local JWKS), the app-link association files, and `mobile-api-contract`, which validates `docs/mobile-api-fixtures/` against `docs/mobile-api.openapi.yaml` and the routes' Zod schemas and checks that the spec lists exactly the implemented routes. The `mobile-api` integration suite covers sign-in/refresh/reuse, sign-out everywhere, cross-tenant `NOT_FOUND`, a `CHECK_IN`-only collaborator (check-in published through `commitCheckInProjection`, no approval or email), own-RSVP cancellation, and ticket-token ownership.

Other security-relevant unit suites include `super-admin-page-guards` (fails if any `app/super-admin/**/page.tsx` omits `await requireSuperAdminMfa()`), the live-ticket suites (`ticket-check-in-events`, `ticket-check-in-publish`, `ticket-check-in-routes`, `ticket-check-in-watcher`, `use-ticket-check-in`), `account-data-export` and `account-organisations-actions`, `short-link-actions` and `short-link-resolve`, `broadcast-designs`, `event-publishing`, `safe-http-url`, and `image-validation`.

Team registration unit suites are `team-validators` (event team settings, series refusal, team names, registration intents, seeker limits), `team-units` (unit counting, oldest-unit promotion, leadership handover), `team-token` (token shape and SHA-256 storage), `team-dto` (join page and seeker list never expose member names, emails, answers, or tickets), `team-outbox` (the `team-created` and `team-member-added` kinds, dropped when the link was retired), and `guest-list-teams` (the Guests list "In a team" and "Solo" filters and team-name search).

Instance settings and operations are covered by `ops-alerts` (redaction, de-duplication, and rate caps), `instance-settings` (saved SMTP replaces the environment as a whole), `instance-config-secrets` (a named error for an unreadable secret after a key change), `auth-google-runtime` (Google SSO follows saved settings and fails safe), `instance-admin-actions` (fresh MFA gate, no plaintext secrets to Prisma, webhook settings), `super-admin-maintenance-actions` (failed-email requeue limited to the last 7 days, UI-safe errors, rate limits), and `production-check-script` (no SMTP or Google environment required, blank placeholders treated as unset).

### PostgreSQL integration tests

Use a separate, disposable database, never the development database
(`yuyu_dev`) and never production. The suites create and delete their own rows
and assume nothing else is writing to the database. With the development
Compose PostgreSQL:

```bash
docker compose up -d
docker compose exec postgres createdb -U yuyu yuyu_test
DATABASE_URL="postgresql://yuyu:yuyu_dev@localhost:5432/yuyu_test" npm run db:deploy
TEST_DATABASE_URL="postgresql://yuyu:yuyu_dev@localhost:5432/yuyu_test" npm run test:integration
```

The suite does not apply migrations itself, so re-run the `db:deploy` line after
pulling new migrations. `TEST_DATABASE_URL` is mandatory
(`vitest.integration.config.mts` refuses to start without it) and replaces
`DATABASE_URL` for every Prisma client in the run, so the suite cannot silently
inherit the application's database. Files run one at a time.

| Suite (`tests/integration/`) | Covers |
| --- | --- |
| `api-v1.db.test.ts` | Machine API: persisted credential hashes, cross-tenant event access, participant privacy, bounded collections |
| `auth-hardening.db.test.ts` | Single use of a TOTP across replicas, concurrent MFA enrollment, stale pending setup after revocation, and password recovery racing a password change |
| `check-in.db.test.ts` | One history entry for concurrent scans and undo; eligibility enforced in the conditional write |
| `feedback.db.test.ts` | Anonymous and certificate-linked feedback, waitlisted exclusion, and immutable answers after a field is removed |
| `invite-acceptance.db.test.ts` | Concurrent organisation invite and collaborator invite acceptance |
| `mfa-recovery.db.test.ts` | Concurrent recovery-code consumption |
| `mobile-api.db.test.ts` | Mobile sign-in, refresh and reuse, sign-out everywhere, cross-tenant `NOT_FOUND`, a `CHECK_IN`-only collaborator, own-RSVP cancellation, ticket-token ownership |
| `ops-alerts.db.test.ts` | Alert webhook settings (encrypted URL, audit without values, test message), `POST /api/client-errors` (same-origin, size cap, redaction, 10/min per IP), panel SMTP replacing the environment and **Send test email**, and outbox failure alerts with requeue |
| `publish-event.db.test.ts` | `publishEvent` releases an existing unreleased page, creates a released page when none exists, and leaves a member's attempt untouched |
| `rsvp-lifecycle.db.test.ts` | No registration for an unreleased website, final-slot races, mandatory approval when full, and per-occurrence capacity |
| `rsvpCapacity.db.test.ts` | No overselling, waitlist promotion, and promotion that respects a concurrent status change |
| `schema-invariants.db.test.ts` | Database CHECK constraints for event times and capacity, collaborator targets, feedback identity, and outbox states |
| `teams.db.test.ts` | Team registration: unchanged `INDIVIDUAL` events, `TEAM_REQUIRED`, case-insensitive team names, concurrent team creation for the last unit, concurrent joins against `teamMaxSize`, atomic whole-team approval (refused below `teamMinSize`), no joins into rejected teams, seeker acceptance freeing a unit and promoting the oldest waitlisted unit, cross-event and cross-organisation team ids, a management token used against another team, leadership handover on leader cancel, disband promotion, organiser move/remove/delete with undo, the team CHECK constraints and one-pending-request index, and the member-status-equals-team-status invariant after every mutation |
| `short-links.db.test.ts` | Owner/admin-only creation, cross-tenant rejection, idempotent and concurrent creation, regeneration, the unique index, and resolution for every non-published status |

### Coverage

```bash
npm run test:coverage
```

`vitest.coverage.config.mts` runs only service-independent unit tests while
measuring all `lib/**/*.ts` and `app/actions/**/*.ts` rather than a hand-selected
source subset. PostgreSQL tests must be run separately through
`npm run test:integration` with a disposable `TEST_DATABASE_URL`. The configured
minimum is a regression floor, not a statement that coverage is sufficient.

### Browser tests

Install Chromium once:

```bash
npx playwright install chromium
```

Then run either development or production mode:

```bash
npm run test:e2e
npm run build
npm run test:e2e:production
```

`npm run test:e2e` starts (or reuses) `npm run dev` on `127.0.0.1:3000`
(`PLAYWRIGHT_PORT` changes the port). Production mode prepares and starts
`.next/standalone/server.js`, including public and static assets.

Every spec seeds and removes its own fixtures directly through Prisma, so all
of them need a migrated, reachable PostgreSQL in `DATABASE_URL`: the same
database the server under test uses. Locally that is your development
database, so expect test rows there while a run is in progress. Point both at a
disposable database in CI.

| Spec (`tests/e2e/`) | Covers |
| --- | --- |
| `public-smoke.spec.ts` | Liveness, Auth.js polling limits, mobile navigation, login and crawler controls, confirmed tickets, waitlisted ticket rejection, feedback, and JPEG certificates |
| `auth.spec.ts` | Bad credentials and return paths, unverified accounts, CSRF on the credential callback, MFA sign-in, single-use reset links, and email verification |
| `event-visibility.spec.ts` | An unreleased website is absent from every anonymous surface (real 404s); release makes the page and programme reachable |
| `short-links.spec.ts` | Short-link 307 redirect, not-found for unknown and unpublished codes, and owner/member permissions in the dashboard |
| `api-v1.spec.ts` | Machine API credentials, tenant scoping, participant privacy, attendance scope, rotation, and revocation |
| `redesign-journeys.spec.ts` | A serial organiser and attendee story: create an organisation, the three-step Create Event dialog, all eight dashboard tabs, publishing from the Overview checklist and the released public page, registration and waitlist, the guest list, check-in, the account area, dark mode, the sidebar and phone drawer, and responsive widths. Each test allows 120 seconds for first-visit compilation on a cold dev server |
| `teams.spec.ts` | A serial team registration story ([Teams](TEAMS.md)): the organiser turns on team registration in Publishing, a leader creates a team through the public form (the management token is read from the queued `team-created` email), the team page shows the join link, a teammate joins through it, the join link 404s for hidden, draft, invite-only and unreleased events, a solo registrant pastes the join link on their ticket page (a management link is refused) and keeps their ticket in the team, and an organiser approves a team on an approval-required event so both members' tickets show it. `/team/:token` and the join page must send `Referrer-Policy: no-referrer`, a `noindex` robots tag, and a non-shareable `Cache-Control` (`no-store` under `test:e2e:production`; `next dev` always sends its own `no-cache`) |

## Static and dependency checks

```bash
npm run lint
npx tsc --noEmit
npm audit --audit-level=low
git diff --check
```

`npm audit` checks known advisories in the installed dependency graph. It does not detect application authorization bugs, unknown vulnerabilities, or infrastructure mistakes.

## Database and environment checks

```bash
npm run db:status
npm run db:verify
npm run production:check
```

- `db:status` confirms migration state.
- `db:verify` checks the core contract of required columns, constraints, and audit triggers against the running database. It does not check every recent migration's columns, so also run `db:status`.
- `production:check` validates required production settings and transport requirements.

## Build and container verification

```bash
npm run build
docker build \
  --secret id=NEXT_SERVER_ACTIONS_ENCRYPTION_KEY,env=NEXT_SERVER_ACTIONS_ENCRYPTION_KEY --build-arg NEXT_PUBLIC_BASE_URL="$NEXT_PUBLIC_BASE_URL" \
  -t yuyu:local .
```

Two GitHub workflows run on pull requests and pushes to `main`. The quality gate (`.github/workflows/quality.yml`) runs dependency, migration, schema, lint, type, unit, coverage, integration, production-check, build, standalone-container smoke, and production-mode browser checks using PostgreSQL and Redis services. `.github/workflows/ci.yml` runs `prisma validate`, lint, type, unit, build, and `npm audit --omit=dev --audit-level=high`, plus a `migration-integrity` job (`db:deploy` and `db:verify`). CI uses Node 20; the Docker image uses `node:22-alpine`.

## Release test priorities

For every release, prioritize tests around:

1. Authentication, MFA, password reset, and session revocation.
2. Cross-organisation authorization and role transitions.
3. Event privacy, invitations, registration counts, discovery visibility (`listedPublicly`), publishing (status and page release together), and short-link resolution.
4. Capacity races, duplicate RSVP prevention, approval, waitlist, and cancellation.
5. Ticket eligibility, online/offline check-in, undo, and the live ticket tear (with and without Redis, and behind the production reverse proxy).
6. Anonymous feedback and certificate-enabled feedback.
7. Upload rejection, object storage, outbox delivery, and retention.
8. Instance settings (panel SMTP, Google SSO, alert webhook) on every replica, and `node scripts/check-instance-secrets.mjs` against the production key.
