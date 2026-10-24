# Mobile API v1

[Documentation index](README.md)

`/api/mobile/v1` is the user-authenticated REST API used by the Yuyu mobile
apps (Android and iOS). It covers only phone-first tasks: signing in, an
attendee's own registrations and tickets, and organiser day-of work (check-in,
guest approval, emails, live programme delays, feedback open/close, closing
sign-ups).

The machine-readable contract is [`mobile-api.openapi.yaml`](mobile-api.openapi.yaml)
(OpenAPI 3.1), with example responses in [`mobile-api-fixtures/`](mobile-api-fixtures/).
`tests/unit/mobile-api-contract.test.ts` fails if the spec, the fixtures, the
server's strict response schemas (`lib/mobile/schemas.ts`) or the implemented
routes drift apart.

It is **not** the machine API (`/api/v1`). Machine clients are tenant-bound
bearer identities; mobile sessions are individual Yuyu users whose permissions
are resolved exactly as on the website. Every mobile mutation calls the same
core function as the matching Server Action (`lib/core/*`), so organisation
isolation, role and event-permission checks, RSVP capacity transactions, rate
limits, emails and audit behaviour are identical.

## Conventions

- JSON in and out. Every response carries `Cache-Control: no-store`.
- Authenticated routes need `Authorization: Bearer <accessToken>`.
- Success: `{ "ok": true, "data": ... }`. Failure:
  `{ "ok": false, "error": { "code": "...", "message": "UI-safe text", "fieldErrors"?: { "field": ["msg"] } } }`.
- Codes: `INVALID_REQUEST` (400), `UNAUTHENTICATED` (401: missing, expired,
  revoked or version-stale access token — refresh once, then sign out),
  `MFA_REQUIRED` (401, sign-in only), `EMAIL_VERIFICATION_REQUIRED` (403,
  sign-in only), `FORBIDDEN` (403), `NOT_FOUND` (404; also every id outside
  what the caller can see, including other organisations'), `CONFLICT` (409),
  `NEEDS_FORCE` (409, check-in status override available), `RATE_LIMITED`
  (429, with `Retry-After`), `TEAM_REQUIRED` (409, `POST /rsvp` on an event
  that registers teams only), `INTERNAL_ERROR` (500).
- Error messages are the same UI-safe texts as the website (for example
  "Only pending requests can be approved."); show them as-is.
- Timestamps are ISO-8601 UTC strings. Event times come with the IANA `timezone`.
- Image and link URLs are absolute (resolved against `NEXT_PUBLIC_BASE_URL`, or
  the request origin when unset). Uploaded images are served by
  `/api/uploads/...` as public, re-encoded derivatives; no token is needed.
- Collections with `nextCursor` use opaque cursors: send it back unchanged;
  `null` means the end.
- Never log or persist access tokens, refresh tokens, ticket tokens or station
  PINs. Ticket tokens are returned only to their owner, and to holders of the
  event `CHECK_IN` permission through the offline roster.
- Limits: the proxy's per-IP API limit, 300 authenticated requests per minute
  per user, plus each operation's own website limit (check-in, RSVP,
  broadcasts, sign-in…).

## Sessions

Mobile sessions are rows in `MobileSession`; only SHA-256 digests of tokens are
stored. Access tokens (`yma_…`) live 15 minutes, refresh tokens (`ymr_…`) 60
days and rotate on every refresh. If a refresh succeeded but its response was
lost, retrying with the previous refresh token within 30 seconds of the
rotation gets a plain `UNAUTHENTICATED` without revoking anything (the app
should then use the newest tokens it holds, or sign in again). Presenting a
rotated-away refresh token after that window revokes the whole session (it was
copied). Each session is
bound to the user's `sessionVersion`: a password change, password reset, MFA
enable/disable or "sign out everywhere" bumps it and invalidates every mobile
session together with web sessions (the rows are also marked revoked).
Sign-in, sign-out and refresh-token reuse are audited
(`MOBILE_SIGNED_IN`, `MOBILE_SIGNED_OUT`, `MOBILE_REFRESH_TOKEN_REUSED`)
without token values. Expired and long-revoked rows are removed by the
retention job.

`deviceName` is free text and `platform` (`"android"` or `"ios"`) is optional;
both are stored only for support and audit.

### `POST /auth/login`

