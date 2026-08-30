# Testing and quality gates

[Documentation index](README.md)

## Test suites

### Unit tests

```bash
npm run test:unit
```

Fast Vitest tests cover validation and isolated domain/security behavior. Watch mode is available with `npm run test:unit:watch`.

Machine API coverage includes bearer parsing and hashing, credential state, strict DTOs, cursor validation, scope behavior, and forbidden-field regression checks.

### PostgreSQL integration tests

```bash
docker compose up -d
TEST_DATABASE_URL="postgresql://yuyu:yuyu_dev@localhost:5432/yuyu_dev" npm run test:integration
```

These tests exercise real constraints, transactions, audit triggers, RSVP
capacity, and feedback persistence. `TEST_DATABASE_URL` is mandatory so the
suite cannot silently inherit the application's ambient `DATABASE_URL`. Keep
the named database disposable and never point it at production.

The machine API integration suite additionally exercises persisted credential hashes, cross-tenant event access, participant privacy, and bounded collections.

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

Production mode prepares and starts `.next/standalone/server.js`, including public and static assets. The suite checks liveness, Auth.js polling limits, mobile navigation, login/crawler controls, confirmed tickets, waitlisted ticket rejection, feedback, and JPEG certificates.

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
- `db:verify` checks required columns, constraints, and audit triggers against the running database.
- `production:check` validates required production settings and transport requirements.

## Build and container verification

```bash
npm run build
docker build \
  --build-arg NEXT_SERVER_ACTIONS_ENCRYPTION_KEY="$NEXT_SERVER_ACTIONS_ENCRYPTION_KEY" \
  -t yuyu:local .
```

The quality workflow runs dependency, migration, schema, lint, type, unit, integration, build, standalone-container smoke, and browser checks using PostgreSQL and Redis services.

## Release test priorities

For every release, prioritize tests around:

1. Authentication, MFA, password reset, and session revocation.
2. Cross-organisation authorization and role transitions.
3. Event privacy, invitations, registration counts, and discovery visibility.
4. Capacity races, duplicate RSVP prevention, approval, waitlist, and cancellation.
5. Ticket eligibility, online/offline check-in, and undo.
6. Anonymous feedback and certificate-enabled feedback.
7. Upload rejection, object storage, outbox delivery, and retention.
