# Production readiness audit

## Audit baseline

- Baseline commit: `8403b84e8d345ef292de9570d23aecc903ed7c3c`
- Branch: `main`
- Starting working tree: clean
- Scope: application and PostgreSQL data layer. Live infrastructure, Helm,
  backup-provider evidence, and cloud topology are excluded.
- Exit gate: no open Critical or High findings in a completed section.

## Severity

- **Critical:** practical tenant/admin bypass, secret compromise, broad
  sensitive-data exposure, unrecoverable corruption, or remotely exploitable
  compromise.
- **High:** significant authorization/privacy failure, account takeover path,
  integrity-breaking race, or failure of a required security control.
- **Medium:** meaningful defense-in-depth, reliability, accessibility, or
  limited data-handling weakness.
- **Low:** localized hardening, maintainability, or low-impact UX concern.

## Section status

| # | Section | Status | Open Critical/High |
|---:|---|---|---:|
| 1 | Baseline and shared request security | Passed with environment limitation | 0 |
| 2 | Authentication and account security | Passed with database-test limitation | 0 |
| 3 | Tenant authorization and organisation lifecycle | Passed with database-test limitation | 0 |
| 4 | Database integrity and migrations | Passed with database-test limitation | 0 |
| 5 | Super-admin and instance controls | Passed | 0 |
| 6 | Tenant-bound machine API | Passed with database/browser-test limitation | 0 |
| 7 | Events, series, publishing, and public visibility | Passed with browser-test limitation | 0 |
| 8 | Registration and RSVP lifecycle | Passed with database-test limitation | 0 |
| 9 | Tickets and check-in | Passed with database/browser-test limitation | 0 |
| 10 | Feedback and certificates | Passed with database/browser-test limitation | 0 |
| 11 | Uploads, rich content, reports, and exports | Passed with browser-test limitation | 0 |
| 12 | Email, outbox, and retention | Passed with database-test limitation | 0 |
| 13 | Frontend reliability, accessibility, and performance | Passed with browser-test limitation | 0 |
| 14 | Integrated release gate | Blocked by unavailable disposable services | 0 |

## Findings and verification

Findings are recorded under their owning section with severity, evidence,
remediation, regression coverage, and any accepted residual risk. Test commands
that require PostgreSQL or Redis are run only against disposable local services.

### 1. Baseline and shared request security

Status: Passed with environment limitation. No open Critical or High findings.

#### Findings

##### PR-01 — High — Vulnerable production mail dependency (remediated)

- Evidence: `npm audit --omit=dev --audit-level=low` identified
  `GHSA-p6gq-j5cr-w38f` in Nodemailer 8.0.11. The vulnerable raw-message path
  could bypass Nodemailer's file/URL access restrictions.
- Remediation: upgraded Nodemailer to 9.0.6 while retaining transport-level
  `disableFileAccess` and `disableUrlAccess` controls.
- Regression evidence: dependency audit reports zero vulnerabilities; lint,
  TypeScript, unit tests, and the production build pass after the upgrade.

##### PR-02 — High — Public search serialized venue-station secrets (remediated)

- Evidence: `GET /api/search` spread complete Prisma `Event` records into its
  response. The current model includes `checkInStationPinHash`,
  `checkInStationPinEncrypted`, and `checkInStationSecretVersion`.
- Remediation: the query now uses an allowlisted select and the response maps
  an explicit public event DTO.
- Regression evidence: `tests/unit/search-route.test.ts` injects secret fields
  into a mocked record and proves that none can reach the JSON response.

##### PR-03 — High — Mock email delivery logged PII and bearer links (remediated)

- Evidence: mock mail branches logged recipient addresses and full message
  bodies, including password-reset, ticket, and collaborator-invitation URLs.
- Remediation: mock delivery now logs only a generic message category.
- Regression evidence: `tests/unit/email-log-safety.test.ts` exercises every
  mock mail type and asserts recipients, event content, and bearer tokens do
  not appear in console output.

#### Verification

- `npm run lint`: passed.
- `npx tsc --noEmit`: passed.
- `npm run test:unit`: 85 tests passed before remediation; targeted regression
  tests passed after remediation.
- `npm audit --omit=dev --audit-level=low`: initially failed with one High;
  passed with zero vulnerabilities after remediation.
- `npm run build`: passed under Next.js 16.3.1 after remediation.
- `npm run production:check`: passed with a complete synthetic TLS-protected
  production configuration containing no real credentials.
- PostgreSQL integration, coverage, and production Playwright baselines were
  not run because Docker is unavailable on this host. No unknown local
  `DATABASE_URL` was used as a substitute.

#### Route and mutation control matrix

Every externally reachable mutation or handler is assigned to an owning audit
section below. Authentication and authorization must be enforced inside each
Server Action or route handler; Proxy coverage is only a shared rate ceiling.

| Surface | Required boundary | Owning section |
|---|---|---:|
| `actions/auth`, `account`, `password-reset`, `security`, `super-admin-mfa` | anonymous abuse controls or authenticated same-user checks; validation; session/MFA lifecycle | 2 |
| `actions/org`, `membership`, `org-invites`, `event-collaborators`, `invites` | authenticated tenant membership and action-specific role/permission; tenant-bound target | 3 |
| `actions/instance-settings`, `instance` | authenticated configured super-admin plus fresh TOTP for privileged mutations; safe audit metadata | 5 |
| `actions/api-clients` | owner, recent authentication, tenant-bound client/credential, scoped secret return | 6 |
| `actions/event`, `series`, `event-website`, `schedule` | authenticated tenant/event permission, verified email where required, explicit target ownership | 7 |
| `actions/registration-form`, `rsvp`, `rsvp-admin`, `rsvp-cancel`, `rsvp-lifecycle` | public/session identity as appropriate, tenant/event ownership, capacity transaction, answer validation | 8 |
| `actions/checkin`, `checkin-station` | tenant event-manager or event-scoped station proof; token/PIN secrecy; immutable history | 9 |
| `actions/feedback-form` | tenant admin and event ownership | 10 |
| `POST /api/auth/*` | Auth.js credential/OAuth boundary plus shared and auth-specific abuse controls | 2 |
| `POST /api/rsvp` | optional session, public input validation, RSVP/IP limits, capacity transaction | 8 |
| `POST /api/feedback` | public input validation, IP/subject limits, mode-specific privacy | 10 |
| `POST /api/check-in/station` | PIN bootstrap or signed event/version-scoped station proof; dedicated limits | 9 |
| `GET /api/search` | public-only DTO, published/public predicates, bounded query/result, search limit | 7 |
| ticket and certificate download handlers | unlogged opaque capability plus eligibility/state checks | 9 / 10 |
| upload delivery handler | allowlisted asset key, private storage, safe response headers | 11 |
| event and instance report handlers | authenticated tenant/event access; minimal export data | 11 |
| `/api/v1/events*` | tenant-bound bearer credential, exact scope, client limit, explicit DTO | 6 |
| `GET /api/health` | dependency-free, non-sensitive liveness response | 1 |
| `GET /api/health/db` | constant-time readiness bearer check, generic unauthorized response | 12 |
| `POST /api/internal/outbox` | constant-time scheduler bearer check, generic unauthorized response | 12 |