```json
{ "email": "a@b.c", "password": "…", "totp": "123456", "deviceName": "Pixel 9", "platform": "android" }
```

`totp` is optional and accepts an authenticator code or a recovery code. Uses
the same verifier as web sign-in (`lib/credentialsAuth.ts`): per-email and
per-IP limits, equal-work bcrypt comparison, inbox verification and MFA.
Errors: `INVALID_REQUEST` with "Email or password is incorrect." for any bad
credential or malformed body, `MFA_REQUIRED` only after a correct password,
`EMAIL_VERIFICATION_REQUIRED` for an unverified password account,
`RATE_LIMITED`.

Success → `Session`:

```json
{
  "accessToken": "yma_…", "accessTokenExpiresAt": "…",
  "refreshToken": "ymr_…", "refreshTokenExpiresAt": "…",
  "user": { "id": "…", "name": "…|null", "email": "…|null", "imageUrl": "…|null", "emailVerified": true, "mfaEnabled": false }
}
```

### `POST /auth/google`

`{ "idToken": "…", "deviceName": "…", "platform": "ios" }`. The server verifies
the Google ID token's signature against Google's JWKS, the issuer
(`accounts.google.com`), expiry, and that `aud` is the instance's web Google
client id or one of `GOOGLE_MOBILE_CLIENT_IDS` (Android and iOS OAuth client
ids). When `aud` is the web client id (the usual "server client id" flow) and
`GOOGLE_MOBILE_CLIENT_IDS` is configured, the token's `azp` must be one of
those mobile ids. Requires `email_verified: true`. Applies the same linking and
account-creation policy as web Google sign-in (`lib/googleSignIn.ts`); new
Google links keep identity fields only. Success → `Session`.
`FORBIDDEN` when Google sign-in is not configured on the instance, account
creation is disabled, or linking is refused (an unverified password account
with that email). `UNAUTHENTICATED` when the token fails verification.

### `POST /auth/refresh`

`{ "refreshToken": "ymr_…" }` → `Session` with new access **and** refresh
tokens. `UNAUTHENTICATED` for unknown, expired, revoked, reused or
version-stale tokens (indistinguishable). Rate limited per IP.

### `POST /auth/logout` (auth)

Revokes the current mobile session → `null`.

### `POST /auth/logout-all` (auth)

Same transaction as "Sign out everywhere" on the web: bumps `sessionVersion`,
revoking all web and mobile sessions, and is audited as `SESSIONS_REVOKED`.
Unlike the web it does not require a sign-in within the last 10 minutes,
because it can only reduce access (it signs this device out too).

### `GET /auth/config` (public)

`{ "instanceName": "Yuyu", "googleSignIn": { "enabled": true, "webClientId": "…|null" }, "signupEnabled": true, "baseUrl": "https://…" }`.
Google sign-in is enabled when web Google SSO is configured; use `webClientId`
as the server client id when requesting an ID token. Never includes secrets.
Account creation and password reset happen on the website.

## Me

### `GET /me` (auth)

`{ "user": User, "organisations": [OrgSummary], "collaborations": [{ "organisation": { "slug", "name" }, "eventId", "eventTitle", "permissions": ["CHECK_IN", …] }] }`

`OrgSummary = { "id", "slug", "name", "logoUrl|null", "role": "OWNER|ADMIN|MEMBER" }`.
Collaborations list standalone-event grants only.

### `PATCH /me` (auth)

`{ "name": "…" }` → `User`. Same validation, rate limit and audit as the web
profile form; the current profile image is kept.

### `GET /me/registrations` (auth)

Built from the same records as the account Registrations page
(`loadAccountRegistrationRecords`: own RSVPs only, 50 upcoming and 50 past).

```json
{
  "upcoming": [Registration], "past": [Registration],
  "certificates": [{ "eventTitle", "organisationName", "issuedAt", "certificateUrl" }]
}
```

