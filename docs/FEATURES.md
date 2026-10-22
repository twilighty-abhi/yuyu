# Features

[Documentation index](README.md)

## Accounts and authentication

- Email/password signup and sign-in with bcrypt password hashing and one-time inbox verification before account activation.
- Account area with Profile (name, photo, email status, Light/Dark/System appearance), Registrations (your upcoming and past tickets with cancel, certificates, and a personal JSON data export that never includes passwords, security codes or ticket links), Organisations (memberships and roles, event co-organiser roles, pending co-organiser invites, and leaving an organisation, blocked for the only owner), and Security (password, two-step verification, sign-in methods, recent security activity, sign out everywhere).
- Optional Google OAuth.
- Password-reset requests delivered through the transactional outbox.
- Authenticator-app MFA for credential accounts, including recovery codes.
- Account pages at `/account`, `/account/registrations`, `/account/organisations`, and `/account/security`. The personal data export (`GET /api/exports/account`) returns only the signed-in user's own allow-listed data as JSON, is limited to five downloads per hour, and is audited as `ACCOUNT_DATA_EXPORTED`. Leaving an organisation removes only your own membership, is refused for the sole owner, and is audited as `ORGANISATION_MEMBER_LEFT`.
- JWT session-version invalidation after sensitive account operations.
- A user-authenticated mobile API (`/api/mobile/v1`) for the Yuyu mobile apps (Android and iOS): email/password and Google sign-in with rotating refresh tokens, your registrations and tickets, public discovery and registration, and organiser day-of work (guest approval, check-in with offline roster and sync, attendee emails, live programme delays, feedback open/close, closing sign-ups). Mobile sessions end with "sign out everywhere" and password or MFA changes. Android App Links and iOS Universal Links association files are served under `/.well-known/` when configured. See [Mobile API](MOBILE_API.md).

Google OAuth users rely on the Google account's MFA policy; the application TOTP prompt applies to password authentication.

## Organisations and permissions