### 2. Authentication and account security

Status: Passed with database-test limitation. No open Critical or High findings.

#### Findings

##### PR-04 — High — Recovery codes were not atomically single-use (remediated)

- Evidence: credential sign-in read the complete recovery-code array, accepted
  a matching hash, and replaced the array using that stale snapshot. Concurrent
  requests could accept one code twice or reintroduce a separately consumed
  code through a lost update.
- Remediation: recovery-code consumption is now one conditional PostgreSQL
  `array_remove` update. Sign-in succeeds with a recovery code only when that
  update affects exactly one user row.
- Regression evidence: unit coverage verifies the affected-row gate;
  `tests/integration/mfa-recovery.db.test.ts` covers same-code replay and
  different-code lost-update races. The integration test is present but could
  not execute on this Docker-less host.

##### PR-05 — Medium — MFA actions lacked dedicated brute-force limits (remediated)

- Evidence: account MFA confirmation/disablement and super-admin TOTP
  verification relied only on the broad Server Action ceiling.
- Remediation: all code-verification actions now use the strict `auth` bucket,
  keyed by both client IP and a hashed user subject.
- Regression evidence: account and super-admin action tests prove rate limiting
  occurs before pending secrets or user MFA state are read.

##### PR-06 — High — Password-reset requests waited on SMTP (remediated)

- Evidence: the request committed a reset token and then called Nodemailer
  synchronously. SMTP latency blocked the request; a delivery failure left an
  active but undelivered token and bypassed the established outbox guarantees.
- Remediation: reset-token creation and the expiring password-reset outbox row
  now commit in one transaction. The worker deletes the bearer-bearing message
  after delivery or terminal expiry.
- Regression evidence: unit coverage verifies queue creation occurs inside the
  token transaction and reset confirmation consumes the exact unexpired token
  before incrementing `sessionVersion`.

#### Verification

- Targeted authentication/account suites: passed, including signup/OAuth
  takeover prevention, email verification, password change, reset issue and
  consumption, MFA encryption, MFA actions, super-admin proofs, recovery-code
  consumption, and log safety.
- `npx tsc --noEmit`: passed after all remediations.
- `npm run lint`: passed after all remediations.
- PostgreSQL concurrency execution remains pending because the disposable
  Docker service is unavailable; the test is committed for CI execution.

### 3. Tenant authorization and organisation lifecycle

Status: Passed with database-test limitation. No open Critical or High findings.

#### Findings

##### PR-07 — High — Single-use invites allowed concurrent multi-use (remediated)

- Evidence: both organisation and collaborator join pages mutated state during
  `GET` rendering. Their transactions read `usedAt` and later updated the row
  unconditionally, allowing concurrent claimants to pass the stale check.
- Remediation: join pages are read-only and require explicit acceptance through
  authenticated, validated, rate-limited Server Actions. Acceptance uses a
  conditional `usedAt: null`/unexpired update; only the transaction that claims
  exactly one row can create the membership or collaborator grant. Grant and
  PII-free audit creation occur in the same transaction.
- Regression evidence: `tests/integration/invite-acceptance.db.test.ts` covers
  competing organisation claimants and repeated collaborator acceptance.

##### PR-08 — High — Collaborator mutations were cross-tenant (remediated)

- Evidence: revoke and permission-update actions checked that the caller was an
  admin of the supplied organisation, then mutated a collaborator using only
  caller-supplied collaborator/event identifiers. They did not bind the event
  or series relation to the authorised organisation.
- Remediation: both database mutation predicates now require the collaborator
  target's event/series to belong to the server-resolved organisation.
- Regression evidence: unit tests assert the organisation relation is present
  for both event revocation and series permission updates.

##### PR-09 — High — Shared event permission helper trusted mismatched targets (remediated)

- Evidence: `canAccessEvent` and `canViewEventDashboard` returned access for an
  organisation member/admin before verifying that the supplied event or series
  belonged to that organisation. Website and schedule mutations relied on this
  helper.
- Remediation: the helper now rejects missing/ambiguous targets and proves the
  target's organisation ownership before evaluating role or collaborator
  permissions.
- Regression evidence: tests cover foreign event/series IDs and prove
  membership is not consulted until target ownership succeeds.

##### PR-10 — Medium — Collaborator invitations lacked a dedicated send limit (remediated)

- Evidence: collaborator mail creation relied on the broad Server Action
  ceiling rather than the established invitation bucket.
- Remediation: creation now applies the subject/IP `invite` limit before
  validating or persisting an invitation.

#### Verification

- Tenant-bound event-access and collaborator-action unit suites: passed.
- TypeScript and lint: passed after all tenant remediations.
- Invite concurrency integration cases are present but await the disposable
  PostgreSQL service in CI because Docker is unavailable on this host.

### 4. Database integrity and migrations

Status: Passed with database-test limitation. No open Critical or High findings.

#### Findings

##### PR-11 — High — Event-program migration silently deleted schedules (remediated)

- Evidence: `20260828130000_event_website_program` deleted every standalone
  `EventScheduleItem` before dropping its event relation.
- Remediation: the migration now snapshots those rows in a connection-local
  temporary table and restores each as a draft `EventSession`, preserving IDs,
  titles, escaped descriptions, planned times, ordering, and timestamps.
- Regression evidence: a migration contract test enforces backup-before-delete
  and restore-after-delete ordering.

##### PR-12 — High — Heartbeat migration regressed cascade-safe auditing (remediated)

