# Architecture

[Documentation index](README.md)

## Stack

- Next.js 16 App Router and React 19
- TypeScript
- PostgreSQL and Prisma ORM
- Auth.js with Prisma persistence
- Tailwind CSS, Radix UI primitives and lucide icons (`components/ui/*`), framer-motion for animation, and self-hosted Fontsource fonts
- Redis for distributed rate limiting and realtime ticket check-in pub/sub
- S3-compatible private object storage
- Nodemailer-backed transactional email
- sharp for image processing and certificate rendering, pdf-lib for post-event reports, and jose for mobile Google ID-token verification
- Vitest and Playwright

## Repository layout

| Path | Responsibility |
| --- | --- |
| `app/` | Pages, layouts, Server Actions, and route handlers |
| `components/` | Client and server UI components grouped by product area |
| `lib/` | Authentication, authorization, validation, RSVP logic, storage, email, rate limiting, and shared services |
| `lib/core/` | Mutation cores (check-in, RSVP lifecycle/admin/cancel, team registration, event crew, hackathon judging, broadcasts, programme delays, feedback settings, registration window, account profile and security) shared by Server Actions and `/api/mobile/v1` |
| `lib/mobile/` | Mobile API tokens, sessions, permissions, Zod schemas, and DTOs |
| `prisma/` | Data model and ordered production migrations |
| `scripts/` | Environment, schema, asset migration, and standalone-build helpers |
| `tests/` | Unit, PostgreSQL integration, and browser suites |
| `docs/` | Product and operational documentation |

## Request flow

```text
Browser / API client
        |
        v
Next.js proxy: rate limits + CSP nonce
        |
        +--> React Server Component / Server Action
        |          |
        |          +--> Auth.js session + permission checks
        |          +--> Zod validation
        |          +--> Prisma transaction
        |
        +--> Route handler
                   |
                   +--> monitoring + rate limit + validation
                   +--> domain service + Prisma
```

Server Actions are used for authenticated dashboard mutations. Public RSVP and feedback submissions use JSON route handlers. Authorization belongs on the server even when the UI hides an unavailable control.

The Yuyu mobile apps call `/api/mobile/v1` as ordinary users. Bearer tokens are looked up by SHA-256 digest in `MobileSession` (`lib/mobileAuth.ts`), bound to the user's `sessionVersion`, and every mutation calls the same `lib/core/*` function as the matching Server Action, so permission checks, transactions, rate limits, and audit are shared. Responses are strict DTOs; `docs/mobile-api.openapi.yaml` and its fixtures are checked against the Zod schemas and routes by `tests/unit/mobile-api-contract.test.ts`. See [Mobile API](MOBILE_API.md).

External applications authenticate under `/api/v1` with tenant-bound `ApiClient` credentials rather than Auth.js sessions. A route wrapper resolves the client organisation and scopes, then passes that context to explicit domain readers. Queries include the organisation predicate and responses are mapped through validated API DTOs rather than serialized Prisma models.

## Multi-tenancy and authorization

`Organisation` is the tenant boundary. Events, series, invitations, assets, and audit events resolve through an organisation. `Membership` connects a user to a tenant with an owner, admin, or member role. Permission helpers and action-specific checks enforce access before mutation.

The super-admin boundary is separate: access requires an authenticated email matching `SUPER_ADMIN_EMAIL`, and unauthorized requests behave as not found.

## Main data areas

