# Security model

[Documentation index](README.md)

This page documents implemented controls and security boundaries. It is not a substitute for an external penetration test, infrastructure review, or jurisdiction-specific privacy assessment.

## Authentication

- Passwords are bcrypt hashes and are never stored or logged in plaintext.
- Auth.js sessions include a user `sessionVersion`; incrementing it invalidates issued sessions.
- Password reset uses expiring verification tokens and the transactional outbox.
- Password accounts require a one-time, expiring inbox-verification link before sign-in or event creation. Tokens are stored only as hashes and consumed once.
- Credential users can enable TOTP MFA and receive one-use recovery codes.
- TOTP seeds are encrypted with AES-256-GCM using `MFA_ENCRYPTION_KEY`; recovery codes are stored as keyed hashes. Super-admin SMTP and Google client secrets are separately domain-encrypted from that key and never rendered back to the browser.
- Sensitive account operations revoke existing sessions and write audit events.
- The super-admin panel requires a second, fresh TOTP step-up verification even after a normal authenticated session. Its signed, HttpOnly proof lasts 10 minutes and is bound to the user/session version.
- Google OAuth security, including MFA, is governed by the linked Google account.
- Super-admins with a fresh TOTP proof can disable new password and Google account creation; existing users can continue to sign in.
- External applications use high-entropy, tenant-bound API credentials under `/api/v1`; raw secrets are displayed once and only SHA-256 digests are stored.

## Authorization and tenancy

- Organisation membership is the tenant boundary.
- Owner/admin/member permissions are checked inside Server Actions and server-rendered pages.
- Hiding a control in the UI is never treated as authorization.
- Super-admin access is checked server-side against `SUPER_ADMIN_EMAIL` and fails as not found.
- Database foreign keys and uniqueness constraints provide a second integrity layer.
- Machine clients resolve their organisation from the authenticated credential and require an explicit endpoint scope. Caller-supplied organisation identifiers never select the tenant.

## Input, output, and browser controls

- Zod validates public/API and action inputs.
- Registration and feedback answers are validated against current server-owned field definitions.
- Uploads are size/signature/pixel checked; images are decoded, rotated, resized, metadata-stripped, and re-encoded.
- A per-request nonce protects scripts with a strict Content Security Policy.
- Production responses include HSTS, frame denial, MIME sniffing protection, a permissions policy, and a strict referrer policy.
- Server Actions default to same-origin requests, with an explicit trusted-origin allowlist when required.

## Tokens and sensitive links

- Check-in and certificate tokens are high-entropy random values.
- Ticket, certificate, invitation, password-reset, and MFA enrollment values are secrets or bearer capabilities.
- They must not appear in logs, audit metadata, monitoring tags, or analytics.
- Readiness and scheduler secrets are compared in constant time and unauthorized calls return generic responses.

## Abuse protection

- Redis-backed limits cover APIs, authentication mutations, RSVP, feedback, search/discovery, uploads, Server Actions, object creation, and invitations.
- Machine API traffic has an additional per-client limit so credential rotation cannot multiply request capacity.
- Security-sensitive production traffic fails closed when Redis is unavailable.
- Process-local fallback exists for development and an explicit CI-only production-build test mode.
- Client IP attribution trusts only the configured header; the edge must overwrite that header and prevent direct-origin access.

## Data privacy

- Certificate-disabled feedback stores answers without email or RSVP identity and allows repeat anonymous submissions.
- Certificate-enabled feedback requires an email matching a confirmed RSVP, links the response for certificate generation, and allows repeat submissions.
- Registration counts are omitted from public payloads when the organiser disables count display.
- Audit metadata is designed to exclude email addresses, answers, passwords, and bearer tokens.
- Machine participant responses intentionally exclude contact data, registration answers, user IDs, and ticket/check-in/certificate capabilities. Attendance filtering does not reveal check-in data; the nullable check-in timestamp requires the separate `participants:attendance:read` scope and an explicit `include=attendance` request.
- Asset buckets are private; safe derivatives are delivered through the application.
- Retention cleanup covers expired verification tokens, undo snapshots, and old sent outbox records. Deployment operators must define broader legal retention and deletion procedures.

## Audit trail

Application code creates descriptive business/security audit events. PostgreSQL triggers add a minimal PII-free fallback record for important organisation, membership, event, invitation, RSVP, and series mutations, including mutations that bypass ordinary application paths. Check-in and undo actions also have an immutable event history.

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

The repository does not yet define a public security contact or `SECURITY.md` policy at its root. Add a monitored private reporting channel before public deployment or open-source distribution.