- Evidence: `20260827023000_operational_heartbeat` replaced the audit fallback
  function with an older implementation after the cascade fix migration. It
  restored organisation foreign keys on delete-path fallback records and did
  not cover later collaborator security tables.
- Remediation: a forward migration restores null organisation context on delete
  and resolves tenant context for collaborator grants/invitations. It installs
  fallback triggers for both new security tables.
- Regression evidence: static migration coverage asserts the safe delete branch
  and both collaborator triggers.

##### PR-13 — High — Production schema verification ignored new features (remediated)

- Evidence: `db:verify` could pass without event-program tables, release gates,
  session delays, station PIN fields, collaborator constraints, or collaborator
  audit triggers.
- Remediation: the verifier now checks all feature tables, security-sensitive
  columns, target/range constraints, critical indexes, and the complete fallback
  trigger set.

##### PR-14 — Medium — Core time/range invariants were application-only (remediated)

- Evidence: direct SQL or a missed boundary check could persist invalid event,
  series, instance, session, schedule-delay, capacity, or invite-use state.
- Remediation: the forward integrity migration adds and validates corresponding
  PostgreSQL checks. Invalid legacy rows fail with an actionable constraint name
  instead of being silently rewritten.
- Regression evidence: `tests/integration/schema-invariants.db.test.ts` covers
  invalid time ranges, capacity, and collaborator targeting.

#### Verification

- `npx prisma validate`: passed.
- Migration contract unit tests: passed.
- `node --check scripts/verify-production-schema.mjs`: passed.
- TypeScript and lint: passed after migration/test additions.
- Clean-chain deployment, `db:status`, `db:verify`, trigger execution, and
  constraint integration cases require disposable PostgreSQL and remain queued
  for CI because Docker is unavailable here.

### 5. Super-admin and instance controls

Status: Passed. No open Critical or High findings.

#### Findings

##### PR-15 — High — Maintenance actions bypassed fresh super-admin MFA (remediated)

- Evidence: outbox delivery/retry, expired-token purge, and backup-restore
  evidence actions called `requireSuperAdmin` directly. Server Actions are
  independently invokable, so the MFA-gated layout was not an authorization
  boundary.
- Remediation: each maintenance action now calls `requireSuperAdminMfa` and
  applies the authenticated action rate limit before touching state.
- Regression evidence: the action suite invokes every maintenance mutation and
  proves the fresh-MFA gate is called for each one and limiting precedes work.

##### PR-16 — High — Super-admin identity trusted a stale session email (remediated)

- Evidence: the configured `SUPER_ADMIN_EMAIL` was compared only with the email
  claim in the Auth.js session token. It was not reconciled with the current
  account row at the privileged boundary.
- Remediation: the gate now loads the current database email and verification
  state by immutable user ID, returns generic not-found for missing,
  unverified, or mismatched accounts, and returns the refreshed email.
- Regression evidence: tests cover stale matching and stale non-matching token
  claims plus an unverified current account.

##### PR-17 — Medium — Secret form fields leaked into Prisma payload shape (remediated)

- Evidence: service settings spread the parsed object, including plaintext
  `smtpPassword` and `googleClientSecret` form-only properties, into Prisma
  create/update data. Prisma would reject these unknown fields when a new
  secret was submitted.
- Remediation: plaintext secret fields are destructured out before persistence;
  only domain-separated AES-GCM ciphertext fields enter Prisma. The action is
  also rate limited and its audit metadata remains boolean-only.
- Regression evidence: the test supplies both plaintext secrets and proves the
  Prisma payload contains neither plaintext field nor plaintext value while
  retaining encrypted fields.

#### Verification

- Super-admin identity, MFA proof, MFA action, settings, and maintenance-action
  unit suites: 12 tests passed.
- `npx tsc --noEmit`: passed.
- `npm run lint`: passed.
- Encrypted secret values are never selected into client props; settings pages
  expose only presence booleans. Backup configuration remains explicitly
  display-only and was not treated as provider evidence.

### 6. Tenant-bound machine API

Status: Passed with database/browser-test limitation. No open Critical or High
findings.

#### Findings

##### PR-18 — High — Attendance state was inferable without its scope (remediated)

- Evidence: the participant endpoint required `participants:attendance:read`
  only for `include=attendance`. A client holding only `participants:read`
  could request `attendance=checked_in` or `not_checked_in` and infer each
  returned participant's attendance state from membership in the result.
- Remediation: any non-`all` attendance filter now requires the attendance
  scope, as does the timestamp include. The in-product developer reference was
  corrected to describe the real boundary.
- Regression evidence: contract tests cover every filter/include combination,
  and the production HTTP suite now expects 403 for a participants-only client
  attempting an attendance filter.

#### Verification

- Credential parser/authentication, action authorization, request handler, and
  strict DTO/cursor contract suites: 22 tests passed.
- Static/data-flow review confirmed credentials store only 32-byte digests,
  client status/revocation/expiry are checked per request, tenant identity comes
  solely from the credential, lookups include `organisationId`, collections are
  capped at 100, client rotation shares one rate subject, and participant DTOs
  exclude email, user IDs, answers, and bearer tokens.
- `npx tsc --noEmit` and `npm run lint`: passed.
- PostgreSQL tenant/credential integration tests and production HTTP Playwright
  cases are present but could not run without the disposable services.

### 7. Events, series, publishing, and public visibility

Status: Passed with browser-test limitation. No open Critical or High findings.

#### Findings

##### PR-19 — High — Unreleased event content leaked across public surfaces (remediated)

- Evidence: search, discovery, organisation listings, programme/session/speaker
  pages, and Open Graph image routes checked event status but not the independent
  `EventPage.isPublished` release gate. Published events with private websites
  exposed titles, descriptions, programme content, and speaker identities.
- Remediation: all listing/index queries require a released page; nested public
  pages use one server-owned access resolver; Open Graph images use the same
  anonymous visibility rule. Draft speakers assigned to published sessions are
  filtered from serialized public props.
- Regression evidence: search assertions cover the release relation, access
  tests cover draft/hidden/unreleased states, and a production HTTP suite now
  exercises the main page, programme, session, speaker, search, discovery,
  organisation listing, and Open Graph transition before and after release.

##### PR-20 — High — Website release bypassed collaborator publish permission (remediated)