- Identity: `User`, `Account`, `Session`, `VerificationToken`, and `MobileSession` (hashed mobile access and refresh tokens).
- Tenancy: `Organisation`, `Membership`, and `OrganisationInvite`; per-event `EventCollaborator` and `EventCollaboratorInvite` with exact `EventPermission` grants.
- Events: `Event` (including `listedPublicly` for listed approval-required events, an optional unique `shortCode`, the venue check-in station PIN fields, and the manual sign-up close snapshot `registrationManuallyClosedAt`/`registrationCutoffBeforeManualClose`/`registrationLeadBeforeManualClose`), `EventInvite`, `EventSeries`, `SeriesInvite`, and `EventInstance`.
- Event websites: `EventPage` (release flag `isPublished`, tagline, logo, accent) with `EventPageSection`, `EventHighlight`, `EventVenue`/`EventVenueRoom`, `EventScheduleTrack`, `EventSession`, `EventSpeaker`/`EventSessionSpeaker`, `EventSponsor`, `EventFaq`, `EventResource`, and `EventScheduleItem`.
- Registration: `RSVP`, registration forms, fields (with help text, placeholder, and validated `settings` JSON), and typed answers.
- Teams: `Event.registrationMode`, `teamMinSize`, `teamMaxSize` and `soloPolicy`; `Team` (status mirroring every member RSVP, unique per-event `nameKey`, join token, SHA-256 `manageTokenHash`, leader RSVP); `RSVP.teamId`; `TeamSeekerProfile` for solo registrants looking for a team; and `TeamJoinRequest` invitations and requests, at most one pending per team and RSVP. See [Team registration](TEAMS.md).
- Hackathon judging: `Event.submissionsEnabled`, `submissionsOpenAt`/`submissionsCloseAt`, `judgingStatus`, `judgesSeeAll`, `projectGalleryPublic` and `resultsPublishedAt`; `Submission` (exactly one of a unique `teamId` or `rsvpId`, enforced by a CHECK constraint, cascading with its team or RSVP); `SubmissionLink` (one SHA-256 token hash per solo RSVP); `JudgingCriterion`; `JudgeAssignment`; `JudgeScore` (unique per submission, judge, and criterion) and `JudgeReview` (unique per submission and judge); `EventAward` and `EventAwardWinner` (unique per award and place, and per award and submission); and the `JUDGE` value of `EventPermission`. See [Hackathon submissions, judging, and results](HACKATHON.md).
- Communications: `EventBroadcast` records each organiser email, including its chosen `design`; each recipient is a separate `OutboxMessage`.
- Communications: `EventBroadcast` records each organiser email, including its chosen `design`; each recipient is a separate `OutboxMessage`. `EventBroadcastDraft` holds one organiser's unsent Emails-tab composer per event (unique on event and user, private to that user, cascading with both); the dashboard send deletes it in the send transaction.
- Feedback: feedback forms, fields, responses, typed answers, and optional certificate linkage.
- Operations: `OutboxMessage`, `OperationalHeartbeat`, `AuditEvent`, `CheckInEvent`, `RsvpDeletionUndo`, and `Asset`.
- Check-in lists: `CheckInList` (per standalone event: `name`, `sortOrder`, `archived`, `requiresEntryCheckIn`; names unique per event among non-archived lists, ignoring case, through the partial index `CheckInList_eventId_active_name_key`), `CheckInListRecord` (one guest in one list: list, RSVP, actor, `checkedInAt`, `source` of `online`/`mobile-scan`/`mobile-manual`; unique on `listId`, `rsvpId`; undo deletes it), and the immutable `CheckInListEvent` history (`CHECKED_IN`/`CHECK_IN_UNDONE`). Deleting the event removes all three; deleting an RSVP removes its records and detaches its history (`rsvpId` set to null, like `CheckInEvent`); deleting a user nulls the actor. List history is a separate table rather than more `CheckInEvent` actions so that entry reports, check-in source counts and the mobile history never pick up list activity. `commitListCheckIn` (`lib/checkInListMutations.ts`) locks the RSVP row and share-locks the list, applies `gateListCheckIn` (`lib/checkInLists.ts`, which reuses the entry gate) and writes the record and history in one transaction; it never touches `RSVP.checkedInAt`, `CheckInEvent` or the realtime ticket channel. Removing a guest with undo keeps their list records in the undo snapshot and restores them.
- Instance administration: the singleton `InstanceSetting` holds the new-account policy, encrypted SMTP and Google SSO secrets, the encrypted operational alerts webhook URL with its enabled and include-warnings flags, and non-secret backup posture. It is readable and mutable only through the super-admin boundary.
- Machine access: `ApiClient`, `ApiClientScope`, and hashed, rotatable `ApiCredential` records.
- Outgoing webhooks: `WebhookEndpoint` (per organisation, at most 10; URL, subscribed event types, encrypted signing secret, enabled/auto-disabled state and failure counter) and `WebhookDelivery` (the durable queue and delivery log, one row per endpoint and event, unique on `endpointId`/`eventId`). See [Organisation webhooks](WEBHOOKS.md).

### Event publication

`Event.status` is the single publication switch. The event page's release flag, `EventPage.isPublished`, always mirrors `Event.status = PUBLISHED`: `createEvent`, `updateEvent`, and `publishEvent` (`app/actions/event.ts`) write both in one transaction, and `publishEvent` (the Overview **Publish event** button) upserts the page row so a draft without one is released too. Saving the event page for an event that has no page row creates it released exactly when the event is published. Public pages (`lib/publicEventAccess.ts`), RSVP (`lib/rsvpCore.ts`), and short links (`lib/shortLinkResolve.ts`) all require both. Migration `20260915000000_unify_event_publication` first aligned existing rows, and `20261021010000_realign_event_publication` repairs events that were published before `publishEvent` released the page.

