# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Releases are not yet tagged in git, so there are no compare links.

## [Unreleased]

### Added

- **Team registration** for one-off events (hackathons, game jams, competitions), specified in `docs/TEAMS.md`. Event settings `registrationMode`, `teamMinSize`, `teamMaxSize` and `soloPolicy` in the Publishing section. In team mode capacity counts units (each team or solo registrant is one), under the same event row lock as every other capacity change. Registrants create a team, join one through its link (`/:orgSlug/:eventSlug/team/:joinToken`), or register solo where allowed. Leaders manage their team from a private link (`/team/:token`, stored hashed) or **Account → Registrations**: rename, regenerate links, add and remove members, hand over leadership, and disband. *Looking for a team* profiles, invitations and join requests on *Solo with matching* events. Organisers approve, reject, promote, rename, move members, and delete teams (with undo) from the Guests tab's Teams view. New outbox kinds `team-created` and `team-member-added`; status emails name the team. Team cores live in `lib/core/teams.ts` and `lib/teamUnits.ts`.
- Migration `20261024000000_team_registration` (additive only: new enums, columns, tables, CHECK constraints, and a partial unique index for one pending join request per team and registration).
- PostgreSQL integration suite `tests/integration/teams.db.test.ts`.
- **Custom check-in lists.** Organisers add lists beyond venue entry ("Swag collection", "Lunch – Day 1", "Workshop B") from **Manage lists** on the Check-in tab or page (owners/admins and `EDIT_DETAILS` co-organisers), and anyone who can check people in (`CHECK_IN`) switches the desk from **Entry** to a list, then scans, types a code or searches to mark guests, with undo, "already checked in to <list> at <time>" feedback, collected / eligible counts and a collected / not collected guest view. Same eligibility and Override as entry, an optional "only after entry check-in" rule, read-only archived lists, a `Check-in: <list>` column per list in the attendee CSV, and list chips in the Guests list. Entry check-in, the live ticket and the entry history are unchanged. New Server Actions in `app/actions/checkin-lists.ts` over `lib/core/checkinLists.ts`; migration `20261023000000_check_in_lists` is additive. Standalone events only for now.
- **Re-accept a declined registration.** Organisers can reverse a decline from the Guests list (**Re-accept**) or the mobile API (`POST /api/mobile/v1/orgs/:orgSlug/events/:eventId/guests/:rsvpId/reaccept`, additive). The guest is confirmed when there is room and waitlisted otherwise, in the same capacity transaction as an approval, with the matching outbox email and a `RSVP_REACCEPTED` audit event. `approve` is unchanged.
- **Saved email drafts** in the event Emails tab: a custom email autosaves (about 1.5 s after typing stops, plus **Save draft**) to the new `EventBroadcastDraft` table, one private draft per organiser and event, is restored when the tab opens, asks before a template or reused email replaces it, can be discarded, warns before leaving with unsaved changes, and is cleared when the email is sent. New `broadcastDraft` rate-limit bucket (60 per minute). Migration `20261022000000_event_broadcast_drafts` is additive.
- **Organisation webhooks.** Owners and admins can send their organisation's events to their own systems from **Settings → Webhooks**: up to 10 endpoints, each with subscribed event types (`registration.created`, `registration.status_changed`, `checkin.created`, `checkin.undone`, `event.published`, `event.cancelled`, `feedback.submitted`, plus a `ping` test), a `whsec_` signing secret shown once and stored encrypted, Rotate secret, Send test, Enable/Disable, Delete, and a delivery log with Redeliver. Requests carry `x-yuyu-signature` (HMAC-SHA256 over `<t>.<body>`), minimal DTOs without emails, answers or tokens, retry with jittered backoff (8 attempts over about a day) from the existing outbox worker, and an endpoint is switched off after 20 consecutive failures. Targets are SSRF-restricted (public https on 443/8443, every resolved address checked at save and delivery time, pinned connection, no redirects). New `webhookManage`/`webhookTest` rate-limit buckets, development/test-only `WEBHOOKS_ALLOW_PRIVATE_TARGETS`, and additive migration `20261023010000_org_webhooks`; app processes need outbound HTTPS to receivers. See `docs/WEBHOOKS.md`.