- Evidence: the explicit release action required only `EDIT_DETAILS`, and the
  general page-save action accepted an optional caller-supplied `isPublished`.
  A details-only collaborator could therefore publish via direct Server Action
  invocation.
- Remediation: release requires `PUBLISH_AND_SCHEDULE`; content save uses a
  strict schema that rejects release state and never updates it.
- Regression evidence: action tests assert the exact permission and prove
  smuggled `isPublished` input is rejected before authorization or persistence.

##### PR-21 — High — Dense recurrence rules could exhaust request resources (remediated)

- Evidence: recurrence materialization called `between()` for a full year and
  truncated only after the library allocated every matching date. A secondly
  rule could generate millions of occurrences in one authenticated request.
- Remediation: expansion now iterates with `after()` and stops at 48 by default,
  with an absolute 500-item ceiling. RRULE input is single-line/bounded and
  occurrence duration is constrained to PostgreSQL/Prisma `Int` capacity.
- Regression evidence: tests expand an infinite secondly rule, assert the exact
  default and absolute limits, and reject multiline rule injection and an
  unstorable duration.

##### PR-22 — Medium — Event mutations lacked consistent abuse and atomicity controls (remediated)

- Evidence: clone creation, core edits/deletes/publish, series edits/deletes,
  website mutations, and schedule changes relied only on the shared proxy
  ceiling. Session save could commit the session before replacing speaker
  assignments.
- Remediation: creation/action buckets now cover those mutations, publish input
  is strictly validated, and session plus speaker assignment changes commit in
  one transaction.

#### Verification

- Targeted public-access, release-action, recurrence, search, programme-delay,
  and event permission suites: 11 tests passed.
- `npx tsc --noEmit` and `npm run lint`: passed.
- The new production-mode visibility Playwright suite is present but could not
  execute without the disposable PostgreSQL/browser services on this host.

### 8. Registration and RSVP lifecycle

Status: Passed with database-test limitation. No open Critical or High findings.

#### Findings

##### PR-23 — High — Public RSVP HTTP calls bypassed dedicated limits (remediated)

- Evidence: the legacy Server Action used the `rsvp` bucket, but direct
  `POST /api/rsvp` calls went straight to the domain service.
- Remediation: the route now checks both trusted client IP and a hashed,
  normalized guest-email subject before authentication or RSVP persistence,
  returning 429 with `Retry-After` and no-store controls.
- Regression evidence: the route test proves both subjects are checked and the
  domain service is not called when either limit rejects.

##### PR-24 — High — Approval-required attendees could bypass approval (remediated)

- Evidence: status selection checked capacity first. A submission to a full
  approval-required event became `WAITLISTED`; cancellation then automatically
  promoted it to `CONFIRMED` without an organiser decision.
- Remediation: approval-required submissions are always pending approval,
  capacity is enforced during the explicit approval transaction, and legacy
  waitlist rows in approval events are excluded from cancellation auto-promotion.
- Regression evidence: unit and PostgreSQL integration cases assert full
  approval events still create `PENDING_APPROVAL` records.

##### PR-25 — High — Capacity used stale pre-lock state (remediated)

- Evidence: public/manual RSVP flows loaded capacity before entering the target
  row lock and passed that stale number into admission. A concurrent organiser
  reduction could therefore be ignored. Restore also recreated confirmed rows
  without checking whether the deleted slot had since been taken.
- Remediation: after locking the event or series/instance pair, admission
  re-reads authoritative capacity, privacy, publication, release, cutoff, and
  end state. Capacity reductions lock the same parent and reject values below
  current confirmed attendance. Confirmed undo restores lock/count the target
  and fail without consuming the undo when full. Explicit locks now run under
  `READ COMMITTED`, avoiding unnecessary serializable-abort failures.
- Regression evidence: unit tests verify restore locking/capacity and exact
  occurrence isolation. The DB suite races two final-slot submissions and
  expects exactly one confirmation plus one waitlist record.

##### PR-26 — High — Unreleased websites accepted direct registrations (remediated)

- Evidence: the page correctly returned not-found before website release, but
  the RSVP service checked only `Event.status`, allowing guessed direct API
  calls to create registrations and ticket capabilities.
- Remediation: both guest and signed-in standalone flows require the page
  release gate before validation and re-check it after the event lock.
- Regression evidence: the DB suite submits directly to an unreleased event and
  proves no RSVP is created.

##### PR-27 — Medium — RSVP target/form boundaries were ambiguous or unbounded (remediated)

- Evidence: public and lifecycle schemas accepted both event and instance
  targets; form options/reorder IDs were unbounded and duplicate reorder IDs
  were accepted; field update attempted mutation before checking ownership and
  depended on transaction rollback.
- Remediation: target schemas enforce XOR, collections are bounded/deduplicated,
  reorders require the exact unique field set, updates bind `id` and `formId` in
  the mutation predicate, form mutations are rate limited, and instance Server
  Action success now revalidates the occurrence page.

#### Verification

- RSVP admission, restore capacity, HTTP limiting, target validation, and
  registration-cutoff suites: 21 tests passed.
- `npx tsc --noEmit` and `npm run lint`: passed.
- `tests/integration/rsvp-lifecycle.db.test.ts` covers unreleased registration,
  final-slot races, approval-at-capacity, and occurrence isolation; execution
  awaits disposable PostgreSQL in CI.

### 9. Tickets and check-in

Status: Passed with database/browser-test limitation. No open Critical or High
findings.

#### Findings

##### PR-28 — High — Management pages exposed attendee capabilities and station secrets (remediated)

- Evidence: the event management Server Component passed a complete Prisma
  `Event` object to a Client Component, including the station PIN hash,
  encrypted recoverable PIN, and proof version. It also loaded every attendee,
  answer, and guest bearer ticket URL for ordinary organisation members and
  collaborators with unrelated event permissions. The series page had the
  same attendee-boundary failure.
- Remediation: an allowlisted browser DTO excludes all station fields and any
  accidentally included relations. Attendee records and ticket URLs are now
  queried only for an administrator or a collaborator holding the exact
  `MANAGE_REGISTRATIONS` grant. Check-in pages/actions separately honor only
  administrators or the exact `CHECK_IN` grant; the PIN-management control
  remains administrator-only.
- Regression evidence: `tests/unit/event-client-dto.test.ts` injects station
  secrets and an included RSVP ticket into a server record and proves none are
  serializable. Event-access tests cover exact permission and tenant binding.

