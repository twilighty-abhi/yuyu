# Routes and HTTP endpoints

[Documentation index](README.md)

Dynamic segments are shown as `:name` for readability.

## Public pages

| Route | Purpose |
| --- | --- |
| `/` | Landing page |
| `/about`, `/features` | Product story and feature overview |
| `/privacy`, `/terms` | Privacy policy and terms of use |
| `/discover` | Paginated public event discovery |
| `/search` | Public event search UI |
| `/:orgSlug` | Public organisation page |
| `/:orgSlug/:eventSlug` | Public event details and RSVP |
| `/embed/:orgSlug/:eventSlug` | Framable public event details and RSVP for a host website |
| `/:orgSlug/:eventSlug/schedule` | Event programme and live running order (published sessions only) |
| `/:orgSlug/:eventSlug/sessions/:sessionSlug` | Public session page (published sessions and resources only) |
| `/:orgSlug/:eventSlug/speakers/:speakerSlug` | Public speaker page (published speakers only) |
| `/:orgSlug/:eventSlug/feedback` | Event feedback form when open |
| `/:orgSlug/:eventSlug/team/:joinToken` | Team join link ([Team registration](TEAMS.md)): the registration form with the team fixed. Same access rules as the event page; shows only the team name, size and maximum size; unknown, retired and other events' tokens are a 404; a signed-in person's own solo registration for the event (or a ticket this browser remembers) can join the team instead of registering again; `noindex`, `no-referrer` |
| `/:orgSlug/:eventSlug/projects` | Hackathon project gallery ([Hackathon judging](HACKATHON.md)): submitted projects' titles, summaries, team or entrant names, and links, once the submission window has closed and the organiser made the gallery public. `?q=` search, `?sort=newest\|az\|awards`, `?filter=winners` and award badges (the last two once results are published), `?page=N`; invalid values fall back to the defaults. Same access rules as the event page; otherwise a real 404 |
| `/:orgSlug/:eventSlug/results` | Hackathon results: awards, places, winning project titles, team or entrant names, and links, once the organiser has published results, with a `?q=` search once more than 10 winners are listed. Never scores or judge comments. Same access rules as the event page; otherwise a real 404 |
| `/:orgSlug/:eventSlug/check-in` | PIN-protected venue check-in station; usable by trusted on-site staff without an account |
| `/:orgSlug/i/:instanceId` | Recurring-series instance and RSVP |
| `/:orgSlug/i/:instanceId/schedule` | Programme for one recurring occurrence |
| `/:shortCode` | Event short link: a 7-character code (letters and digits, always at least one uppercase letter, so it never matches a lowercase organisation slug) that temporarily redirects to the event's current public page. Unknown, unpublished, and unreleased codes, and lookups over the `shortLink` limit (30/min per IP), return the same not-found page as an unknown organisation. Publishing releases the event page in the same step, so a Live event's code works immediately |
| `/ticket/:token` | Attendee ticket status and QR page; tears off the QR stub live when the attendee is checked in. On a team event it also shows the team (name, leader, member names), leaving the team, **Join a team** with a pasted join link for a solo registration, and the *Looking for a team* profile and list. A crew ticket ([Event crew](CREW.md)) shows a **Crew** chip and no cancel or team controls |
| `/submit/:token` | A solo registrant's project page, opened by the emailed submission link (requested from the ticket page; stored only as a SHA-256 hash; requesting a new one retires the old link). Draft, submit, edit while the window is open, and withdraw. Unknown and retired tokens are a 404; `noindex`, `no-referrer`, never cached |
| `/crew/:token` | Crew sign-up link ([Event crew](CREW.md)): the crew profile form for one event, showing only the event and organisation names and time. Malformed, rotated and disabled tokens are a 404; closed for cancelled and ended events. New members start hidden from the event page, and an email already on the crew or registered gets the same answer as a new sign-up. Generic metadata, `noindex`, `no-referrer`, never cached |
| `/team/:token` | Team page for the leader ([Team registration](TEAMS.md)), opened by the opaque management token (stored only as a SHA-256 hash; regenerating it retires the old link). A signed-in leader reaches the same page at `/account/teams/:teamId` without the token. `noindex`, private cache, `no-referrer`; the ticket's check-in token never opens it |
| `/join/org/:token` | Accept an organisation invitation |
| `/join/event-collaborator/:token` | Accept an event co-organiser invitation |
| `/login` | Password and Google sign-in/signup |
| `/verify-email` | Consume a one-time email-verification link and activate a password account |
| `/reset-password` | Password-reset request and completion |
| `/account` | Authenticated account profile settings |
| `/account/security` | Authenticated password, MFA, recovery-code, and session controls |
| `/account/registrations` | Authenticated list of the signed-in user's own registrations, tickets, certificates, and personal data download |
| `/account/teams/:teamId` | Authenticated team page for the team's signed-in leader (linked from `/account/registrations`); a 404 for anyone else. Same controls as `/team/:token` except resetting the management link; `noindex`, private cache |
| `/account/submissions/:eventId` | Authenticated project page for a signed-in entrant (any member of a team, or the owner of a solo registration), linked from `/account/registrations` and the ticket. A 404 for anyone without a registration on the event; `noindex`, `no-referrer` |
| `/account/organisations` | Authenticated list of the user's memberships and roles, event co-organiser roles, pending co-organiser invites, and leave-organisation control (blocked for the sole owner) |

