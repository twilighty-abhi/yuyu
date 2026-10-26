# Security model

[Documentation index](README.md)

This page documents implemented controls and security boundaries. It is not a substitute for an external penetration test, infrastructure review, or jurisdiction-specific privacy assessment.

## Authentication

- Passwords are bcrypt hashes and are never stored or logged in plaintext. New passwords require at least 12 characters and must fit bcrypt’s 72-byte UTF-8 limit; existing passwords remain usable for sign-in.
- Auth.js sessions include a user `sessionVersion`; incrementing it invalidates issued sessions.
- Password reset uses expiring verification tokens and the transactional outbox.
- Password accounts require a one-time, expiring inbox-verification link before sign-in or event creation. Tokens are stored only as hashes and consumed once.
- Credential users can enable TOTP MFA and receive one-use recovery codes. TOTP use is claimed atomically in PostgreSQL, so a code cannot be replayed across replicas or between login and super-admin step-up. Wait for the next authenticator code when completing consecutive challenges. MFA enrollment is single-use, bound to the account session version, and cannot replace an active authenticator.
- TOTP seeds are encrypted with AES-256-GCM using `MFA_ENCRYPTION_KEY`; recovery codes are stored as keyed hashes. Super-admin SMTP and Google client secrets, and the operational alerts webhook URL, are separately domain-encrypted from that key and never rendered back to the browser (only the webhook host is shown). `scripts/check-instance-secrets.mjs` verifies that the current key can decrypt them without printing values, ciphertexts, or user identifiers.
- Sensitive account operations require recent authentication, revoke existing sessions, invalidate pending MFA setup, and write audit events. Password changes also invalidate outstanding reset links. A completed inbox password reset verifies that email while preserving any enabled MFA. Revoked JWTs return an anonymous session and are cleared by Auth.js.
- The super-admin panel requires a second, fresh TOTP step-up verification even after a normal authenticated session. Its signed, HttpOnly proof lasts 10 minutes and is bound to the user/session version.
- Google OAuth security, including MFA, is governed by the linked Google account. Linking to a password account requires that account’s email to be verified first; an unverified account must use inbox password recovery before linking. New Google links retain only provider identity fields, not reusable access/refresh/ID tokens. Previously stored provider tokens are not retroactively purged.
- Super-admins with a fresh TOTP proof can disable new password and Google account creation; existing users can continue to sign in.
- External applications use high-entropy, tenant-bound API credentials under `/api/v1`; raw secrets are displayed once and only SHA-256 digests are stored.

## Mobile sessions

- The Yuyu mobile apps (Android and iOS) authenticate as ordinary users under `/api/mobile/v1`; they are never machine clients and never receive organisation-wide credentials.
- Password sign-in uses the web verifier (`lib/credentialsAuth.ts`): the same per-account and per-IP limits, equal-work bcrypt, inbox-verification gate, and MFA/recovery-code consumption. Google sign-in verifies the ID token's signature against Google's JWKS, issuer, expiry, audience (web client id or `GOOGLE_MOBILE_CLIENT_IDS`; a web-audience token must carry a configured mobile `azp` when that list is set) and `email_verified`, then applies the web linking and account-creation policy (`lib/googleSignIn.ts`).
- Access tokens (15 minutes) and refresh tokens (60 days) are 32 random bytes; only SHA-256 digests are stored in `MobileSession`. Refresh tokens rotate on every use. Replaying the previous refresh token within 30 seconds of a rotation (a lost response) is refused without revoking; replaying a rotated token after that revokes the session. All authentication failures return one generic 401.
- Every session records the user's `sessionVersion` and is rejected once it changes, so password change/reset, MFA enable/disable and "sign out everywhere" revoke mobile sessions together with web sessions; those transactions also mark the rows revoked.
- Mobile routes resolve the organisation and event server-side, return `NOT_FOUND` for events outside the caller's dashboard access (including other organisations'), and call the same `lib/core/*` functions as the Server Actions for every mutation, so role checks, capacity transactions, rate limits and audit are shared. Responses are strict DTOs: no credential hashes, MFA material, or other people's ticket tokens; ticket tokens go only to their owner and, in the offline roster, to `CHECK_IN` holders.
- Sign-in, sign-out and refresh-token reuse are audited without token values. Mobile API traffic has a per-user limit in addition to the proxy IP ceiling.

## Authorization and tenancy