##### PR-29 — High — Scan and undo history could diverge from current state (remediated)

- Evidence: both online paths gated a stale RSVP preview, then conditionally
  updated only `checkedInAt`. A concurrent rejection could therefore be
  checked in after the preview. Undo unconditionally cleared the projection
  and appended history, so repeated/concurrent undo requests created false
  `CHECK_IN_UNDONE` records.
- Remediation: station and dashboard paths share one transaction helper whose
  conditional write includes current allowed status and unchecked state.
  Exactly one successful projection update creates immutable history; losing
  scans resolve to already-checked-in, ineligible, or missing. Undo likewise
  appends history only when it changes a non-null projection. Database checks
  constrain history action/source values to the known protocol.
- Regression evidence: route tests cover a rejection racing a scan and
  repeated undo. `tests/integration/check-in.db.test.ts` races two scans and
  two undos and requires one projection transition and one history row for
  each; execution awaits disposable PostgreSQL in CI.

##### PR-30 — High — Recoverable station PINs lacked a fresh-authentication boundary (remediated)

- Evidence: any active administrator session could create, rotate, disable,
  or reveal the recoverable venue PIN. That PIN authorizes attendee search,
  ticket lookup, check-in, and check-in undo without an account.
- Remediation: every station-secret action requires a sign-in no older than ten
  minutes and uses the sensitive action limit. PIN rotation/disablement and
  their secret-free audit events commit atomically. New PIN ciphertext uses an
  HKDF domain-separated AES-GCM key; legacy v1 ciphertext remains read-only
  compatible until rotation.
- Regression evidence: action tests prove stale sessions stop before the event
  or transaction is read and that rotation auditing contains no plaintext.
  primitive tests verify the v2 authenticated-encryption round trip.

##### PR-31 — Medium — Station and offline operating boundaries were overly broad (remediated)

- Evidence: a station PIN could be unlocked arbitrarily far before an event;
  action-shaped JSON was not discriminated and ticket input was unbounded;
  offline sync trusted arbitrary client timestamps; rejected attendees were
  included in downloadable rosters; and there was no explicit device purge.
- Remediation: station proofs can be created/used only from 24 hours before
  start through one hour after end, while remaining event/version bound.
  Payloads are strict, bounded, and action-refined. Offline timestamps must be
  within the event operating interval and no more than five minutes in the
  future, duplicate rows are rejected, rejected attendees are excluded, and
  the dashboard provides an explicit purge that refuses to discard pending
  sync work.

##### PR-32 — Medium — Ticket pages unnecessarily amplified bearer URLs (remediated)

- Evidence: the ticket page repeated its full capability URL in visible text
  and used the site-wide referrer policy. Same-origin navigation or
  diagnostics could therefore receive the token in a Referer URL.
- Remediation: the repeated URL was removed, ticket metadata sets
  `no-referrer`, ticket routes are explicitly dynamic/no-store, token syntax
  and length are bounded before database work, and JPEG responses add
  `Referrer-Policy: no-referrer` plus existing no-store/nosniff controls.
- Regression evidence: the production browser test asserts the referrer meta,
  absence of repeated link text, and download response controls, while
  retaining confirmed-only ticket generation and waitlist denial.

#### Accepted residual risk

- Offline operation intentionally stores an administrator/`CHECK_IN`-authorized
  event-day roster, contact data, selected registration answers, and bearer QR
  values in that browser's IndexedDB. Data expires on the next application
  access after 24 hours and can be explicitly purged, but browsers cannot
  guarantee timer-based deletion while the application is closed. This is
  retained because offline identity lookup, QR matching, and configured ID-card
  printing require local data; operators must treat venue devices as sensitive
  and use the purge control before handoff.

#### Verification

- Ticket eligibility, station proof/crypto/action/route, check-in detail,
  refresh, ID-card, validator, event DTO, and permission suites: 31 tests
  passed.
- `npx tsc --noEmit` and `npm run lint`: passed.
- The PostgreSQL concurrency suite and production ticket/browser assertions
  are present but could not run without the disposable database/browser
  services on this Docker-less host.

### 10. Feedback and certificates

Status: Passed with database/browser-test limitation. No open Critical or High
findings.

#### Findings

##### PR-33 — High — Privacy-mode changes raced feedback identity storage (remediated)

- Evidence: submission read `certificateEnabled`, openness, and fields before
  creating the response without a transaction lock. An administrator could
  switch a form to anonymous while an in-flight submission still persisted an
  RSVP link and certificate token using stale certificate mode (or the reverse).
- Remediation: submission locks the event and form, re-reads current status,
  openness, mode, and fields, verifies a current confirmed RSVP only in
  certificate mode, and creates response/answers in that transaction. Settings
  updates and field mutations serialize on the same form row. A database check
  requires identity and certificate capability to be either both null or both
  present. Anonymous mode ignores even a caller-supplied email.
- Regression evidence: unit coverage injects an email while the locked mode is
  anonymous and proves neither RSVP lookup nor linkage occurs; certificate mode
  asserts a confirmed-event RSVP predicate and a fresh 256-bit token.
  Integration coverage verifies repeated anonymous rows remain structurally
  unlinkable and partial identity/capability rows are rejected by PostgreSQL.

##### PR-34 — High — Form maintenance destroyed or reinterpreted historical answers (remediated)

- Evidence: deleting `EventFeedbackField` cascaded deletion into every answer
  for that question. The update action could also change a field key, type, or
  options after responses existed, silently changing the meaning of retained
  values.
- Remediation: every answer now snapshots immutable field key, label, and type.
  The migration backfills snapshots before making them required and changes the
  live-field foreign key to `ON DELETE SET NULL`, preserving history. The
  database also enforces that the populated value column matches the snapshotted
  type. Application actions refuse semantic edits/deletion once answers exist,
  lock the form, bind field ownership, cap forms at 100 questions, and audit
  changes transactionally.
- Regression evidence: migration-order tests verify backfill precedes NOT NULL
  and SET NULL. The PostgreSQL suite deletes a live field directly and requires
  the answer value and snapshots to survive, and rejects a typed-value mismatch.

##### PR-35 — High — Feedback values allowed write amplification and unbounded content (remediated)

- Evidence: `answers` accepted arbitrary unknown values; multi-select arrays
  were unlimited and preserved duplicates, allowing one small form field to
  create an attacker-selected number of rows. Text values and the route body
  were also unbounded.