`Registration = { "rsvpId", "status", "checkedInAt|null", "registeredAt", "canCancel", "ticketToken|null" (only for CONFIRMED), "event": EventSummary, "instanceId|null" }`.
For a recurring-series occurrence `instanceId` is set and `event` describes the
series (its `id`/`slug`, the occurrence's times, no cover image).

### `POST /me/registrations/:rsvpId/cancel` (auth)

Cancels the caller's own RSVP with the website's cancel rules (refused after
check-in, promotes the waitlist, queues emails, audited) → `null`.
`NOT_FOUND` for anyone else's RSVP.

## Public (no auth required; a valid bearer, if sent, identifies the attendee; an invalid one is 401)

`EventSummary = { "id", "slug", "title", "coverImageUrl|null", "startDateTime", "endDateTime", "timezone", "location", "mapLinkUrl|null", "isOnline", "accentColor|null", "status", "organisation": { "slug", "name", "logoUrl|null" } }`

### `GET /public/discover?cursor=&limit=`

Published, publicly listed standalone events (`listedEventAudienceWhere`) with
a released page that have not ended, soonest first. `limit` 1–50 (default 20).
→ `{ "events": [EventSummary], "nextCursor": "…|null" }`.

### `GET /public/search?q=`

The same predicate and 48-result cap as `GET /api/search` →
`{ "events": [EventSummary], "nextCursor": null }`. Both routes use the search
rate limit.

### `GET /public/short/:code`

Resolves an event short link with the same rule and per-IP limit as
`/:shortCode` → `{ "orgSlug", "eventSlug" }`. Unknown, unreleased and
rate-limited codes are the same `NOT_FOUND`. Publishing an event releases its
page in the same transaction, so a Live event's code resolves at once; clients
should not cache a `NOT_FOUND` for long, because events published before that
fix return it until the `20261021010000_realign_event_publication` migration
runs.

### `GET /public/events/:orgSlug/:eventSlug`

Applies the public event access rule (`resolvePublicEventAccess`): draft,
hidden and unreleased events are `NOT_FOUND`; invite-only events need a
signed-in user invited with their verified email. Only published website
content is returned.

```json
{
  "event": EventSummary & { "description", "tags", "capacity|null", "showRegistrationCount", "confirmedCount|null", "privacyType", "registrationOpen", "registrationFull", "registrationClosedReason|null", "onlineUrl": null },
  "registration": { "requiresApproval": false, "fields": [RegistrationField], "myRsvp": { "rsvpId", "status", "ticketToken|null" } | null },
  "schedule": [{ "trackName|null", "sessions": [{ "id", "title", "startDateTime", "endDateTime", "delayMinutes", "room": null, "speakers": ["name"] }] }],
  "speakers": [{ "name", "title|null", "photoUrl|null" }],
  "feedbackOpen": false
}
```

`confirmedCount` is null when the organiser hides counts. Schedule times
already include live delays; `delayMinutes` says how late that session is
running. `onlineUrl` and `room` are always null (Yuyu stores neither).

`RegistrationField = { "id", "key", "label", "type": "TEXT|TEXTAREA|EMAIL|PHONE|SELECT|MULTI_SELECT|RADIO|CHECKBOX|NUMBER|DATE", "required", "helpText|null", "placeholder|null", "options": ["…"], "settings": { "minLength?", "maxLength?", "min?", "max?", "minDate?", "maxDate?", "maxSelections?", "allowOther?" }, "showIf": { "fieldKey", "values": ["…"] } | null }`

This mirrors the stored field settings exactly: show the field when the earlier
field `fieldKey` is answered with any of `values` (CHECKBOX answers count as
"Yes"/"No"). The server remains the authority and drops answers hidden by logic.

### `POST /rsvp`

The same body, service (`submitRsvpCore`) and IP/email limits as
`POST /api/rsvp`: `{ "orgSlug", "eventSlug" | "eventInstanceId", "name", "guestEmail", "answers": { "<field key>": value } }`.
With a valid bearer the signed-in flow applies (`guestEmail` is ignored and
`name` is needed only if the account has none); otherwise the guest flow
(`name` and `guestEmail` required; invite-only events refuse guests).
Success: `{ "rsvpId", "status": "CONFIRMED|WAITLISTED|PENDING_APPROVAL", "ticketToken|null" }`,
with `ticketToken` only when `CONFIRMED`.

Team events ([Team registration](TEAMS.md)): the app cannot create or join a
team yet, so this endpoint always registers solo. That works when the event
allows solo registrants (the registration counts as one unit against
capacity); an event that registers teams only answers `TEAM_REQUIRED` (409).
Send people to the event website to create a team or open a team join link.
Any `team` field in the body is ignored.

### `GET /public/events/:orgSlug/:eventSlug/feedback`

`{ "title", "intro": null, "thankYouMessage", "open": true, "certificatesEnabled", "fields": [RegistrationField] }`
or `NOT_FOUND` unless the event is published and its form is open (as the web
feedback page). Submit with the existing `POST /api/feedback`; its response
contains the certificate token when one is issued.

### Existing web endpoints reused unchanged

These keep their own response formats (not the mobile envelope):

- `GET /api/ticket/:token/status` and `GET /api/ticket/:token/events` (SSE) for the live ticket.
- `POST /api/feedback`.
- `GET /api/feedback/certificate/:token` (certificate JPEG).
- `POST /api/check-in/station` (cookie-based station proof; keep a per-station cookie jar).

## Organiser (auth)

All routes take `:orgSlug` and resolve the organisation server-side. An event
is visible when the caller is a member of the organisation or holds a
collaborator grant on that event (as on the event dashboard); anything else,
including an id from another organisation, is `NOT_FOUND`. A visible event
without the needed permission is `FORBIDDEN`.

`EventPermissions = { "checkIn", "manageRegistrations", "sendEmails", "schedule", "manageFeedback", "manageRegistrationWindow" }`,
derived exactly as the event dashboard does: `checkIn` = organisation
OWNER/ADMIN or the event `CHECK_IN` grant; `schedule` = OWNER/ADMIN or
`PUBLISH_AND_SCHEDULE`; `manageRegistrations`, `sendEmails`, `manageFeedback`
and `manageRegistrationWindow` = organisation OWNER/ADMIN (the website's email,
feedback-settings and event-edit actions are admin-only). The shared RSVP cores
also accept the event's `MANAGE_REGISTRATIONS` grant, as the web guest list
does, but `manageRegistrations` stays admin-only in this contract version (see
[Permissions](PERMISSIONS.md#mobile-api)). The flags only hide controls; every
mutation is re-checked server-side.

`EventCounts = { "confirmed", "waitlisted", "pending", "checkedIn", "capacity|null", "capacityUsed" }`,
returned only when the caller has `manageRegistrations` or `checkIn`, else `null`.
`capacityUsed` is what `capacity` is compared with: it equals `confirmed` on
individual events, and on team events counts confirmed teams plus confirmed
solo registrants (`confirmed` stays a count of people). Show
`capacityUsed / capacity` for fill, not `confirmed / capacity`.

### `GET /orgs/:orgSlug/events?filter=upcoming|past|all`

Members see the organisation's standalone events (any status); collaborators
only their granted events. Upcoming is soonest first, the others newest first,
up to 200.
→ `{ "events": [EventSummary & { "counts": EventCounts|null, "myPermissions": EventPermissions }] }`.

### `GET /orgs/:orgSlug/events/:eventId`

`{ "event": EventSummary & { "privacyType", "registrationOpen", "registrationClosesAt|null", "registrationClosedReason|null", "registrationManuallyClosed", "feedbackOpen", "eventUrl", "shortUrl|null" }, "counts": EventCounts|null, "myPermissions": EventPermissions }`
(`registrationManuallyClosed`: sign-ups were closed from an app and can be reopened there).

### Guests

`Guest = { "rsvpId", "displayName", "email|null", "status", "checkedInAt|null", "registeredAt", "isGuest" }`
(`isGuest`: the registration has no Yuyu account). Guest rows never include
ticket tokens.

- `GET …/guests?status=ALL|CONFIRMED|WAITLISTED|PENDING_APPROVAL|REJECTED&checkedIn=any|yes|no&q=&cursor=&limit=`
  (limit 1–100, default 50, newest first) → `{ "guests": [Guest], "nextCursor" }`.
  Requires `manageRegistrations` or `checkIn`.
- `GET …/guests/:rsvpId` → `Guest & { "answers": [{ "label", "value" }] }` (same permission).
- `POST …/guests/:rsvpId/approve` · `…/reject` · `…/promote` → the updated
  `Guest`. Same rules, capacity transaction, emails and audit as `approveRsvp`
  / `rejectRsvp` / `promoteFromWaitlist` (organisation admins).
- `POST …/guests/:rsvpId/reaccept` → the updated `Guest`. Reverses a decline
  (as `reacceptRsvp`; organisation admins): only a `REJECTED` guest, and only
  while the event is open. The guest becomes `CONFIRMED` when there is room
  and `WAITLISTED` otherwise (check the returned `status`), with the approval
  or waitlist email and a `RSVP_REACCEPTED` audit event. Any other status is
  `CONFLICT` ("Only declined registrations can be re-accepted."). Older apps
  that do not call it are unaffected; `approve` still accepts only pending
  requests.
- `POST …/guests` `{ "name", "email", "answers"? }` → `201` `Guest` (as `addManualRsvp`).
- `DELETE …/guests/:rsvpId` → `{ "undoId" }` (as `deleteRsvp`; the undo lasts five minutes).
- `POST …/guests/restore` `{ "undoId" }` → `null` (as `restoreRsvp`). `NOT_FOUND`
  unless the undo was created by the caller for this same event.

### Check-in (the event `CHECK_IN` permission, checked by the shared core)

`CheckInResult = { "rsvpId", "displayName", "email|null", "status", "alreadyCheckedIn", "checkedInAt|null", "checkInDetails": [{ "label", "value" }], "registrationDetails": [{ "label", "value" }] }`
`CheckInPreview = CheckInResult & { "gate": { "ok": true } | { "ok": false, "reason", "needsForce", "blocked"? } }`

- `POST …/check-in/preview` `{ "rawInput": "<QR payload, ticket URL or typed code>" }` or `{ "rsvpId" }` → `CheckInPreview`.
- `POST …/check-in` `{ "rawInput"?: "…", "rsvpId"?: "…", "force": false }`
  (exactly one of `rawInput`/`rsvpId`) → `CheckInResult`; `NEEDS_FORCE` when a
  waitlist override is possible (retry with `force: true`).
- `POST …/check-in/undo` `{ "rsvpId" }` → `null`.
- `GET …/check-in/lookup?q=` (min 2 chars, max 12 rows) → `{ "rows": [Guest] }`.
  Matches guest names and emails and, on team events, team names (teams of the
  same event only, listing their members). `Guest` has no team field yet.
- `GET …/check-in/stats` → `{ "confirmed", "checkedIn", "recent": [{ "rsvpId", "displayName", "checkedInAt" }] }` (ten latest).
- `GET …/check-in/roster` → `{ "generatedAt", "rows": [Guest & { "ticketToken", "checkInDetails", "registrationDetails" }] }`
  (as `downloadOfflineCheckInRoster`: confirmed, waitlisted and pending). Keep it
  in encrypted storage and delete it after the event.
- `POST …/check-in/sync` `{ "checkIns": [{ "rsvpId", "checkedInAt", "force", "clientMutationId"? }] }` (1–500)
  → `{ "syncedIds", "alreadyCheckedInIds", "failed": [{ "rsvpId", "error" }] }`
  (as `syncOfflineCheckIns`, same operating-window rule).

All check-in writes go through `commitCheckInProjection` /
`commitUndoCheckInProjection`, so the live ticket tears off exactly as for web
check-ins. History sources: `mobile-scan` (by `rawInput`), `mobile-manual` (by
`rsvpId`, and undo), `offline-sync`.

### Emails (organisation admins, as on the web)

- `GET …/broadcasts/meta` → `{ "templates": [{ "id", "group", "name", "description", "subject", "bodyHtml", "audience": { "statuses", "attendance" } }], "designs": [{ "id", "label", "description" }], "placeholders": ["{{name}}", …], "history": [{ "id", "subject", "design", "audience": { "statuses", "attendance" }, "recipientCount", "sentAt", "bodyHtml" }] }` (20 latest).
- `POST …/broadcasts/count` `{ "statuses": [...], "attendance": "ANY|CHECKED_IN|NOT_CHECKED_IN" }` → `{ "count" }`.
- `POST …/broadcasts/preview` `{ "subject", "body", "design" }` → `{ "subject", "html", "text" }`
  (server-rendered with example values and absolute image URLs; show it in a
  web view with JavaScript disabled).
- `POST …/broadcasts/test` `{ "subject", "body", "design" }` → `{ "to" }` (the caller's own verified inbox).
- `POST …/broadcasts` `{ "statuses", "attendance", "subject", "body", "design" }` → `201` `{ "broadcastId", "recipientCount" }`.

`design` is one of `classic`, `minimal`, `accent`, `photo`, `letter` (default
`classic`). Bodies are sanitised on the server with `sanitizeBroadcastHtml`;
editors should produce only the supported subset (p, strong, em, h2, h3, ul,
ol, li, blockquote, a, a.cta, br). Apps implement a short undo by delaying the
send call client-side.

### Day-of controls

- `GET …/schedule` (requires `schedule`) → `{ "tracks": [{ "id|null", "name", "sessions": [{ "id", "title", "startDateTime", "endDateTime", "delayMinutes" }] }] }`.
  Planned times and every session's stored delay (any visibility).
- `POST …/schedule/sessions/:sessionId/delay` `{ "delayMinutes": 0..1440 }` → `null`
  (as `setEventSessionDelay`; requires `PUBLISH_AND_SCHEDULE` or organisation admin).
- `POST …/feedback/state` `{ "open": bool }` → `{ "open" }`. Saves through the
  shared feedback-settings function with every other setting unchanged;
  organisation admins only. Opening needs at least one question (`CONFLICT` otherwise).
- `POST …/registration/state` `{ "open": bool }` → `{ "registrationOpen", "registrationClosesAt|null", "registrationClosedReason|null", "registrationManuallyClosed" }`.
  Closing stores the organiser's configured cutoff (fixed time or lead
  minutes) and sets `registrationClosesAt` to the earlier of now and the event
  start, so the event still satisfies the website's "close on or before the
  start" rule. Reopening is allowed only after such a close
  (`registrationManuallyClosed: true`, otherwise `CONFLICT`) and restores the
  stored cutoff exactly; if that cutoff has itself passed, the response says
  `registrationOpen: false` with the reason. Saving the event form on the
  website discards the stored cutoff (the form's value wins). Organisation
  admins only (the same permission as editing the event on the web), rate
  limited, revalidated and audited as `EVENT_REGISTRATION_CLOSED` /
  `EVENT_REGISTRATION_REOPENED`.

## App links

Both association files are served without redirects and claim nothing until
configured:

- `GET /.well-known/assetlinks.json` — Android App Links for package
  `com.twilighty.yuyu`, from `ANDROID_APP_SHA256_CERT_FINGERPRINTS`
  (comma-separated `AA:BB:…` SHA-256 signing-certificate fingerprints); `[]`
  when unset. It only proves the domain; the app's manifest decides the paths.
- `GET /.well-known/apple-app-site-association` — iOS Universal Links for
  bundle `com.twilighty.yuyu`, served as `application/json` with no file
  extension, from `APPLE_APP_IDS` (comma-separated `TEAMID.com.twilighty.yuyu`);
  `{ "applinks": { "details": [] } }` when unset. It uses `components`, with the
  exclusions below listed before the claimed paths.

Both apps should open exactly these paths:

| Claimed | Meaning |
| --- | --- |
| `/ticket/*` | Attendee ticket |
| `/*/*/feedback` | Event feedback form |
| `/*/*` | Event page (`/:orgSlug/:eventSlug`) |

Never claimed (they stay in the browser):

`/api/*`, `/_next/*`, `/.well-known/*`, `/dashboard` and `/dashboard/*`,
`/account` and `/account/*`, `/super-admin`, `/super-admin/*`,
`/super-admin-mfa`, `/login`, `/reset-password`, `/verify-email` (and their
sub-paths), `/join/*`, `/embed/*`, `/*/*/check-in` (the venue kiosk),
`/*/i/*` (series occurrences), `/*/*/schedule`, `/*/*/sessions/*` and
`/*/*/speakers/*`.

Event short links (`/:shortCode`, seven characters with at least one uppercase
letter) are **not** claimed: Apple's patterns cannot require the uppercase
letter, so a `/???????` pattern would also capture seven-character
organisation pages. A short link opens the website, which redirects to the
event page; apps that receive a short code another way can resolve it with
`GET /public/short/:code`.

For the Android manifest, declare the three claimed shapes (for example
`android:pathPrefix="/ticket/"` and `android:pathAdvancedPattern` entries for
`/[^/]+/[^/]+` and `/[^/]+/[^/]+/feedback`), and in the activity reject the
excluded first segments (`api`, `_next`, `.well-known`, `dashboard`,
`account`, `super-admin`, `super-admin-mfa`, `login`, `reset-password`,
`verify-email`, `join`, `embed`) and second segment `i` by handing the URL
back to the browser, since manifest filters cannot express exclusions.