- Organisation membership is the tenant boundary.
- Owner/admin/member permissions are checked inside Server Actions and server-rendered pages.
- Hiding a control in the UI is never treated as authorization.
- Super-admin access is checked server-side against `SUPER_ADMIN_EMAIL` and fails as not found. Each super-admin page calls `requireSuperAdminMfa()` itself, because a layout check does not re-run on client navigation; a unit test fails if any page omits it.
- Leaving an organisation from `/account/organisations` removes only the caller's own membership. It locks the organisation row and refuses to remove the last owner, and is audited as `ORGANISATION_MEMBER_LEFT`.
- Database foreign keys and uniqueness constraints provide a second integrity layer.
- Machine clients resolve their organisation from the authenticated credential and require an explicit endpoint scope. Caller-supplied organisation identifiers never select the tenant.
- Event collaborators are scoped to one event or series and to the exact `EventPermission` grants they hold (`EDIT_DETAILS`, `MANAGE_REGISTRATIONS`, `MANAGE_INVITATIONS`, `CHECK_IN`, `PUBLISH_AND_SCHEDULE`, and the event-only `JUDGE`); a grant never implies another, and server checks go through `canAccessEvent`/`canManageRegistrationsFor` (`lib/eventAccess.ts`). No grant reaches organisation-level operations: publishing an event (`canPublishEvents`), short links, the Details form (`updateEvent`), the registration form, emails, feedback and certificates, reports, the check-in station PIN, changing the event address, cloning, embedding, deleting events or series, and managing collaborators stay with organisation owners and admins, even for a collaborator holding every grant. The full matrix of controls, server checks and roles is in [Permissions](PERMISSIONS.md).
- `JUDGE` ([Hackathon judging](HACKATHON.md)) is isolated: it opens only the judging workspace and never satisfies any other `EventPermission` check. A collaborator whose only grant is `JUDGE` sees no guests, answers, emails, check-in, page editing, or settings, and the mobile organiser API ignores judge-only grants. Judging settings, the rubric, assignments, disqualification, awards, and results are owner/admin only. A judge whose own account owns an RSVP on an entry (a member of the team, or the solo registrant) never sees that entry and cannot score it or be assigned it; the check runs server-side on every read and write.
- Dashboard refusals are real HTTP statuses: no access, another organisation's or an unknown event, series or webhook endpoint, and a JUDGE-only collaborator on any non-judging page get a 404 (or a 307 to `/dashboard`, the organisation, or sign-in), never a 200 that streams the not-found page. A dashboard `loading.tsx` may only sit below a layout that has already awaited the wrapped page's access check (`lib/dashboardGuards.ts`, pinned by `tests/unit/dashboard-loading-boundaries.test.ts`), so nothing of the protected page streams before the check. Pages still run their own checks.
- Dashboard controls are derived from one server-computed capability object (`eventCapabilities`/`seriesCapabilities` in `lib/eventDashboard/capabilities.ts`) that mirrors these server checks, so the UI neither shows a control the server would refuse nor hides one a grant allows. It is still only visibility; every action re-checks access.
- Event publication is one server-owned switch: `Event.status = PUBLISHED` and the released page (`EventPage.isPublished`) are written together in one transaction on every publish path (`createEvent`, `updateEvent`, and `publishEvent` in `app/actions/event.ts`). Public pages, RSVP (`lib/rsvpCore.ts`), and short links (`lib/shortLinkResolve.ts`) require both, so no path can expose an unpublished event, and a Live event is never left 404.

## Input, output, and browser controls

- Zod validates public/API and action inputs.
- Registration and feedback answers are validated against current server-owned field definitions.
- Uploads are size/signature/pixel checked; images are decoded, rotated, resized, metadata-stripped, and re-encoded. WebP dimension checks read lossy (VP8, little-endian), lossless (VP8L), and extended (VP8X) headers before decoding.
- A per-request nonce protects scripts with a strict Content Security Policy. Normal application pages deny framing; the public `/embed/:orgSlug/:eventSlug` route is framable only by exact HTTPS origins in `ALLOWED_EMBED_ORIGINS`. It reuses the canonical public-event access checks and must not be used for ticket, account, dashboard, or administrative content.
- Production responses include HSTS, frame denial, MIME sniffing protection, a permissions policy, and a strict referrer policy.
- Server Actions default to same-origin requests, with an explicit trusted-origin allowlist when required.

## Tokens and sensitive links