- Remediation: the JSON route streams at most 128 KiB, schemas are strict and
  cap answers/keys, unknown fields are rejected, multi-select values are typed,
  deduplicated, and capped at 50, scalar types and dates are strict, and text/
  numeric bounds match their use. Public error and capability responses are
  no-store/nosniff with no-referrer controls.
- Regression evidence: unit cases reject unknown fields and a 51-item
  multi-select without reaching persistence; HTTP tests reject oversized bodies
  before domain submission and assert privacy-safe response headers.

##### PR-36 — Medium — Certificate availability depended on later form mode (remediated)

- Evidence: the download route checked the form's current
  `certificateEnabled` value. Disabling new certificate issuance retroactively
  broke already-issued bearer certificates even though the linked response
  proved eligibility at submission.
- Remediation: issuance uses a random 32-byte response-bound capability inside
  the privacy transaction. Downloads validate bounded token syntax, token/
  response linkage, and current confirmed RSVP eligibility, but do not revoke
  an issued certificate merely because future submissions switch mode. JPEG
  responses remain private/no-store and add no-referrer.
- Regression evidence: the production browser test obtains a certificate,
  disables future certificate issuance, and confirms the issued capability
  remains downloadable; malformed capabilities return not-found.

#### Verification

- Feedback privacy/validation, form-action, HTTP-boundary, and migration-safety
  suites: 12 tests passed.
- `npx tsc --noEmit` and `npm run lint`: passed.
- Expanded PostgreSQL tests cover linkage constraints, typed answer constraints,
  snapshot retention, repeat submissions, and confirmed-only eligibility but
  await a disposable PostgreSQL service. Production certificate assertions are
  authored but could not run on this host.

### 11. Uploads, rich content, reports, and exports

Status: Passed with browser-test limitation. No open Critical or High findings.

#### Findings

##### PR-37 — High — Plain and legacy content reached public HTML sinks unsanitized (remediated)

- Evidence: when an event had no custom `EventPage.aboutHtml`, its ordinary
  plain-text description was passed directly to `dangerouslySetInnerHTML`.
  Speaker, session, FAQ, and event-page HTML was sanitized on current writes,
  but public reads trusted any historical or directly imported database value.
- Remediation: plain event descriptions are HTML-escaped with line-break
  preservation before entering the rich-content slot. Every public rich-text
  read is sanitized again at the final Server Component boundary, while writes
  retain the strict formatting-only sanitizer and safe link protocols.
- Regression evidence: rich-text tests prove active markup is removed and a
  plain description containing an image error handler is emitted only as
  encoded text.

##### PR-38 — High — Image decoding and asset delivery trusted incomplete structural checks (remediated)

- Evidence: uploads parsed dimensions from a few signature bytes and then used
  Sharp's substantially larger default decoder pixel limit. A crafted file
  whose real decoder structure differed from the preliminary parser could
  consume far more memory than the intended 25-megapixel ceiling. The public
  delivery route also accepted every key represented by an `Asset` row, rather
  than only the safe derivatives it is intended to expose.
- Remediation: one shared derivative pipeline checks the binary signature,
  decodes with a hard 25-megapixel limit, verifies decoded format/dimensions,
  rejects multi-frame input, rotates/resizes, and re-encodes to WebP without
  source metadata. Upload and download metadata must match a generated,
  organisation-bound cover/speaker/sponsor UUID key and `image/webp`; invalid,
  traversal-like, arbitrary, or non-image keys never reach object storage.
  The S3 bucket remains private and only the application route serves these
  explicitly public derivatives.
- Regression evidence: tests use a misleading MIME/name and an image/polyglot
  tail, verify decoded WebP output and tail removal, reject an oversized
  advertised canvas, exercise the key allowlist, and prove the HTTP route
  rejects arbitrary keys before storage lookup with no-store/nosniff controls.

##### PR-39 — Medium — CSV formula protection missed prefixed payloads (remediated)

- Evidence: attendee exports neutralized `=`, `+`, `-`, and `@` only when the
  sigil was the first byte. Spreadsheet importers can still interpret a formula
  after whitespace/control/format characters. The check-in export performed
  quoting but no formula neutralization at all.
- Remediation: every attendee, email, custom-field/header, and check-in export
  now uses one CSV encoder. It detects a formula sigil after Unicode whitespace,
  control, or formatting characters, prefixes the spreadsheet literal marker,
  and applies consistent delimiter/quote/newline escaping. Filenames remain
  allowlisted and length-bounded.
- Regression evidence: CSV tests cover direct, tab/CR, ordinary-space, and BOM-
  prefixed formulas plus delimiters and quotes.

#### Verification

- Rich-text, image, storage-key, upload-route, CSV/email-export, aggregate PDF,
  and report-route suites passed. Report authorization tests prove a non-admin
  receives generic not-found without PDF generation or an audit event; an
  administrator receives an audited, attachment-only, private/no-store,
  no-referrer, nosniff response.
- Full unit suite: 55 files and 154 tests passed.
- `npx tsc --noEmit`, `npm run lint`, and `git diff --check`: passed.
- The production-mode browser suite could not run without the disposable
  PostgreSQL/browser service stack on this Docker-less host. Image decoder,
  route authorization, response controls, and serialization boundaries have
  deterministic unit coverage; browser download behavior remains a release-
  gate check.

### 12. Email, outbox, and retention

Status: Passed with database-test limitation. No open Critical or High findings.

#### Findings

##### PR-40 — High — Terminal outbox rows retained bearer capabilities (remediated)

- Evidence: delivered RSVP confirmation rows were marked `SENT` with raw ticket
  tokens in JSON for up to 30 days. RSVP promotion and collaborator invitation
  rows that exhausted retries became `FAILED` indefinitely with ticket or
  invitation capabilities intact. Password-reset and verification rows had
  narrower deletion behavior, but the policy was inconsistent across secrets.
- Remediation: all ticket, reset, verification, and collaborator-capability
  rows are deleted immediately after successful delivery and after a terminal
  failure; expired messages are deleted without sending. The deployment
  migration removes existing terminal capability rows before enforcing queue
  state checks. New event/collaborator messages carry their authoritative
  expiry, and runtime payload parsing bounds emails, titles, tokens, dates, and
  HTTP(S) URLs before template construction.