## User and organisation dashboard

| Route | Purpose |
| --- | --- |
| `/dashboard` | User's organisations |
| `/dashboard/security` | Legacy redirect to `/account/security` |
| `/dashboard/org/new` | Create an organisation |
| `/dashboard/:orgSlug` | Organisation events and series |
| `/dashboard/:orgSlug/settings` | Organisation settings |
| `/dashboard/:orgSlug/members` | Members, roles, and invitations |
| `/dashboard/:orgSlug/event/:eventId` | Event dashboard with eight tabs: Overview, Guests, Event page, Emails, Check-in, Feedback, Analytics, and Settings (`?tab=` and `?sub=` deep links; old `?tab=details\|registration\|invites` links still work), plus **Judging** (`?tab=judging`) for hackathon submissions, rubric, judges, progress and automatic assignment (`&sub=judging-progress`), awards, and results, shown only once the event uses judging (until then owners and admins turn submissions on under Settings, and a link to `?tab=judging` opens Overview). A co-organiser whose only grant is `JUDGE` sees just the judging workspace. Guests → Crew (`?tab=guests&sub=crew`) manages the [event crew](CREW.md) and its sign-up link. The paged lists keep their filters in the query string too (saved views, allow-listed per list: People `status`/`kind`/`team`/`q`, Teams `status`/`q`, Submissions `status`/`q`, Results `scored`/`q`, Progress `show`; e.g. `?tab=guests&sub=people&status=waitlist`); the filters never grant access |
| `/dashboard/:orgSlug/event/:eventId/schedule` | Standalone-event programme planning and live delay management |
| `/dashboard/:orgSlug/event/:eventId/check-in` | Online/offline check-in station; organisation admin or exact event `CHECK_IN` grant. `?list=<id>` opens the desk for one open custom check-in list instead of entry |
| `/dashboard/:orgSlug/series/:seriesId` | Recurring-series management |
| `/dashboard/:orgSlug/settings/api` | Machine API clients (owners; fresh re-authentication for mutations) |
| `/dashboard/:orgSlug/settings/webhooks` | Outgoing webhook endpoints (owners and admins); add, and the secret shown once |
| `/dashboard/:orgSlug/settings/webhooks/:endpointId` | One endpoint: edit, rotate secret, send test, enable/disable, delete, and the last 50 deliveries with Redeliver (owners and admins; another organisation's id is a 404) |

Dashboard pages require authentication and enforce membership/role permissions on the server.

## Super-admin pages

The `/super-admin` area includes overview, activity, audit log, auth, email, events, invites, monitoring, operations, organisations (with a detail page per organisation), security, settings, storage, and users (with a detail page per user at `/super-admin/users/:userId`). The Auth page includes the instance-wide new-account creation control. `/super-admin/settings` manages SMTP, Google SSO, displayed backup posture, and the operational alerts webhook; secrets (including the webhook URL) entered there are write-only. Access requires the authenticated email configured in `SUPER_ADMIN_EMAIL`; other users receive a not-found response.

Every super-admin page additionally requires a current TOTP verification, and each `page.tsx` calls `requireSuperAdminMfa()` itself because layout checks do not re-run on client navigation (`tests/unit/super-admin-page-guards.test.ts` enforces this). Users without a valid 10-minute step-up proof are sent to the `/super-admin-mfa` verification page; authenticator MFA must be enrolled first from `/account/security`.

## Public and application APIs

| Method and route | Authentication | Purpose |
| --- | --- | --- |
| `POST /api/rsvp` | Optional session | Submit an event or instance RSVP; on a team event the optional `team` field creates a team, joins one by join token, or registers solo |
| `POST /api/feedback` | Public, rate-limited | Submit feedback; email is used only for certificate-enabled forms |
| `POST /api/check-in/station` | PIN-scoped station session, rate-limited | Open and operate a venue check-in station |
| `GET /api/search?q=...` | Public, rate-limited | Return matching public events |
| `POST /api/client-errors` | Public, same-origin, rate-limited per IP (`clientError`, 10/min), 4 KB body cap | Browser crash report from the app error boundaries; forwarded (redacted) to the alert webhook when configured. Always an empty `204` |
| `GET /api/ticket/:token/download` | Opaque token | Download the attendee ticket |
| `GET /api/ticket/:token/status` | Opaque token, rate-limited per IP (`ticketStatus`, 120/min) | Return only `{ checkedIn, checkedInAt }` for the ticket (`no-store`, `no-referrer`; empty 404 for unknown tokens) |
| `GET /api/ticket/:token/events` | Opaque token, rate-limited per IP (`ticketEvents`, 60/min) | Server-Sent Events: initial `state`, then one `checked-in` event when the attendee is admitted; `: ping` every 25 s, closes after at most 10 minutes |
| `GET /api/feedback/certificate/:token` | Opaque token | Download an eligible JPEG certificate |
| `GET /api/exports/events/:eventId/attendees` | Authenticated organisation admin or event collaborator with `MANAGE_REGISTRATIONS` | Audited (`ATTENDEE_LIST_EXPORTED`, surface and filter names only) attendee CSV: every registration without parameters; with the Guests · People filters (`status`, `kind`, `team`, `q`) only the matching ones, same columns; streamed in keyset batches of 500; `private, no-store`, empty 404 otherwise (also for a malformed filter) |
| `GET /api/exports/events/:eventId/teams` | Authenticated organisation admin or event collaborator with `MANAGE_REGISTRATIONS`, TEAM events | Audited (`TEAM_LIST_EXPORTED`, filter names only) Guests · Teams CSV for the view's `status` and `q`: team, status, size, incomplete, looking for members, leader and email, members, submission status, created; read through the Teams query in keyset batches of 200; `private, no-store`, empty 404 otherwise |
| `GET /api/exports/events/:eventId/attendee-emails` | Authenticated organisation admin or event collaborator with `MANAGE_REGISTRATIONS` | Audited (`ATTENDEE_LIST_EXPORTED`, format `emails`) unique names and emails for every registration matching the Guests · People filters (`status`, `kind`, `team`, `q`); `private, no-store`, empty 404 otherwise |
| `GET /api/exports/events/:eventId/feedback` | Authenticated organisation owner or admin | Audited (`FEEDBACK_RESPONSES_EXPORTED`) feedback responses CSV; `private, no-store`, empty 404 otherwise |
| `GET /api/exports/events/:eventId/judging` | Authenticated organisation owner or admin | Audited (`JUDGING_SCORES_EXPORTED`) judging scores CSV: one row per judge review with the rank and result score, plus both the raw and the adjusted score, judge names, no emails or comments. Results filters: `q` (search; ranks stay those of the whole ranking), `scored`, and `method` (`RAW`/`ZSCORE`, the method the table shows; the saved one when omitted). `view=submissions` exports Judging → Submissions instead (`status`, `q`; `status=notSubmitted` lists entrants without a submitted project), audited `JUDGING_SUBMISSIONS_EXPORTED`. Streamed in batches of 200 projects; audits record filter names only; `private, no-store`, empty 404 otherwise (also for a malformed or other-view parameter) |
| `GET /api/reports/event/:eventId` | Authenticated organisation owner or admin, after the event ends | Audited (`EVENT_REPORT_DOWNLOADED`) post-event PDF report; `private, no-store`, empty 404 otherwise |
| `GET /api/reports/instance/:instanceId` | Authenticated organisation owner or admin, after the occurrence ends | Audited (`EVENT_OCCURRENCE_REPORT_DOWNLOADED`) PDF report for one recurring occurrence |
| `GET /api/exports/account` | Authenticated user (own data only), rate limited per user (`dataExport`, 5/hour) | Audited (`ACCOUNT_DATA_EXPORTED`) personal JSON export; excludes secrets, hashes, and all bearer tokens |
| `GET /api/uploads/:key` | Public application route | Stream an allowlisted organisation WebP derivative with immutable/nosniff response controls |
| `/api/auth/*` | Auth.js | Session, provider, callback, and credential endpoints |
| `GET /api/v1/events` | Machine bearer credential + `events:read` | Paginated tenant event metadata |
| `GET /api/v1/events/:eventId` | Machine bearer credential + `events:read` | Tenant-scoped event metadata |
| `GET /api/v1/events/:eventId/participants` | Machine bearer credential + `participants:read` | Paginated minimal confirmed-participant roster, with attendance filtering; `include=attendance` also requires `participants:attendance:read` |
| `/api/mobile/v1/*` | Mobile session bearer (user identity); `auth/login`, `auth/google`, `auth/refresh`, `auth/config` and `public/*`/`rsvp` work without one | Yuyu mobile apps (Android and iOS): sign-in and token refresh, own registrations, public events, and organiser guests, check-in, emails and day-of controls. Same permission checks and core functions as the website; see [Mobile API](MOBILE_API.md) |
| `GET /.well-known/assetlinks.json` | Public | Android App Links statement from `ANDROID_APP_SHA256_CERT_FINGERPRINTS` (`[]` when unset) |
| `GET /.well-known/apple-app-site-association` | Public | iOS Universal Links association (JSON, no extension) from `APPLE_APP_IDS` (empty details when unset) |

Opaque ticket, certificate, team join, team management, submission, and crew sign-up URLs are bearer capabilities. Do not log them or place them in analytics payloads.

## Metadata routes

| Route | Purpose |
| --- | --- |
| `/manifest.webmanifest` | PWA manifest (`app/manifest.ts`): name "Yuyu", `id` `/`, start URL `/dashboard` |
| `/robots.txt` | Crawler rules (`app/robots.ts`); disallows `/dashboard/`, `/super-admin/`, `/ticket/`, `/team/`, `/{org}/{event}/team/`, `/submit/`, `/join/`, and `/crew/` |
| `/sitemap.xml` | Public sitemap (`app/sitemap.ts`) |
| `/:orgSlug/:eventSlug/opengraph-image`, `/:orgSlug/i/:instanceId/opengraph-image` | Generated social share cards for events and occurrences |

## Health and scheduler APIs

| Method and route | Protection | Purpose |
| --- | --- | --- |
| `GET /api/health` | Public | Process liveness without database or Redis dependency |
| `GET /api/health/db` | `Authorization: Bearer $HEALTHCHECK_SECRET` | Database readiness check |
| `POST /api/internal/outbox` | `Authorization: Bearer $CRON_SECRET` | Deliver queued email and purge expired operational data |

Self-hosted Node.js instances run the outbox worker every minute. The endpoint remains available for an independent scheduler or manual recovery. Protected operational endpoints return a generic not-found response when authorization fails.

## Mutation endpoints

Most authenticated dashboard mutations are Next.js Server Actions under `app/actions/`, not conventional REST routes. They still require server-side authentication, role checks, validation, rate limiting, and audit behavior.

Organisation owners manage machine clients at `/dashboard/:orgSlug/settings/api`. This page requires a fresh human authentication before credential, scope, or client-state mutations.