- Check-in and certificate tokens are high-entropy random values.
- The public ticket status and live-event routes validate the token shape, return only `{ checkedIn, checkedInAt }` with `no-store` and `no-referrer`, and answer unknown tokens with an empty 404. Realtime check-in channels are keyed by RSVP id, so ticket tokens never pass through Redis.
- Event short codes are random seven-character values containing at least one uppercase letter, so they cannot collide with a lowercase organisation slug. Only owners and admins can create or regenerate them (audited as `EVENT_SHORT_LINK_CREATED`/`EVENT_SHORT_LINK_REGENERATED`). Resolution redirects only published events with a released page, so a code never reveals a draft or hidden event's slug; unknown, unreleased, and rate-limited lookups return the same not-found response as an unknown organisation, and the destination page still applies its own privacy rules. Because publishing releases the page in the same transaction, a Live event's code resolves immediately; events published with the Overview **Publish event** button before that fix are repaired by the `20261021010000_realign_event_publication` data migration.
- Venue check-in stations require an event-scoped, bcrypt-protected rotating PIN. PIN management/recovery requires a fresh administrator sign-in and recoverable PIN ciphertext uses a domain-separated authenticated-encryption key. A station can open only from 24 hours before the event through one hour after it ends. Successful entry creates a signed, HttpOnly proof bound to that event, expiry, and PIN version; rotation and disablement invalidate existing proofs immediately. Station PINs, proofs, attendee exports, and offline rosters are never exposed through the public station.
- Team join links and team management links ([Team registration](TEAMS.md)) are random bearer capabilities. The management token is stored only as a SHA-256 hash and is shown once; regenerating either token retires the old link. Leader authority is re-checked under the event row lock on every mutation, a bare team id acts only for its signed-in leader, and the ticket (check-in) token reaches only leave and *Looking for a team* actions, never team management. The join page applies the event page's privacy, invite-only and release checks before revealing anything, and shows only the team name and size. Both pages are `noindex`, private-cache and `no-referrer` (header and meta). The proxy sends these pages, `/ticket/{token}`, `/submit/{token}` and `/account/submissions/{eventId}` a `private, no-cache, no-store` `Cache-Control`, because its HTML header would otherwise replace Next's in production. A solo registrant joining a team by link is resolved from their ticket token, and the join token is matched only inside that registration's event, under the event lock, while the event and its page are published; their solo project, if any, is handled exactly as on every other solo-to-team move (see [Hackathon judging](HACKATHON.md)). Team audit metadata holds ids only.
- Crew sign-up links (`/crew/:token`, [Event crew](CREW.md)) are random 256-bit bearer capabilities, stored as-is like team join tokens so organisers can show them again; rotating replaces the token and disabling deletes it, so the old link stops working at once. Malformed tokens are refused before any lookup, and the page shows only the event and organisation names (generic metadata, `noindex`, `no-referrer`, never cached, disallowed in `robots.txt`). Sign-ups are rate limited (`rsvp` per IP and email; photo uploads `upload` per IP and token), closed for cancelled and ended events, and start hidden from the public Crew section until an organiser reviews them. An email already on the crew or already registered for the event gets the same success answer and changes nothing, so the link neither enumerates attendees nor converts someone else's registration; only an organiser with `MANAGE_REGISTRATIONS` can turn a solo registration into a crew ticket. Crew tickets never count against capacity and are refused by self-cancel, the Guests · People edit and remove actions, and every team path.
- Solo submission links (`/submit/:token`) are random bearer capabilities of at least 128 bits, stored only as a SHA-256 hash on the RSVP-scoped row; requesting a new link retires the old one. A link is emailed only to the registration's own address through the outbox (a capability kind, deleted after delivery), so holding a ticket QR is never enough to edit a project; requests are rate limited with a per-registration cooldown, and the action never returns the token. Team projects are edited through the team management link or by a signed-in team member. Entrant authority is re-checked inside each write transaction, the entrant pages exist only while the event is published and its website released, and `/submit/:token` is `noindex`, uncached and `no-referrer` (header and meta).
- Ticket, certificate, invitation, password-reset, team, submission, crew sign-up, and MFA enrollment values are secrets or bearer capabilities.
- They must not appear in logs, audit metadata, monitoring tags, or analytics.
- Readiness and scheduler secrets are compared in constant time and unauthorized calls return generic responses.

## Abuse protection