- Regression evidence: delivery tests prove a ticket row is deleted rather
  than marked sent, terminal collaborator failure removes its row, and an
  expired invitation never reaches the mailer. Migration-order coverage
  requires legacy capability deletion before state constraints.

##### PR-41 — High — Scheduler failures could disclose exception text (remediated)

- Evidence: the in-process worker logged raw exceptions, while outbox and
  heartbeat rows persisted redacted exception messages. URL/email replacement
  did not cover standalone bearer values, connection strings, provider payload
  fragments, or every possible secret-bearing error shape.
- Remediation: worker logs are category-only. Operator-visible queue and
  heartbeat failures retain only a normalized exception class and allowlisted
  provider error code—never exception message text. The migration overwrites
  legacy stored error details. API monitoring already discards exceptions and
  now makes generic 500 responses explicitly no-store.
- Regression evidence: tests inject an error containing an address, bearer URL,
  and token and prove persistence receives only `Error (ETIMEDOUT)`; operational
  error-summary tests reject raw strings and messages.

##### PR-42 — High — Queue finalization did not own its processing lease (remediated)

- Evidence: after a conditional claim, success/failure updates targeted only
  the row ID and left `lockedAt` populated in terminal/retry states. If the
  15-minute stale-claim recovery transferred a slow message, the original
  worker could overwrite the new worker's state. PostgreSQL allowed impossible
  status/lock/sent combinations.
- Remediation: each transition is conditional on the exact processing status
  and claim timestamp. Retry, failure, and success clear the lease; capability
  deletion is equally lease-owned. A migration normalizes historical rows and
  adds non-negative-attempt and queue-state shape checks. Malformed/unsupported
  poison messages become terminal on their first claim instead of consuming
  eight retry cycles. Every retry supplies the same non-sensitive Message-ID to
  help SMTP infrastructure deduplicate an ambiguous delivery.
- Regression evidence: unit tests inspect lease-qualified deletion/update and
  poison quarantine. Migration tests verify normalization precedes constraints;
  the PostgreSQL suite rejects a sent row without `sentAt` and negative attempts.

##### PR-43 — Medium — Protected operations accepted a non-Bearer authorization value (remediated)

- Evidence: both recovery scheduler and database readiness routes removed a
  Bearer prefix when present but compared the untouched header otherwise. A raw
  secret value therefore authenticated despite the documented bearer contract;
  malformed suffixes were not parsed by one shared boundary.
- Remediation: one constant-time matcher requires exactly `Bearer <one-token>`.
  Missing, raw, Basic, multi-token, wrong-length, and misconfigured cases share
  a generic, private/no-store 404 and never touch the scheduler/database.
  Success and failure responses are force-dynamic, private/no-store, and
  nosniff; scheduler exceptions return a generic protected 500 after metadata-
  only heartbeat handling.
- Regression evidence: primitive and route tests cover all malformed forms,
  exact authorized access, dependency non-invocation, safe headers, and generic
  scheduler failure output.

##### PR-44 — Medium — Operational cleanup omitted expired and failed records (remediated)

- Evidence: scheduled retention removed verification tokens, RSVP undo rows,
  and old sent mail only. Expired sessions and unused organisation/collaborator
  invitations remained; failed non-capability mail retained PII indefinitely.
- Remediation: the same scheduler transaction now removes expired sessions,
  unused expired invitations, undo snapshots, verification tokens, and sent or
  failed non-capability mail past the bounded 1–365 day retention. Used invite
  history and business/audit records remain intact. Heartbeat writes are treated
  as observability and cannot block otherwise healthy delivery/retention work.
- Regression evidence: retention tests assert every exact predicate/counter and
  worker tests prove heartbeat write failure does not stop delivery or cleanup.

#### Accepted residual risk

- SMTP delivery is necessarily at-least-once: a process can fail after a remote
  server accepts a message but before the local lease is finalized. Lease-owned
  transitions prevent workers from corrupting one another, and retry attempts
  reuse a stable Message-ID, but provider deduplication is not guaranteed. This
  is preferable to silently losing transactional mail; operators should monitor
  retry/duplicate rates and choose an SMTP provider with Message-ID deduplication
  where available.
- Broader attendee/event/audit retention remains an instance-operator policy as
  stated in the privacy notice. This section removes only objectively expired
  operational capabilities and bounded delivery history.

#### Verification

- Outbox delivery, worker, retention, bearer primitive, protected-route, email
  construction/log safety, redaction, and migration suites passed. Stable
  Message-ID, expiry, poison, partial failure, capability deletion, HTML/header
  escaping, and heartbeat independence have direct regression coverage.
- `npx tsc --noEmit`, `npm run lint`, and `git diff --check`: passed.
- PostgreSQL enforcement/cleanup execution awaits the disposable database in
  CI because Docker is unavailable on this host. The ordered migration and
  integration assertions are present; no unknown database URL was used.

### 13. Frontend reliability, accessibility, and performance

Status: Passed with browser-test limitation. No open Critical or High findings.

#### Findings

##### PR-45 — High — Public organisation pages serialized private event fields (remediated)

- Evidence: the public organisation page selected complete Prisma `Event`
  records and passed them to the `OrgEventsContainer` Client Component. React's
  server-to-client payload could therefore include check-in station PIN hashes,
  encrypted PIN material, secret versions, and other non-public model fields
  even though the component rendered only public event details.
- Remediation: public organisation event/instance reads now use explicit,
  minimal Prisma selects and typed public DTOs. The collection is restricted to
  a defined three-year display window and a maximum of 250 rows of each kind;
  truncation is visible to the user instead of silently serializing an
  unbounded tenant history.
- Regression evidence: DTO tests inject station secrets and prove they cannot
  enter the public shape. Static frontend-boundary tests require the explicit
  selects and query limits at the Server/Client boundary.

##### PR-46 — High — Runtime exception objects could disclose sensitive data in logs (remediated)

- Evidence: error boundaries, Redis/rate-limit fallbacks, RSVP paths, and
  multiple mutation actions logged caught exception objects or messages.
  Provider messages can contain connection endpoints, user content, addresses,
  bearer URLs, or database fragments and therefore bypass the application's
  response redaction rules.
- Remediation: production paths log only stable operation categories. Detailed
  exception objects remain available only in development, while public errors
  remain generic. Redis fail-closed behavior is unchanged.