### Changed

- On team events, approving, rejecting, or promoting a single registration that belongs to a team is refused; organisers act on the whole team instead. Self-cancellation, organiser delete and restore, and the capacity-lowering check in `updateEvent` count units on team events. `INDIVIDUAL` events behave as before.
- Organiser team actions (approve, reject, promote, rename, move, delete and restore teams) use the same `MANAGE_REGISTRATIONS` check as the individual RSVP lifecycle, so co-organisers with that grant manage teams too. Re-accepting a single declined team member is refused; the attendee CSV keeps the Team columns before the per-list check-in columns.
- Team changes send organisation webhooks like individual RSVPs: one `registration.status_changed` per member for whole-team approve, reject and promote, automatic team promotion, moves into a team, leader removals and disbanding (`CANCELLED`), organiser team deletion (`REMOVED`) and its undo, and `registration.created` when a leader adds a member. Undoing a team deletion (or a last-member deletion) restores the members' custom check-in list records, like the single-RSVP undo.
- `POST /api/mobile/v1/rsvp` returns `TEAM_REQUIRED` (409) for an event that registers teams only.

### Security

- **Dependency advisories patched.** `next` 16.3.8 → 16.4.2 (GHSA-2464-fhr4-w9xw, GHSA-673q-mjm6-r5xr, GHSA-p3m5-59mp-jv5r) with `eslint-config-next` in step, `zod` 4.3.6 → 4.6.7 (GHSA-mrhx-c7xc-m3w5) and `nodemailer` 10.0.10 → 10.2.1 (addressparser GHSA-8c8m-p3m8-cjg8, GHSA-m943-m63m-w62w, GHSA-85x2-q946-cp5h). No application code changes; `npm audit --omit=dev` reports 0 vulnerabilities.

### Fixed

- **Co-organiser permissions.** Collaborators no longer see owner/admin-only controls (Delete event, clone, event address, embed, publishing, the registration form, emails, feedback settings and the certificate builder, the series details form, and series invites or schedule without the grant), and the event and series dashboards now show each grant's own controls: `EDIT_DETAILS` the event page content editor, `MANAGE_REGISTRATIONS` the guest list with approvals, manual guests, edits, removals, the attendee CSV and registration numbers, and `MANAGE_INVITATIONS` the invite list. Server-side, `MANAGE_INVITATIONS` now authorises event and series invites and `MANAGE_REGISTRATIONS` the RSVP lifecycle and guest-management cores (on the event, or on the series for occurrences), which were owner/admin only although the dashboard offered them; delete, clone, collaborator management, publishing and short links stay owner/admin only. Visibility comes from one capability object (`lib/eventDashboard/capabilities.ts`); the matrix is in `docs/PERMISSIONS.md`.

## [1.0.0] - 2026-10-21

The V1 release: everything the `v1-design-overhaul` integration branch adds on top of production `main`. See the upgrade notes before deploying.

### Added