- Multiple organisations per user.
- `OWNER`, `ADMIN`, and `MEMBER` roles.
- Organisation profile, slug, description, and logo management.
- Member role changes and removals with owner-protection rules.
- Expiring, revocable organisation invitation links.
- Organisation deletion (the owner types the organisation's exact name to confirm) and audited administrative changes.
- Outgoing webhooks (owners and admins, **Settings → Webhooks**): up to 10 signed endpoints per organisation for registrations, status changes, check-ins, publish/cancel and feedback, with a reveal-once signing secret, rotation, test sends, a delivery log with redelivery, automatic retries and auto-disable. Payloads carry names and statuses only. See [Organisation webhooks](WEBHOOKS.md).
- Event collaborators (co-organisers) invited per event through expiring links (`/join/event-collaborator/:token`), with exact grants: `EDIT_DETAILS`, `MANAGE_REGISTRATIONS`, `MANAGE_INVITATIONS`, `CHECK_IN`, and `PUBLISH_AND_SCHEDULE`. Collaborators reach only the events they were granted. `EDIT_DETAILS` covers event-page content (page settings, highlights, speakers, sponsors, resources, FAQs), `MANAGE_REGISTRATIONS` the guest list (approvals, waitlist, manual guests, edits, removals, attendee CSV, registration numbers), `MANAGE_INVITATIONS` the invite list, `CHECK_IN` the check-in desk and badges, and `PUBLISH_AND_SCHEDULE` the programme schedule; the same grants apply on a series page. Setting the event Live, short links, the Details form, the registration form, emails, feedback, reports, the check-in station PIN, cloning, embedding, deleting, co-organisers, and organisation settings stay with owners and admins (see [Permissions](PERMISSIONS.md)).

## Events

- Draft, published, hidden, and cancelled event states; the dashboard labels the first three Draft, Live, and Offline.
- A three-step **Create Event** dialog (Basics, Schedule, Location & platform) creates a draft and opens its event dashboard (`components/event/CreateEventDialog.tsx`).
- The event dashboard has eight tabs: Overview, Guests, Event page, Emails, Check-in, Feedback, Analytics, and Settings. Old `?tab=details|registration|invites` links still open the right place.
- A single event publication state controls both public website visibility and RSVP availability. Publishing sets `Event.status = PUBLISHED` and releases the event page (`EventPage.isPublished = true`) together, whether it is done in the Publishing section or with **Publish event** on the Overview readiness checklist (`publishEvent` in `app/actions/event.ts` writes both in one transaction and creates the page row if a cloned or older draft has none). Saving the event page for an event that has no page row yet creates it released exactly when the event is published. A Live event's public page, sign-ups, and short link therefore work immediately.
- The event's **Publishing** section asks three questions: who can see it (Draft, Live, Offline), who can find it (everyone, people with the link, or invited people, plus an *Approve each sign-up* switch), and sign-ups (spots, a single close-sign-ups rule, and whether to show the count), with a live summary line.
- Title, description, tags, timezone, dates, location, online status, capacity, and cover image.
- Cover photo editor: 16:7 event banner by default (16:9 and square also available), drag/pinch/wheel/keyboard positioning that always covers the frame, rotate, straighten, flip, brightness/contrast/saturation and preset looks, guides, and card/social-share previews. The edited image is exported as WebP (JPEG fallback) and still passes the normal server-side upload pipeline.
- Event page accent colour from presets or a custom picker (saturation/brightness area, hue slider, hex input, the system eyedropper where supported, and a live contrast-checked sample).
- Public, hidden-link, approval-required, and invite-only privacy modes; approval-required events can also be listed publicly (organisation page, Discover, search) through `Event.listedPublicly`. Every listing uses the shared `listedEventAudienceWhere` rule, and sign-up approval still applies.
- Optional display of confirmed registration counts.
- Parallel programme tracks for rooms, stages, and streams; live delays cascade only within the affected track, while same-track time overlaps remain visible as organiser warnings.
- Event cloning, publishing, slug changes, and deletion.
- Optional event short links (`/aB3x9Kq`): organisation owners and admins create one on demand from the event dashboard and can regenerate it, which retires the old code. The link follows slug changes, and the event page still applies its own privacy and invite rules.
- An embeddable event card at `/embed/:orgSlug/:eventSlug`, with in-frame registration, framable only by the origins in `ALLOWED_EMBED_ORIGINS`.
- Verified email ownership is required before creating events, recurring series, clones, or event cover images.
- Private event and series email allowlists.
- Cover images are decoded, resized, metadata-stripped, and re-encoded to WebP before storage.

## Event websites

- Each event can have a public website (`EventPage`) with sections, highlights, venue and rooms, programme tracks and sessions, speakers, sponsors by tier, FAQs, and resources. Content items carry Published, Draft, or Hidden visibility, and only published content appears publicly.
- Public programme (`/:orgSlug/:eventSlug/schedule`), session pages (`/sessions/:sessionSlug`), and speaker pages (`/speakers/:speakerSlug`), plus a schedule for each recurring occurrence. The live running order shows delays as they are announced.

## Recurring series

- RRULE-based event series.
- Materialized event instances with their own RSVP lists.
- Series capacity, privacy, status, timezone, and invite management.

## Registration and RSVP lifecycle

- Guest registration by name/email and registration for signed-in users.
- Custom registration questions: text, textarea, email, phone, select, multiselect, radio, checkbox, number, and date.
- Per-question help text, placeholders, and settings: length, number and date limits, maximum selections, an "Other" answer, and "show only if" logic based on an earlier choice or yes/no question. Question keys are generated from the question text and never shown. The server enforces every setting and drops answers to questions hidden by logic.
- Required-field and option validation on the server.
- Duplicate RSVP prevention per event or instance.
- Capacity-aware confirmation and waitlisting.
- Pending approval, approval, rejection, cancellation, and waitlist promotion.
- Re-accepting a declined registration (**Re-accept** on a declined guest in the Guests list, or `POST …/guests/:rsvpId/reaccept` in the mobile API): organisation admins can reverse a decline while the event or occurrence is still open. It takes the same locked capacity check as an approval: the guest is confirmed when there is room and otherwise moved to the waitlist (never oversold), gets the approval or waitlist email through the outbox, and the change is audited as `RSVP_REACCEPTED`.
- Removing an RSVP creates a short-lived, server-owned undo snapshot.
- Confirmation and lifecycle emails are queued through a durable outbox.
- Confirmed RSVP emails include an `.ics` calendar invitation with the event or occurrence time and location.
- Event dashboard invitations are queued through the same durable outbox and link invitees to the event registration page.
- Organisation admins can email selected groups of existing registrations from the event's **Emails** tab: choose any combination of confirmed, waitlisted, pending-approval, and rejected registrations, optionally narrowed to people who did or did not check in. Thirteen starter templates (reminders, know-before-you-go logistics, agenda updates, speaker announcements, schedule or venue changes, cancellation, waitlist and approval updates, on-the-day notes, thank-you, missed-you, and slides/resources) prefill the subject, a rich-text message, and a suggested audience. The editor supports headings, bold/italic, lists, quotes, links, call-to-action buttons, and placeholders for `{{name}}`, `{{event}}`, `{{eventDate}}`, `{{location}}`, `{{eventUrl}}`, `{{ticketLink}}`, `{{feedbackUrl}}`, `{{scheduleUrl}}`, and `{{organisation}}`. Message HTML is reduced to a small sanitised subset on the server, a plain-text alternative is generated automatically, and the dashboard preview is rendered by the server with the real email template at desktop and mobile widths. Five visual designs (Classic, Minimal, Accent band in the event colour, Photo header with the event cover, and Letter) frame the same content; the choice is stored with each broadcast and used for the preview, tests and delivery. Organisers can send themselves a test, review the recipient count and subject in a confirmation step that must be ticked before sending, undo within five seconds, and reuse any previously sent email with its design. Each recipient is a separate outbox message rendered at delivery time, one per email address; ticket links are only inserted for confirmed registrations, and a registration that leaves the audience before delivery is skipped. Sends are rate limited and audited without recipient data. Test sends link `{{ticketLink}}` to the organiser's own ticket when they are confirmed for the event, and otherwise to the event page. Sent emails build image and site links from `NEXT_PUBLIC_BASE_URL`; without it, the photo header falls back to the colour band and site-relative images are left out (the dashboard preview works either way).
- Custom emails in the **Emails** tab are kept as a draft on the server, one per organiser and event, so they survive a reload, another device, or a closed tab. The draft (subject, sanitised message, design, audience, and the template it started from) autosaves about 1.5 seconds after typing stops, with a **Save draft** button for unsaved changes and a quiet status line ("Unsaved changes", "Saving…", "Draft saved · 2:41 PM", or "Couldn't save · Retry"). Opening the tab restores it. Loading a template or reusing a sent email asks before replacing a draft, **Discard draft…** asks before removing it, and the browser warns before closing the page with unsaved changes. Drafts are private to their author (teammates never see them), need the same owner/admin access as sending, and are removed when that organiser sends the email from the dashboard, after the five-second undo window; test sends keep the draft. Drafts are deleted with their event or their author's account. The mobile API does not use drafts yet.

## Tickets and check-in

- Opaque ticket/check-in tokens with QR and manual entry flows.
- Printable/downloadable attendee ticket. For in-person events with a valid http(s) map link, the venue on the ticket opens the map in a new tab.
- Live ticket: when the attendee is checked in (scan, manual, offline replay, station, or the mobile app), an open ticket page tears off its QR stub and shows the check-in time, without a reload. Reloading a checked-in ticket shows the torn state and no QR.
- Organiser attendee lookup, direct check-in, and check-in undo.
- In-venue attendee badge printing after a QR, manual, or lookup check-in. With badge printing on, each check-in opens a quick print sheet showing that attendee's real badge with one Print button (Enter prints), Skip, and Edit design. The badge designer offers three high-contrast templates (Classic, Bold, Minimal), with the name always the largest text; badge-stock presets (A6, 4 × 6 in, 3 × 4 in, 4 × 3 in, CR80 ID card) in portrait or landscape plus custom sizes, with layouts and type that scale to the stock; card text with optional label and footer; email and organisation logo toggles; registration answers chosen from the sign-up form, reordered, and relabelled; long names that shrink to stay on one line; drag, arrow-key nudging and a properties panel for each item; undo/redo; previews with short and long sample names; a test-card print with sample data; and export/import of the design file to set up another desk. Every card includes the attendee's scannable check-in QR, generated locally. Designs are kept in the browser per event.
- A PIN-locked venue check-in station at `/:orgSlug/:eventSlug/check-in` for door volunteers without a Yuyu account (`lib/checkInStation.ts`, `lib/stationPin.ts`); organisers set and reveal the PIN from the Check-in tab.
- Offline roster storage in the browser and later synchronization.
- Immutable check-in event history for online and offline actions.

Only eligible confirmed attendees receive a scannable ticket by default. Organisers can explicitly handle exceptional status cases where supported by the check-in workflow.

## Feedback and certificates

- Per-event feedback form with configurable title, thank-you message, open/closed state, and custom questions. Organisers can start from quick pulse, event review, or session-and-speaker-review templates, then tailor the form before opening it.
- When certificates are disabled, feedback is anonymous: no email or RSVP identity is collected, and repeat responses are allowed.
- When certificates are enabled, the submitted email must match a confirmed RSVP. Repeat submissions from the same email are allowed.
- Successful eligible submissions can download a generated JPEG certificate using an opaque token.
- Certificate designer: upload JPEG/PNG/WebP artwork (up to 5 MB), then build the certificate from up to 20 layers. Text layers take fixed text plus merge tags ({{name}}, {{event}}, {{eventDate}}, {{organisation}}, {{issueDate}}; dates use the event's timezone) with font, size, colour, bold, italic, uppercase, letter spacing, alignment and line breaks; long text shrinks to fit its box. Image layers hold logos, signatures or seals (JPEG/PNG/WebP up to 5 MB, transparency kept), fitted inside their box. Layers can be selected, reordered, duplicated and deleted, dragged with centre snapping, resized, nudged with arrow keys, or placed with numeric controls. An exact server-generated preview checks fonts and fitting before saving feedback settings. Templates saved in the earlier single name-area format are upgraded automatically.
- Certificate layouts are snapshotted when feedback is submitted; subsequent layout edits affect new submissions only. Without custom artwork, the standard certificate is used.
- Feedback links are shared manually; opening a form does not automatically email attendees.
- Organisation owners and admins can download feedback responses as CSV (`/api/exports/events/:eventId/feedback`); owners, admins, and collaborators with `MANAGE_REGISTRATIONS` can download the attendee list as CSV.

## Event analytics

- The event dashboard's analytics include a registration funnel. Each step has a plain-language hint, a bar sized as a share of everyone who responded, and a percentage of the previous step, never over 100%.
- After an event or occurrence ends, owners and admins can download a post-event PDF report (sign-up timeline, arrivals by time and device, programme, speakers and sponsors, answer counts, emails sent, and team). Typed answers, emails, and phone numbers are counted, never copied into the report.

## Discovery and public pages

- Landing, About, and Features pages, organisation pages, event pages, and recurring-instance pages.
- Privacy policy (`/privacy`) and terms of use (`/terms`) describing what the product actually does: guest registrations and custom questions, roles and API access, third-party services (Google Maps, Gravatar), cookies and offline rosters, organiser emails, retention windows, the free-events-only rule, organiser duties, check-in stations, and certificates. Deployments should review them against their own jurisdiction and providers.
- Public-event discovery with paginated, database-bounded search.
- Search by event title, tags, and organisation name.
- Public sitemap and crawler controls; ticket and administrative paths are not intended for indexing.
- Installable web app named "Yuyu" (`app/manifest.ts`, start URL `/dashboard`).
- Missing pages return a real HTTP 404 with the "lost ticket" not-found page.

## Administration and operations

- Instance-wide super-admin area restricted by `SUPER_ADMIN_EMAIL`, with its own top bar instead of the dashboard sidebar. Every super-admin page checks super-admin access and the MFA step-up itself.
- Super-admin control to disable new password and Google account creation while preserving existing-user sign-in.
- Super-admin instance settings for SMTP delivery, Google SSO, and display-only backup posture; instance-managed service secrets are encrypted at rest and never displayed after saving. Saved settings are read from the database on every send and sign-in, so they apply on every replica without a restart; saved SMTP replaces the `SMTP_*` environment values as a whole. **Send test email** checks delivery after saving, and **Retry failed email (last 7 days)** requeues only recent failures.
- An optional operational alerts webhook (Mattermost or Slack-compatible) for uncaught server errors, server error logs, sign-in failures, email delivery failures, browser crashes (`POST /api/client-errors`), and process starts. Alert text is redacted, de-duplicated, and rate capped; the webhook URL is write-only and encrypted. See [Production operations](production-operations.md#operational-alerts-webhook).
- `node scripts/check-instance-secrets.mjs` confirms that `MFA_ENCRYPTION_KEY` can decrypt the secrets saved in the panel, without printing them.
- Read-only super-admin insights: 30-day activity and growth (signups, organisations, events, registrations, check-ins, feedback, broadcasts), email outbox health by message kind and recent broadcasts (subject and audience only), security posture (MFA adoption, owners/admins without MFA, unverified accounts, sign-in methods, sensitive audit actions, machine API clients with credential lifecycle but never secrets), storage breakdowns, and per-user and per-organisation support pages. Tokens, password and credential hashes, registration answers, storage keys, and message bodies are never shown.
- Separate TOTP step-up verification for super-admin access; verification lasts 10 minutes and requires an enrolled authenticator.
- Organisation, user, event, invitation, authentication, monitoring, operations, storage, and searchable audit-log views.
- Public liveness and secret-protected database readiness endpoints.
- Outbox delivery, retries, retention cleanup, scheduler-heartbeat monitoring, and safe failed-email diagnostics.
- Private S3-compatible object storage with database asset accounting.
- Application audit events plus database-triggered fallback audit records for important mutations.
- Owner-managed, tenant-bound machine API clients with explicit scopes, one-time credentials, expiry, rotation, revocation, and disablement.
- Versioned machine endpoints for standalone event metadata and minimal confirmed-participant rosters, including attendance filtering and separately scoped check-in timestamps.