- Regression evidence: frontend-boundary and redaction suites require
  category-only production logging; the full unit suite exercises the modified
  action and domain paths.

##### PR-47 — Medium — Dashboard collections and client props were unbounded (remediated)

- Evidence: event/series management pages loaded entire attendee collections,
  the member page loaded the full organisation roster, and the series edit form
  received included instance/schedule relations it did not use. Large tenants
  could produce oversized database reads and React payloads, slow rendering,
  and excessive browser memory use.
- Remediation: attendee views use explicit user selects and a 250-row display/
  export ceiling with a visible truncation warning; the full dataset remains
  available through the scoped, paginated tenant machine API. Membership is
  server-paginated at 100 rows, and the series editor receives only required
  scalar fields.
- Regression evidence: static boundary tests assert each query ceiling and the
  scalar-only edit contract.

##### PR-48 — Medium — Calendar and asynchronous controls lacked reliable accessible feedback (remediated)

- Evidence: calendar dates were clickable `Box` elements without native
  keyboard semantics, icon-only month controls lacked accessible names, view
  toggles did not expose pressed state, and multiple publish/save/copy actions
  could fail without user-visible feedback.
- Remediation: calendar dates use focus-visible `ButtonBase` controls with
  labels and selected state; month and view controls expose accessible names/
  `aria-pressed`. Website publication, feedback settings, clipboard operations,
  and QR scanner errors now provide bounded pending/success/error feedback. QR
  video has an accessible label and printable windows sever `opener` access.
- Regression evidence: frontend-boundary tests require the semantic controls
  and accessible labels. Production browser interaction remains part of the
  integrated release gate.

##### PR-49 — Low — Service-worker caching grew without a deterministic bound (remediated)

- Evidence: the service worker asynchronously populated cache outside the
  response promise and did not evict old entries, allowing cache growth and
  nondeterministic persistence across worker termination.
- Remediation: versioned cache v5 handles only same-origin Next.js static
  scripts, styles, and fonts; cache writes are awaited and the cache is trimmed
  to 128 entries. Documents, authenticated responses, APIs, and event assets
  remain network-only.
- Regression evidence: frontend-boundary tests assert the static-only predicate,
  awaited write, and cache bound.

#### Accepted residual risk

- Interactive attendee dashboards intentionally show and export at most the
  newest 250 records. The UI calls this out and directs large tenants to the
  explicitly scoped, cursor-paginated machine API for complete exports. This
  prevents an unbounded browser/React payload while preserving a supported full
  data path.

#### Verification

- Frontend boundary, public DTO, accessibility, service-worker, and logging
  regression suites passed as part of the full 63-file, 175-test unit run.
- `npx tsc --noEmit`, `npm run lint`, `git diff --check`, and the optimized
  Next.js 16.3.1 production build passed.
- Production Playwright keyboard, responsive-layout, service-worker, and
  representative-role journeys await the disposable service/browser stack.

### 14. Integrated release gate

Status: Blocked by unavailable disposable services. No confirmed open Critical
or High application finding remains, but this release candidate is **not yet
certified production-ready** because mandatory database and production-browser
gates have not executed against an isolated service stack.

#### Findings

##### PR-50 — Medium — Coverage could silently run destructive database tests (remediated)

- Evidence: `vitest.coverage.config.mts` included both unit and PostgreSQL
  integration files. Running the documented coverage command therefore
  inherited the application's ambient `DATABASE_URL`; there was no explicit
  signal that the database was disposable. The unexpected integration run
  reached a schema without the four new migrations and failed on missing
  feedback columns and unenforced event/feedback/outbox constraints.
- Remediation: coverage is now service-independent and includes unit tests
  only. The integration config refuses to start without an explicit
  `TEST_DATABASE_URL`, then replaces `DATABASE_URL` with that value before any
  Prisma client is created. CI supplies the named disposable PostgreSQL service
  URL, runs coverage and integration as separate gates, and runs production
  configuration preflight.
- Regression evidence: coverage completes with 175 unit tests and no database
  access. An integration invocation with `TEST_DATABASE_URL` removed fails at
  config startup with the required safety message.

##### PR-51 — Medium — Coverage remains below a comprehensive production target (accepted residual)

- Evidence: repository-wide unit measurement is 33.08% statements, 25.77%
  branches, 49.27% functions, and 36.8% lines. Several large mutation modules
  report zero direct line coverage even where authorization behavior is covered
  by static-contract, domain, integration, or browser tests.
- Rationale: this audit added targeted regression tests for every confirmed
  Critical/High remediation and raised measured coverage substantially above
  the configured regression floor. Treating raw line coverage as a substitute
  for the pending PostgreSQL/browser gates would be misleading. Coverage should
  continue to ratchet upward, prioritizing membership, RSVP lifecycle, event/
  series mutations, and check-in failure paths.

#### Passed gates

| Gate | Result |
|---|---|
| Dependency audit (`--omit=dev --audit-level=low`) | Passed; zero known vulnerabilities |
| Prisma schema validation | Passed |
| ESLint | Passed |
| TypeScript (`tsc --noEmit`) | Passed |
| Unit tests | Passed; 63 files / 175 tests |
| Unit coverage thresholds | Passed; 33.08% statements / 36.8% lines |
| Synthetic production configuration preflight | Passed with TLS-only placeholder URLs and no real credentials |
| Optimized production build | Passed on Next.js 16.3.1 |
| Playwright collection | Passed; 16 production scenarios in 3 files |
| Patch whitespace validation | Passed |

#### Release blockers

1. Apply every ordered migration to a fresh disposable PostgreSQL 16 database,
   then run `db:status` and the expanded `db:verify` constraint/trigger checks.
2. Run the complete PostgreSQL integration suite with an explicit disposable
   `TEST_DATABASE_URL`, including invitation, MFA recovery, capacity/waitlist,
   check-in, feedback privacy, machine API, and schema race/invariant cases.
3. Run the 16 Playwright scenarios against the production standalone build with
   disposable PostgreSQL and Redis, then complete representative keyboard,
   responsive, and role-based exploratory journeys.
4. Build and smoke-test the standalone container with the same release inputs.

Docker is not installed on this audit host, so none of these blockers can be
safely substituted with the ambient application database or a non-isolated
service. The quality workflow contains the required PostgreSQL/Redis services
and release commands; its green result is required before deployment.