- Password login applies account and IP limits inside the credential verifier, in addition to proxy limits. Missing and OAuth-only identities perform dummy bcrypt work; signup returns the same response for existing and newly created accounts. Auth.js errors are logged without exception payloads.
- Redis-backed limits cover organisation webhook changes (`webhookManage`, 30 per minute) and test sends/redeliveries (`webhookTest`, 20 per hour), APIs, authentication mutations, RSVP, feedback, search/discovery, uploads, Server Actions, object creation, invitations, broadcasts, check-in, personal data exports (per user), public ticket status and event streams (per IP), short-link lookups (per IP), mobile token refresh (`mobileAuth`, per IP) and mobile API traffic (`mobileApi`, per user), and browser crash reports (`clientError`, per IP). Bucket sizes live in `lib/rateLimit.ts`.
- Machine API traffic has an additional per-client limit so credential rotation cannot multiply request capacity.
- Security-sensitive production traffic fails closed when Redis is unavailable.
- Process-local fallback exists for development and an explicit CI-only production-build test mode.
- Client IP attribution trusts only the configured header; the edge must overwrite that header and prevent direct-origin access.

## Data privacy

- Certificate-disabled feedback stores answers without email or RSVP identity and allows repeat anonymous submissions.
- Certificate-enabled feedback requires an email matching a confirmed RSVP, links the response for certificate generation, and allows repeat submissions.
- Feedback mode, eligibility, typed answers, and response creation are one locked transaction. PostgreSQL forbids partial identity/certificate linkage, while immutable question snapshots keep historical answers meaningful after form maintenance.
- Registration counts are omitted from public payloads when the organiser disables count display.
- The personal data export (`GET /api/exports/account`) resolves the user only from the session, returns allow-listed fields of the user's own profile, memberships, registrations, feedback, co-organiser roles, and hackathon projects (without any disqualification reason), excludes passwords, hashes, MFA material, and every bearer token, is sent `private, no-store`, and is audited as `ACCOUNT_DATA_EXPORTED`.
- Operational alerts leave the instance, so `lib/opsAlerts.ts` redacts their text (URLs and connection strings, emails, bearer values, `token=`-style parameters, long opaque strings), reports route patterns instead of request paths, and keeps the fixed console log lines unchanged. Error detail goes only to the alert, never to stdout or audit metadata. Webhook URLs must be `https:` in production and may not embed user info. Any host is accepted, including internal addresses; this outbound request is deliberately limited to the MFA-gated super-admin, uses no redirects, and never returns the response body. `POST /api/client-errors` accepts only same-origin, size-capped, rate-limited reports and always answers an empty `204`.
- Event-level downloads are owner/admin only (the attendee CSV and email export also allow anyone, member or not, holding the event's `MANAGE_REGISTRATIONS` grant), answer every denial with the same empty 404, are sent `private, no-store`, and are audited: attendee CSV and the filtered Guests · People email export (`ATTENDEE_LIST_EXPORTED`; the email export records filter names only, never the search text), the filtered Guests · Teams CSV, which contains team leaders' and members' names and emails (`TEAM_LIST_EXPORTED`, also open to `MANAGE_REGISTRATIONS` holders on team events; filter names only), feedback CSV (`FEEDBACK_RESPONSES_EXPORTED`), and the post-event PDF reports (`EVENT_REPORT_DOWNLOADED`, `EVENT_OCCURRENCE_REPORT_DOWNLOADED`), which are available only after the event or occurrence ends and count typed answers, emails, and phone numbers rather than copying them.
- Hackathon data ([Hackathon judging](HACKATHON.md)): judges see project content only (title, summary, links, team or entrant display name), never entrant emails, answers, or ticket links. Judges' private comments and the disqualification reason are organiser-only; the entrant sees a neutral "not in judging" state and the reason is excluded from audit metadata and the personal data export. Public results and the project gallery apply the event page's access rules first and show no scores or comments. The scores CSV (`GET /api/exports/events/:eventId/judging`) is owner/admin only, formula-neutralised, `private, no-store`, contains no emails or comments, and is audited as `JUDGING_SCORES_EXPORTED`. The Judging → Submissions CSV (`view=submissions`, owner/admin only) includes the organiser-only disqualification reason and assigned judge names, no emails, and is audited as `JUDGING_SUBMISSIONS_EXPORTED` (filter names only). Every export action is listed on the super-admin Security page (`SECURITY_AUDIT_ACTIONS`).
- Super-admin insight pages never load tokens, credential hashes, registration answers, or message bodies; lists are capped and queries are parameterised.
- Broadcast designs escape organiser values and accept only absolute http(s) image and link URLs. The ticket venue link is shown only for an `http(s)` map URL (`lib/safeHttpUrl.ts` rejects `javascript:`, `data:`, and other schemes).
- Audit metadata is designed to exclude email addresses, answers, passwords, and bearer tokens.
- Public and dashboard browser event DTOs use explicit selects that exclude
  check-in station secrets and unused relations. Production exception logging
  is category-only. Attendee answers and ticket capabilities require the exact
  registration-management permission; the check-in surface requires the
  separate exact check-in permission.
- Organisation webhooks (`docs/WEBHOOKS.md`) are managed by owners and admins only (`canManageWebhooks`). Payloads are strict DTOs with ids, statuses, timestamps, event title/slug and attendee display names only: no email addresses, user ids, registration or feedback answers, or ticket, check-in, certificate or invitation tokens. Signing secrets are generated server-side, shown once, stored with AES-256-GCM under their own HKDF label from `MFA_ENCRYPTION_KEY`, and never logged or audited; audit metadata records the target host only.
- Webhook targets are SSRF-restricted: `https` on 443/8443 without URL credentials, no local or internal host names, and every resolved address must be public unicast (private, loopback, link-local and metadata, CGNAT, multicast, reserved, documentation, IPv6 ULA/link-local, and IPv4-mapped/NAT64/6to4 forms of blocked IPv4 are refused). The check runs at save time and before every delivery, and the socket is pinned to the vetted address so DNS rebinding cannot redirect it. Redirects are never followed, requests time out after 10 s, bodies are capped at 256 KB, and only a short redacted response excerpt is stored. `WEBHOOKS_ALLOW_PRIVATE_TARGETS=1` relaxes this for development and tests only; production ignores it outside CI test mode and `production:check` refuses it.
- Machine participant responses intentionally exclude contact data, registration answers, user IDs, and ticket/check-in/certificate capabilities. Attendance data needs the separate `participants:attendance:read` scope: both the attendance filter (`attendance=checked_in|not_checked_in`, which reveals who has checked in) and the nullable check-in timestamp (an explicit `include=attendance` request) are refused with `403 INSUFFICIENT_SCOPE` without it.
- Asset buckets are private; only generated organisation-bound WebP derivatives
  are delivered through the application key allowlist. Uploads are signature-
  checked, decoded under a hard pixel limit, single-frame enforced, resized,
  metadata-stripped, and re-encoded before storage.
- Capability-bearing outbox rows are deleted after delivery, expiry, or terminal
  failure. Queue/heartbeat failures persist only normalized error class/code,
  and retries use a stable non-sensitive Message-ID under lease-owned state
  transitions. Protected scheduler/readiness routes require one exact bearer.
- Retention cleanup covers expired sessions, expired or long-revoked mobile
  sessions, unused expired organisation and collaborator invitations,
  verification tokens, undo snapshots, old sent/failed non-capability
  outbox records, and webhook delivery history older than 30 days. Deployment
  operators must define broader legal retention and deletion procedures.

## Audit trail

Application code creates descriptive business/security audit events. PostgreSQL triggers add a minimal PII-free fallback record for important organisation, membership, event, invitation, RSVP, and series mutations, including mutations that bypass ordinary application paths. Check-in and undo actions also have an immutable event history, and custom check-in lists keep their own (`CheckInListEvent`); creating, renaming, archiving, restoring and reordering lists is audited (`CHECK_IN_LIST_*`).

## Transport and secrets

Production startup validates:

- matching HTTPS `AUTH_URL` and `NEXT_PUBLIC_BASE_URL`;
- PostgreSQL TLS through an accepted `sslmode`;
- `rediss://` for Redis;
- HTTPS for a custom S3 endpoint;
- authenticated SMTP unless an unauthenticated private relay is explicitly declared;
- required secret lengths and base64 AES key sizes.

Store secrets in a deployment secrets manager. Use a least-privileged database role and IAM/workload identity for object storage where possible.

## Known boundaries and follow-up work

- Certificate eligibility currently proves knowledge of the confirmed attendee email, not control of that inbox. Add a one-time emailed verification link if certificates carry material value or personal information.
- Google OAuth accounts do not use the application's normal sign-in TOTP challenge, but an account must enroll application TOTP before it can enter the super-admin panel.
- Current automated coverage is broad in scope but low in percentage; expand authorization and mutation-path tests before making a high-assurance claim.
- Application controls cannot replace CDN/WAF configuration, patch management, database backups, restore drills, alerting, access reviews, and incident response.
- Conduct an independent security review before processing sensitive or regulated data.

## Reporting a vulnerability

Report vulnerabilities privately in the team's Mattermost channel for security issues, never in a public GitHub issue or discussion. Include the affected route or component, steps to reproduce and the impact, and allow time for a fix before disclosing. Never include real secrets, tokens or personal data in a report; rotate any credential that was exposed.
