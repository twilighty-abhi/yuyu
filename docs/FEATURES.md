# Features

[Documentation index](README.md)

## Accounts and authentication

- Email/password signup and sign-in with bcrypt password hashing and one-time inbox verification before account activation.
- Optional Google OAuth.
- Password-reset requests delivered through the transactional outbox.
- Authenticator-app MFA for credential accounts, including recovery codes.
- “Revoke all sessions” and MFA management at `/dashboard/security`.
- JWT session-version invalidation after sensitive account operations.

Google OAuth users rely on the Google account's MFA policy; the application TOTP prompt applies to password authentication.

## Organisations and permissions

- Multiple organisations per user.
- `OWNER`, `ADMIN`, and `MEMBER` roles.
- Organisation profile, slug, description, and logo management.
- Member role changes and removals with owner-protection rules.
- Expiring, revocable organisation invitation links.
- Organisation deletion and audited administrative changes.

## Events

- Draft, published, and hidden event states.
- Title, description, tags, timezone, dates, location, online status, capacity, and cover image.
- Public, hidden-link, approval-required, and invite-only privacy modes.
- Optional display of confirmed registration counts.
- Event cloning, publishing, slug changes, and deletion.
- Verified email ownership is required before creating events, recurring series, clones, or event cover images.
- Private event and series email allowlists.
- Cover images are decoded, resized, metadata-stripped, and re-encoded to WebP before storage.

## Recurring series

- RRULE-based event series.
- Materialized event instances with their own RSVP lists.
- Series capacity, privacy, status, timezone, and invite management.

## Registration and RSVP lifecycle

- Guest registration by name/email and registration for signed-in users.
- Custom registration questions: text, textarea, email, phone, select, multiselect, radio, checkbox, number, and date.
- Required-field and option validation on the server.
- Duplicate RSVP prevention per event or instance.
- Capacity-aware confirmation and waitlisting.
- Pending approval, approval, rejection, cancellation, and waitlist promotion.
- Removing an RSVP creates a short-lived, server-owned undo snapshot.
- Confirmation and lifecycle emails are queued through a durable outbox.
- Event dashboard invitations are queued through the same durable outbox and link invitees to the event registration page.

## Tickets and check-in

- Opaque ticket/check-in tokens with QR and manual entry flows.
- Printable/downloadable attendee ticket.
- Organiser attendee lookup, direct check-in, and check-in undo.
- In-venue attendee ID-card preview and browser printing after a QR, manual, or lookup check-in; every card includes that attendee's scannable check-in QR code in a fixed visible position, alongside three distinct high-contrast templates, organisation branding, card text, and participant fields selected directly from the registration form (including organisation and role) with custom printed labels.
- Offline roster storage in the browser and later synchronization.
- Immutable check-in event history for online and offline actions.

Only eligible confirmed attendees receive a scannable ticket by default. Organisers can explicitly handle exceptional status cases where supported by the check-in workflow.

## Feedback and certificates

- Per-event feedback form with configurable title, thank-you message, open/closed state, and custom questions.
- When certificates are disabled, feedback is anonymous: no email or RSVP identity is collected, and repeat responses are allowed.
- When certificates are enabled, the submitted email must match a confirmed RSVP. Repeat submissions from the same email are allowed.
- Successful eligible submissions can download a generated JPEG certificate using an opaque token.
- Feedback links are shared manually; opening a form does not automatically email attendees.

## Discovery and public pages

- Landing page, organisation pages, event pages, and recurring-instance pages.
- Public-event discovery with paginated, database-bounded search.
- Search by event title, tags, and organisation name.
- Public sitemap and crawler controls; ticket and administrative paths are not intended for indexing.

## Administration and operations

- Instance-wide super-admin area restricted by `SUPER_ADMIN_EMAIL`.
- Super-admin control to disable new password and Google account creation while preserving existing-user sign-in.
- Separate TOTP step-up verification for super-admin access; verification lasts 10 minutes and requires an enrolled authenticator.
- Organisation, user, event, invitation, authentication, monitoring, operations, storage, and searchable audit-log views.
- Public liveness and secret-protected database readiness endpoints.
- Outbox delivery, retries, retention cleanup, scheduler-heartbeat monitoring, and safe failed-email diagnostics.
- Private S3-compatible object storage with database asset accounting.
- Application audit events plus database-triggered fallback audit records for important mutations.
- Owner-managed, tenant-bound machine API clients with explicit scopes, one-time credentials, expiry, rotation, revocation, and disablement.
- Versioned machine endpoints for standalone event metadata and minimal confirmed-participant rosters, including attendance filtering and separately scoped check-in timestamps.