- **V1 design system.** Tailwind CSS 4 with Radix primitives and lucide icons in `components/ui/*`, `--yy-*` design tokens for light and dark mode (`app/styles/tokens.css`), self-hosted Bricolage Grotesque, Figtree and JetBrains Mono, an event accent helper with contrast guards, and the design brief in `docs/DESIGN.md`. A new app shell with a collapsible sidebar, site header and footer, and a View Transitions dark-mode toggle.
- **Dot-sign brand.** Brand components in `components/brand/*`, SVG masters in `public/brand/`, and `npm run brand:generate` for the favicon, app icons, social card and email lockup.
- **Redesigned screens.** Workspace home (greeting, "Needs you", "Next up", event-day mode, weekly stats, activity), organisation workspace (calendar, stats, series and team panels), members and settings, Discover and organisation pages (List/Calendar), public event, programme, session and speaker pages, the account area, the super-admin area, the homepage, Features, About (with the sealed-envelope building note), Privacy and Terms, a "lost ticket" 404 page and loading screens.
- **Event dashboard** regrouped into eight tabs (Overview, Guests, Event page, Emails, Check-in, Feedback, Analytics, Settings) with `?tab=`/`?sub=` deep links, an Overview readiness checklist with **Publish event**, a three-step **Create Event** dialog, and cancelling unused co-organiser invites (`cancelEventCollaboratorInvite`).
- **Publishing section** with three plain questions (Draft/Live/Offline; who can find it plus "Approve each sign-up"; spots, one close-sign-ups rule and the going count), a custom accent colour picker, and a cover photo editor (crop, rotate, straighten, adjust, WebP export).
- **`listedPublicly`**: approval-required events can opt in to listing on the organisation page, Discover, search and search-engine indexing (`lib/eventVisibility.ts`). Off by default.
- **Registration question settings**: help text, placeholders, length/number/date limits, maximum selections, an "Other" answer and "show only if" logic (`lib/registrationFields.ts`), enforced on the server.
- **Broadcast designs**: Classic, Minimal, Accent band, Photo header and Letter (`lib/email/broadcastDesigns.ts`), thirteen starter templates, a review step that must be ticked, and a five-second undo before sending.
- **Certificate builder** with up to 20 text and image layers on uploaded artwork, merge tags, and organisation-bound image layers re-encoded as WebP. Older single name-area templates are upgraded on read.
- **Event short links** at `/{7-character code}`, created and regenerated by owners and admins from the event Overview (`lib/shortLink.ts`, `lib/shortLinkResolve.ts`).
- **Account area** with Profile, Registrations (tickets, cancel, certificates, and a personal JSON data export at `GET /api/exports/account`), Organisations (memberships, co-organiser roles, pending invites, leave an organisation) and Security.
- **Live ticket tear**: an open ticket tears off its QR stub the moment the attendee is checked in, over Server-Sent Events (`GET /api/ticket/:token/events`) with a status fallback (`GET /api/ticket/:token/status`), Redis pub/sub between replicas and an in-process fallback. Venue map link on the ticket for http(s) map URLs.
- **Badge printing** rebuilt: a quick print sheet after each check-in, a designer with Classic/Bold/Minimal templates, stock presets (A6, 4 × 6, 3 × 4, 4 × 3, CR80) and design export/import.
- **Analytics funnel** with labelled shares that never exceed 100%, and a restyled **post-event PDF report** with sign-up timeline, arrivals, programme, speakers and sponsors, answer counts, emails sent and team.
- **Super-admin insights**: Activity, Email, Security and per-user support pages, a "Needs attention" panel, and a separate top bar.
- **Mobile API v1** (`/api/mobile/v1`) for the Yuyu Android and iOS apps: `MobileSession` with hashed, rotating tokens and refresh-reuse revocation; password and Google ID-token sign-in sharing the web verifiers; own registrations and cancellation; public discovery, search, short links, event pages, feedback forms and RSVP; organiser events, guests, check-in (preview, scan/manual, undo, lookup, stats, offline roster and sync), broadcasts and day-of controls. Server Action logic moved into shared `lib/core/*` functions used by both surfaces. OpenAPI 3.1 contract (`docs/mobile-api.openapi.yaml`), response fixtures and a drift test. `/.well-known/assetlinks.json` and `/.well-known/apple-app-site-association`.
- **Operational alerts webhook** (Mattermost or Slack-compatible), configured in Super admin → Settings: uncaught server errors, server error logs (and optionally warnings), Auth.js sign-in failures, outbox delivery failures, failed scheduler runs, browser crashes through `POST /api/client-errors`, and an *Instance started* note. Alerts are redacted, de-duplicated for five minutes and capped at 30 a minute per process (`lib/opsAlerts.ts`).
- **Send test email** in Super admin → Settings, and `scripts/check-instance-secrets.mjs` (also in the `migrator` image, and optional in the Helm migration Job with `migration.checkInstanceSecrets=true`) to confirm `MFA_ENCRYPTION_KEY` can decrypt the saved panel secrets.
- Optional settings `GOOGLE_MOBILE_CLIENT_IDS`, `ANDROID_APP_SHA256_CERT_FINGERPRINTS` and `APPLE_APP_IDS`.
- Migrations `20261015000000_registration_question_settings`, `20261016000000_event_listed_publicly`, `20261017000000_broadcast_design`, `20261018000000_rsvp_user_index`, `20261019000000_event_short_code`, `20261020000000_mobile_sessions`, `20261021000000_ops_alert_webhook` and `20261021010000_realign_event_publication`.