### Team registration and capacity units

On a `TEAM` event `Event.capacity` counts units: each team and each solo RSVP is one unit. Every path that changes capacity (`reserveRsvp` in `lib/rsvpCore.ts`, `lib/rsvpCapacity.ts`, cancellation, organiser delete and restore, the capacity check in `updateEvent`) and every team mutation in `lib/core/teams.ts` takes the same `SELECT ... FOR UPDATE` lock on the `Event` row first, then counts with `countConfirmedUnits` (`lib/teamUnits.ts`). `INDIVIDUAL` events keep the plain confirmed-RSVP query. Team status changes update the `Team` row with a conditional `updateMany` guarded by the expected status and move every member RSVP in the same transaction, so each member's status always equals the team's. A team id from the browser is always re-read with its `eventId`, and leader authority (a management-token hash or the signed-in leader) is re-checked under the lock. Server Actions in `app/actions/teams.ts` and `app/actions/team-admin.ts` authenticate, rate limit, audit, and revalidate around these cores. The `team-created` and `team-member-added` outbox kinds carry capabilities and are deleted after delivery.

### Event crew

`lib/core/crew.ts` owns the crew ([Event crew](CREW.md)); `app/actions/crew.ts` authenticates, rate limits, audits, and revalidates around it. Each crew member owns one `CONFIRMED` RSVP with `isCrew` (database CHECK `RSVP_crew_shape`: event-bound, no team, confirmed). Adding a member takes the same `Event` row lock as capacity changes, so converting a solo registration cannot interleave with a registration. Every capacity count spreads `takesCapacity` (`lib/teamUnits.ts`) into its query, so crew are confirmed but never use a place.

### Hackathon judging