### Changed

- With no saved colour mode, the interface follows the operating system (previously light).
- The installed web app is named "Yuyu" with a stable manifest `id`, new colours and new icons under `/brand/`; the check-in service-worker cache moves to `v6`.
- API access moves from the sidebar to Organisation settings. Deleting an organisation requires typing its exact name. Members who are not admins no longer see management links or pending-approval counts, and member emails are shown only to owners and admins.
- Event dashboard tabs are regrouped from eleven to eight; old `?tab=details|registration|invites` links still work. The Event page tab's live phone preview and the workspace countdown timers are removed.
- Registration validation skips questions hidden by "show only if", treats an empty string as no answer, and applies the new per-question limits.
- Broadcasts require the review step and five-second undo; past broadcasts keep the Classic design. Test sends have their own `broadcastTest` rate-limit bucket (20 an hour). Sent emails need `NEXT_PUBLIC_BASE_URL` for images and links.
- `GET /api/search` uses the shared `listedPublicly` audience rule; `GET /api/feedback/certificate/:token` renders layered certificates.
- Saved SMTP in Super admin → Settings now replaces the `SMTP_*` environment as a whole: a missing saved username or password is no longer filled from the environment. Panel settings are read from PostgreSQL on every send and sign-in, so they apply on every replica without a restart.
- Blank environment values (for example `SMTP_HOST=""` from `.env.example`) count as unset. The startup check and `npm run production:check` no longer require `EMAIL_FROM` or `SMTP_*`.
- **Retry failed email** in Super admin → Operations requeues only failures from the last 7 days and resets their retry budget.
- The staging app waits for its migration container; the Helm Deployment omits `replicas` when the HPA is enabled.
- Server Actions became thin wrappers over `lib/core/*`; password verification moved to `lib/credentialsAuth.ts` and the Google linking policy to `lib/googleSignIn.ts`.

### Fixed

- Publishing an event from the Overview **Publish event** button now sets it Live and releases its public page in one transaction (`publishEvent` in `app/actions/event.ts`), creating the page row if the draft had none. Before, such events stayed 404 (page, sign-ups and short link). Saving the event page for an event without a page row creates it released exactly when the event is published. The `20261021010000_realign_event_publication` data migration repairs events already published this way.
- Missing pages return a real HTTP 404 instead of a streamed 200 (the root `app/loading.tsx` moved to `app/dashboard/loading.tsx`).
- WebP uploads: lossy VP8 dimensions are read little-endian and lossless VP8L is recognised, so valid images are no longer rejected as oversized.
- Broadcast test sends link `{{ticketLink}}` to the organiser's own ticket when they are a confirmed attendee, and the Photo design falls back to the colour band when no public address is configured.
- An unreadable saved Google client secret disables Google sign-in instead of failing every page; the saved client ID pairs only with the saved secret.
- Super-admin pages use UTC-safe reporting windows, validate search and page parameters, and return UI-safe action errors. In CI/staging mode the SMTP transport accepts Mailpit without TLS.

### Security