`lib/core/judging.ts` owns every submission, judging, and results rule; Server Actions (`app/actions/submissions.ts`, `app/actions/judging.ts`, `app/actions/judging-admin.ts`), the pages, and `GET /api/exports/events/:eventId/judging` authenticate, rate limit, and revalidate around it. Entrant authority is an `EntrantAuth` proof (a team management-token hash, a signed-in team member, the signed-in owner of a solo RSVP, or a submission-link hash) re-checked inside the write transaction. Entrant and judge writes take `FOR SHARE` on the `Event` row (entrants then lock their `Team` or `RSVP` row, so one entrant's writes serialise); organiser changes take `FOR UPDATE`. Closing the window, freezing the rubric, or closing judging therefore serialises with in-flight saves, and the window is compared with server time inside the transaction. Score and review writes are `INSERT ... ON CONFLICT` upserts on their unique keys.

`lib/judgingAccess.ts` resolves the two roles from the organisation slug: *can judge* (organisation owner/admin or a `JUDGE` grant on that event) and *can manage judging* (owner/admin only). `JUDGE` never satisfies another `canAccessEvent` permission, a judge-only collaborator sees only the judging workspace on the dashboard (`isJudgeOnly`), and the mobile organiser API ignores judge-only grants. Judges never see an entrant whose RSVP their own account owns. Result scores are pure functions in `lib/judgingScore.ts`; public, judge, entrant, and organiser views go through `lib/judgingDto.ts`. The public results and gallery pages first apply the event page's access rules (`lib/publicJudgingPage.ts`, built on `resolvePublicEventAccess`) and only then call the loaders. The entrant pages (`/submit/:token`, `/account/submissions/:eventId`, the team page section, and the ticket card) are capability pages like the ticket and team pages: the entrant proof stands in for the invite list, but they exist only while the event is `PUBLISHED` and its website released (`loadEntrantSubmission`). The `submission-received`, `submission-link` (a capability, deleted after delivery), and `results-published` outbox kinds deliver the emails; the core writes the spec's audit events in the same transaction as each change.

Refer to `prisma/schema.prisma` for the authoritative fields, constraints, indexes, and cascading behavior.

## Background and scheduled work

Request handlers enqueue transactional messages in `OutboxMessage`; they do not wait for SMTP delivery. Every self-hosted Node.js instance starts a singleton one-minute worker that claims and sends a batch, retries failures, purges expired operational records, and updates a one-row `OperationalHeartbeat`. Queue row claims keep concurrent replicas safe. The same pass delivers organisation webhooks (`lib/webhooks/delivery.ts`): rows are claimed with `FOR UPDATE SKIP LOCKED`, posted with a pinned, SSRF-checked connection, retried with jittered backoff (8 attempts over about a day), and a failing endpoint is switched off after 20 consecutive failures; a webhook failure never fails the email pass. Webhook events are emitted at the commit points (`reserveRsvp` in `lib/rsvpCore.ts`, `confirmRsvpWithinCapacity`, the RSVP lifecycle/cancel/admin cores, `commitCheckInProjection` and `commitUndoCheckInProjection`, the event publish paths in `app/actions/event.ts`, and `submitFeedback`) after their transactions commit, through `emitWebhookEvent` (`lib/webhooks/emit.ts`), which only inserts queue rows in the background and never throws. The protected `POST /api/internal/outbox` endpoint remains available as an external scheduler or recovery trigger for both.

## Realtime ticket check-in

When an RSVP transitions to checked in, `commitCheckInProjection` (`lib/checkInMutations.ts`, the single write path for online scans, manual check-in, offline-sync replay, venue stations, and mobile app check-ins) publishes a `checkedInAt` message after its transaction commits through `lib/ticketCheckInEvents.ts`. Channels are keyed by RSVP id, never by the ticket token. With `REDIS_URL` set, messages fan out to every replica over Redis pub/sub (one lazily created subscriber connection per process, reference-counted per channel); without Redis an in-process EventEmitter shared through `globalThis` is used (Next.js can load the module more than once per process, for example in separate Server Action and route-handler bundles), which only reaches viewers on the same instance. Production requires `REDIS_URL`, so multi-replica deployments always use pub/sub. Publishing is fire-and-forget and never fails a check-in. The ticket page listens via `GET /api/ticket/:token/events` (SSE) and can fall back to `GET /api/ticket/:token/status`; both return only the check-in state. Delivery is best effort: while the stream is open the client also re-reads the status every 15 seconds, and a dropped message is recovered on that check, the next reconnect, or a return to the tab. Status and stream requests are rate limited per client IP (`ticketStatus`, `ticketEvents`), and each process caps open ticket streams. Reverse proxies must not buffer `text/event-stream` responses: the route sends `X-Accel-Buffering: no`, and nginx-style proxies should also set `proxy_buffering off` for `/api/ticket/`. Allow idle reads of at least 30 seconds (the stream sends a ping every 25 seconds and closes after 10 minutes).

## Instance service configuration

Super-admins with a current TOTP step-up can configure SMTP, Google SSO, backup posture, and an operational alerts webhook (`lib/opsAlerts.ts`, fed by `instrumentation.ts`) at `/super-admin/settings`. These are read from PostgreSQL per send or sign-in; there is no separate worker process, because each app process runs the outbox worker and alert forwarding. Instance-managed values take precedence over legacy environment fallbacks. SMTP and Google client secrets are encrypted at rest with an AES-GCM key domain-separated from `MFA_ENCRYPTION_KEY`; the application never renders stored secrets back to the browser. Backup posture is display-only—backup execution, encryption, retention enforcement, and restore access remain infrastructure responsibilities.

## Storage

Asset metadata lives in PostgreSQL. Production file bytes live in a private S3-compatible bucket and are served through the application-controlled upload route. Local development can retain database blobs as a fallback. Production startup requires S3 configuration.

## Security headers and rendering

The proxy generates a fresh Content Security Policy nonce for application-page requests. The root layout waits for a real request so Next.js can attach the nonce to framework scripts. Other response headers include HSTS in production, frame denial, content-type protection, a restricted permissions policy, and a strict referrer policy.

This per-request nonce makes application pages dynamically rendered. There is deliberately no root `app/loading.tsx`: a root Suspense boundary would stream a 200 before `notFound()` or `redirect()` run, breaking real 404s and the short-link 307. For the same reason no dashboard `loading.tsx` wraps a page whose access check could fail: each loading screen sits below a layout that awaits that check first (`lib/dashboardGuards.ts`), and route groups such as `app/dashboard/[orgSlug]/(overview)` scope a screen to one page (`tests/unit/dashboard-loading-boundaries.test.ts`). Static metadata endpoints such as `robots.txt` and `sitemap.xml` remain static.

## Deployment shape

`next.config.ts` produces standalone output. The Docker image copies the standalone server, public assets, static chunks, and Prisma migrations into a non-root runtime image. PostgreSQL, Redis, S3, SMTP, TLS termination, scheduling, monitoring, and backup services are external production dependencies.