- Short links resolve only for published events with a released page; unknown, unreleased and rate-limited codes share the unknown-organisation 404, so a code never reveals a hidden event's slug.
- Mobile sessions store only SHA-256 token digests, rotate refresh tokens, revoke the session on refresh-token reuse, and are bound to `sessionVersion`, so password, MFA and "sign out everywhere" changes end them.
- Every `app/super-admin/**/page.tsx` calls `requireSuperAdminMfa()` itself, enforced by `tests/unit/super-admin-page-guards.test.ts`. Super-admin insights never load tokens, answers or message bodies, and the invites page no longer loads invite tokens.
- The personal data export is own-data only, allow-listed, `private, no-store`, rate limited (5 an hour) and audited. Leaving an organisation locks the organisation row and blocks the sole owner.
- Live ticket routes validate the token shape, return only the check-in state, and are rate limited per IP; channels are keyed by RSVP id, never the ticket token.
- Venue map links accept only http(s) URLs (`lib/safeHttpUrl.ts`); broadcast designs escape organiser values and accept only absolute http(s) image and link URLs.
- The alert webhook URL is write-only and encrypted with the instance-secret key; alert text is redacted before it leaves the instance, and `POST /api/client-errors` is same-origin, size-capped and rate limited.
- The staging Nginx example now overwrites `X-Forwarded-For` with the client address instead of appending to it, so a client cannot choose its own rate-limit identity.

### Removed

- MUI, Emotion and `date-fns` (`@mui/*`, `@emotion/*`), the MUI theme bridge (`lib/theme.ts`) and the legacy login stylesheet.
- Plausible analytics from the root layout.
- Old icon and asset URLs: `public/icons/yuyu-{192,512}.png`, `public/brand/yuyu-mark.svg`, `public/login-hero.svg`, and the generated `app/icon.tsx`/`app/apple-icon.tsx` routes (replaced by static `app/icon.svg` and `app/apple-icon.png`).
- Legacy dashboard, navigation and attendee components replaced by the redesign (for example `AttendeeTable`, `AppBarNav`, `EventManageTabs`).

### Upgrade notes

1. **Migrations.** Run `npm run db:deploy` (or the Helm migration Job) before rolling out the new image. It applies 8 migrations. `20261018000000_rsvp_user_index` is a plain `CREATE INDEX` that briefly blocks RSVP writes while it builds, so run it in a quiet window on large installations. `20261020000000_mobile_sessions` replaces a CHECK constraint and validates it by scanning `CheckInEvent`. `20261021010000_realign_event_publication` is a data-only repair. See [Recent schema migrations](docs/production-operations.md#recent-schema-migrations).
2. **SMTP and instance secrets.** Before deploying, run `node scripts/check-instance-secrets.mjs` with the production environment. After deploying, use Super admin → Settings → **Send test email**. Saved SMTP settings now replace the `SMTP_*` environment as a whole, so if a saved host or service relied on environment credentials, re-enter the SMTP user and app password in the panel.
3. **Reverse proxy and ingress.** Configure them not to buffer `/api/ticket/:token/events` and to allow idle reads of at least 30 seconds (Nginx `proxy_buffering off`; ingress-nginx `nginx.ingress.kubernetes.io/proxy-buffering: "off"`). See [Isolated staging deployment](docs/DEPLOYMENT_STAGING.md) and the [Helm chart](charts/yuyu/README.md).
4. **Mobile apps (optional).** Set `GOOGLE_MOBILE_CLIENT_IDS`, `ANDROID_APP_SHA256_CERT_FINGERPRINTS` and `APPLE_APP_IDS` only when the apps ship. Mobile Google sign-in needs outbound HTTPS to `www.googleapis.com`.
5. **404s and old URLs.** Missing pages now return a real HTTP 404, which may affect monitors or crawlers that expected 200. The old icon URLs (`/icons/yuyu-*.png` and the other removed assets) are gone and return 404.
6. **Failed email.** Email that failed before the SMTP fix can be requeued with **Retry failed email (last 7 days)** in Super admin → Operations; older failures are not resent.
7. Keep `NEXT_PUBLIC_BASE_URL` set to the public HTTPS address so sent emails include images and links.

## [0.2.0] - 2026-04-22

Phase 2. Later releases to production `main` before 1.0.0 were not recorded in this file.

### Added

- Role-based access control utilities (`requireAuth`, `requireOrgRole`, `canManageEvents`, `canManageMembers`, `canDeleteOrg`)
- Organisation dashboard (`/dashboard/[orgSlug]`) with stats, event list, and create actions
- Event management panel (`/dashboard/[orgSlug]/event/[eventId]`) with tabs:
  - Overview, details editing, attendees table, invites, analytics cards, and check-in link
- Attendee management:
  - Search + filters
  - Delete RSVP
  - Approve/reject pending approvals
  - Promote from waitlist
- Organisation member management (`/dashboard/[orgSlug]/members`) with role changes/removals (owner-gated)
- Organisation invite links (`OrganisationInvite`) for adding members (token-based)
- Event status extended with `HIDDEN`
- Event privacy types: `PUBLIC`, `HIDDEN_LINK`, `APPROVAL_REQUIRED`, `INVITE_ONLY`
- RSVP status lifecycle: `CONFIRMED`, `WAITLISTED`, `PENDING_APPROVAL`, `REJECTED`
- RSVP API (`POST /api/rsvp`) backed by shared RSVP core (guest + logged-in)
- Rate limiting for API/auth/RSVP/search (`lib/rateLimit.ts`, applied by the Next.js proxy, now `proxy.ts`)
- Global discovery and search:
  - `/discover` public listings (filters + popular sort)
  - `/search` page and `GET /api/search?q=…` endpoint
- Invites for access control:
  - `EventInvite` for single events
  - `SeriesInvite` for recurring series
- Recurring events foundation:
  - `EventSeries` + `EventInstance` models
  - RRULE/ICS expansion + instance materialization (`lib/recurrence.ts`)
  - Series management dashboard (`/dashboard/[orgSlug]/series/[seriesId]`)
- Ticketing + check-in tooling:
  - Per-RSVP `checkInToken`, `checkedInAt`
  - Ticket page (`/ticket/[token]`) with QR panel + shareable link
  - Event check-in station (`/dashboard/[orgSlug]/event/[eventId]/check-in`)
- Email (`lib/email/*`) and S3-compatible storage (`lib/storage/*`) abstractions, initially as stubs; both were later replaced by the outbox email worker and private S3 storage
- `.gitignore` tightened to exclude common local/generated artifacts (editor folders, caches, logs, temp files, local Prisma DB files)

### Changed

- Authentication: replaced email magic-link provider with an **email + password** Credentials provider (bcryptjs-hashed `User.passwordHash`) alongside existing Google OAuth. Sessions now use JWT strategy (required by Credentials). Login UI offers Sign in / Create account tabs.
- RSVP capacity handling: full events now place new RSVPs on `WAITLISTED` (instead of hard-blocking)
- Database schema expanded to support invites, RSVP lifecycle/check-in, privacy, and recurring series/instances

### Removed

- `nodemailer` dependency and the magic-link email stub in `lib/auth.ts`

## [0.1.0] - 2026-04-20

### Added

- Next.js 16 (App Router) with TypeScript
- PostgreSQL via Prisma ORM (v6) with Docker Compose for local development
- Auth.js / NextAuth v5: Google OAuth (optional via env) and email magic link with **stub** `sendVerificationRequest` (logs link to server console)
- Domain models: `User`, `Organisation`, `Membership` (OWNER / ADMIN / MEMBER), `Event` (DRAFT / PUBLISHED), `RSVP` (logged-in or guest email) with `attendeeKey` for deduplication
- Organisation creation with creator as OWNER (transaction)
- Event creation with title-based slug and collision suffix; members can create; only OWNER/ADMIN can publish or create as PUBLISHED
- Public org page `/{orgSlug}` and public event page `/{orgSlug}/{eventSlug}` (published events; draft events visible to org members only)
- RSVP server action with capacity check and duplicate handling
- Material UI v9 theme (MD3-inspired tokens), responsive layout, event cards, dialogs, RSVP form
- Zod validation for org, event, and RSVP payloads
- SEO: `generateMetadata` on published event pages
- Documentation: `docs/FUTURE_PHASES.md` for deferred scope and later phases

### Security

- Dashboard routes require session
- Event creation requires organisation membership
- Publishing requires OWNER or ADMIN
- Public RSVP only for PUBLISHED events

### Not in scope (Phase 1)

- Recurring events, waitlists, invite-only flows, approval workflows
- Transactional email delivery (beyond development stub)
- Analytics, ticketing, payments
