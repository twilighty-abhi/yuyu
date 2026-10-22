# Event permissions matrix

[Documentation index](README.md)

Who can see and use each part of the event and series dashboards. The server
is authoritative: every Server Action and route handler named below checks
access itself, and hiding a control is never authorisation (see
[Security](SECURITY.md#authorization-and-tenancy)). The dashboards derive what
they show from one helper, `eventCapabilities` / `seriesCapabilities` in
`lib/eventDashboard/capabilities.ts`, computed server-side in
`lib/eventDashboard/context.ts`, so a control is shown exactly when its action
would be allowed. `tests/unit/event-capabilities.test.ts` pins this table.

## Roles and grants

- **OWNER / ADMIN**: organisation owners and admins. They can do everything on
  this page for every event and series in their organisation.
- **MEMBER**: an organisation member. Members can open every event dashboard
  read-only; they act on an event only through a collaborator grant on it.
- **Collaborator (co-organiser)**: a user (usually not a member) holding an
  `EventCollaborator` grant on one standalone event or one series, with one or
  more exact `EventPermission` values. A grant never implies another, and a
  grant never reaches organisation-level operations. Server checks go through
  `canAccessEvent` (`lib/eventAccess.ts`): OWNER/ADMIN, or the exact grant on
  that event or series. A member who also holds a grant gets the grant.

| Grant | Covers |
| --- | --- |
| `EDIT_DETAILS` | Event page content: page settings (tagline, logo, accent, sections, about), highlights, speakers, sponsors, resources, FAQs, venue, and their uploads; creating, renaming, reordering, archiving and restoring custom check-in lists |
| `MANAGE_REGISTRATIONS` | The guest list: approve, decline, give a waitlist place, add a guest, edit and remove (with undo) registrations, the attendee CSV, registration numbers in the header, Overview and Analytics |
| `MANAGE_INVITATIONS` | The event's (or series') invite list: add and remove invited emails |
| `CHECK_IN` | The check-in desk and page: scan, search, preview, check in, undo, offline roster and sync, badge (ID card) printing; checking guests into and out of custom check-in lists |
| `PUBLISH_AND_SCHEDULE` | The programme: schedule tracks, sessions and live delays (standalone events), and series schedule items. Despite the name, setting an event Live stays with owners and admins |

## Event dashboard

`/dashboard/:orgSlug/event/:eventId`. "Admin" means organisation OWNER/ADMIN.
"—" means the control is hidden or replaced by a "no permission" note.

| Area and control | Server check | Admin | Member | `EDIT_DETAILS` | `MANAGE_REGISTRATIONS` | `MANAGE_INVITATIONS` | `CHECK_IN` | `PUBLISH_AND_SCHEDULE` | All grants |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Open the dashboard | `loadEventDashboard`: membership, or any grant on the event | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes |
| Header: live numbers | page render; `canManageRegistrations` | Yes | — | — | Yes | — | — | — | Yes |
| Header: report PDF (after the event) | `GET /api/reports/event/:id`: admin | Yes | — | — | — | — | — | — | — |
| Header and Check-in tab: Open check-in | check-in page: `CHECK_IN` | Yes | — | — | — | — | Yes | — | Yes |
| Overview: readiness "Publish" | `publishEvent`: `canPublishEvents` (admin) | Yes | — | — | — | — | — | — | — |
| Overview: cover image item, At a glance "Edit" | `updateEvent`: admin | Yes | — | — | — | — | — | — | — |
| Overview: programme item | schedule actions: `PUBLISH_AND_SCHEDULE` | Yes | — | — | — | — | — | Yes | Yes |
| Overview: registration-form item | registration-form actions: admin | Yes | — | — | — | — | — | — | — |
| Overview: station PIN item | `app/actions/checkin-station.ts`: admin | Yes | — | — | — | — | — | — | — |
| Overview: sign-ups, approvals ("Waiting for you") | RSVP cores: `MANAGE_REGISTRATIONS` | Yes | — | — | Yes | — | — | — | Yes |
| Overview: email item | broadcast core: admin | Yes | — | — | — | — | — | — | — |
| Overview: short link create/regenerate | `app/actions/shortLink.ts`: admin | Yes | — | — | — | — | — | — | — |
| Overview: existing short link (copy only) | none (public link) | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes |
| Overview: "Embed" shortcut | none (Settings section is admin-only) | Yes | — | — | — | — | — | — | — |
| Overview: team card | collaborator actions: admin | Yes | — | — | — | — | — | — | — |
| Overview: "See how it went" (ended) | Analytics visibility | Yes | — | — | Yes | — | — | — | Yes |
| Guests · People: list, filters, ticket links | `loadAttendees` only for `canManageRegistrations` | Yes | — | — | Yes | — | — | — | Yes |
| Guests · People: approve, decline, give spot, add, edit, remove, undo remove | `lib/core/rsvpLifecycle.ts`, `lib/core/rsvpAdmin.ts`: `canManageRegistrationsFor` | Yes | — | — | Yes | — | — | — | Yes |
| Guests · People: undo check-in | `lib/core/checkin.ts`: `CHECK_IN` | Yes | — | — | — | — | — | — | Yes |
| Guests · People: Download CSV / export emails | `GET /api/exports/events/:id/attendees`: admin or `MANAGE_REGISTRATIONS` | Yes | — | — | Yes | — | — | — | Yes |
| Guests · Invites | `app/actions/invites.ts`: `MANAGE_INVITATIONS` | Yes | — | — | — | Yes | — | — | Yes |
| Event page · Details (title, dates, venue, capacity, privacy, discovery, registration window, cover, logo) | `updateEvent`, `uploadEventCoverImage`: admin | Yes | — | — | — | — | — | — | — |
| Event page · Page & programme: content editor | `app/actions/event-website.ts`: `EDIT_DETAILS` | Yes | — | Yes | — | — | — | — | Yes |
| Event page · Page & programme: "Open schedule" | schedule page and actions: `PUBLISH_AND_SCHEDULE` | Yes | — | — | — | — | — | Yes | Yes |
| Event page · Registration form | `app/actions/registration-form.ts`: `requireOrgRole(ADMIN)` | Yes | — | — | — | — | — | — | — |
| Emails: compose, test, send, history | `lib/core/broadcasts.ts`: admin | Yes | — | — | — | — | — | — | — |
| Check-in: desk, counts, ID cards | `lib/core/checkin.ts`: `CHECK_IN` | Yes | — | — | — | — | Yes | — | Yes |
| Check-in: check-in lists card, list switcher, scan/search into a list, undo, list guest view | `lib/core/checkinLists.ts` (`checkInToListForUser`, `undoListCheckInForUser`, `lookupListAttendeesForUser`): `CHECK_IN` (`canCheckInToLists`) | Yes | — | — | — | — | Yes | — | Yes |
| Check-in: Manage lists (create, rename, reorder, archive, restore, requires entry check-in) | `lib/core/checkinLists.ts` (`createCheckInListForUser`, `updateCheckInListForUser`, `reorderCheckInListsForUser`): `EDIT_DETAILS` (`canManageCheckInLists`) | Yes | — | Yes² | — | — | — | — | Yes |
| Check-in: door station PIN on/reveal/rotate/off | `app/actions/checkin-station.ts`: admin + fresh sign-in | Yes | — | — | — | — | — | — | — |
| Check-in: Export attendance | attendee CSV route | Yes | — | — | —¹ | — | — | — | Yes |
| Feedback: form, settings, certificate builder | `app/actions/feedback-form.ts`, `app/actions/certificate.ts`: admin | Yes | — | — | — | — | — | — | — |
| Feedback: responses and CSV | `GET /api/exports/events/:id/feedback`: admin | Yes | — | — | — | — | — | — | — |
| Analytics: numbers | page render; `canViewAnalytics` | Yes | — | — | Yes | — | — | — | Yes |
| Analytics: report PDF | report route: admin | Yes | — | — | — | — | — | — | — |
| Settings: co-organisers (invite, grants, remove, cancel invite) | `app/actions/event-collaborators.ts`: admin | Yes | — | — | — | — | — | — | — |
| Settings: event address (slug) | `updateEventSlug`: admin | Yes | — | — | — | — | — | — | — |
| Settings: clone | `cloneEvent`: admin | Yes | — | — | — | — | — | — | — |
| Settings: embed snippets | none (public URLs); admin-only by product rule | Yes | — | — | — | — | — | — | — |
| Settings: delete event | `deleteEvent`: admin | Yes | — | — | — | — | — | — | — |
| Schedule page (`…/schedule`) | page and `saveSession`/track/delay actions: `PUBLISH_AND_SCHEDULE` | Yes | 404 | 404 | 404 | 404 | 404 | Yes | Yes |
| Check-in page (`…/check-in`) | page and check-in actions: `CHECK_IN` | Yes | 404 | 404 | 404 | 404 | Yes | 404 | Yes |

¹ The Check-in tab needs `CHECK_IN`, so this button needs both grants; a
`MANAGE_REGISTRATIONS`-only co-organiser downloads the same CSV from
Guests · People.

² An `EDIT_DETAILS`-only co-organiser sees the Check-in tab's lists card with
**Manage lists** and the counts, but not the desk or scanning, which need
`CHECK_IN`. Lists are set up like page content, ahead of the event, so they
follow `EDIT_DETAILS`; door staff with only `CHECK_IN` scan into the lists
they are given but cannot add, rename or archive them, which keeps one
volunteer from reshaping what every desk tracks. An event outside the
caller's organisation, or one they cannot open at all, answers
"Event not found."; a list of another event answers "List not found.".

## Series page

`/dashboard/:orgSlug/series/:seriesId`, driven by `seriesCapabilities` with the
series-level grant. Grants on a standalone event never reach a series, and a
series grant never reaches a standalone event.

| Control | Server check | Admin | Member | `MANAGE_REGISTRATIONS` | `MANAGE_INVITATIONS` | `PUBLISH_AND_SCHEDULE` | Other grants |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Open the page | membership, or any grant on the series | Yes | Yes | Yes | Yes | Yes | Yes |
| Series details form, delete series | `updateEventSeriesMeta`, `deleteEventSeries`: admin | Yes | — | — | — | — | — |
| Invites | `addSeriesInvite`, `removeSeriesInvite`: `MANAGE_INVITATIONS` on the series | Yes | — | — | Yes | — | — |
| Schedule items | `app/actions/schedule.ts`: `PUBLISH_AND_SCHEDULE` on the series | Yes | — | — | — | Yes | — |
| Attendees (first occurrence): approve, decline, give spot, edit, remove | RSVP cores: `MANAGE_REGISTRATIONS` on the series | Yes | — | Yes | — | — | — |
| Occurrence report PDFs | `GET /api/reports/instance/:id`: admin | Yes | — | — | — | — | — |

## Organisation-level screens

Creating events and series, organisation settings, members and invitations,
API access (`app/actions/api-clients.ts`, owner only), and deleting the
organisation are owner/admin (or owner) operations that no collaborator grant
reaches. Collaborators who are not members see only the list of events they
co-organise on `/dashboard/:orgSlug`.

## Mobile API

`lib/mobile/permissions.ts` derives `EventPermissions` for `/api/mobile/v1`:
`checkIn` and `schedule` match the web (`CHECK_IN`, `PUBLISH_AND_SCHEDULE`);
`sendEmails`, `manageFeedback` and `manageRegistrationWindow` are admin-only on
both. `manageRegistrations` is still admin-only in the mobile contract, while
the web guest list and the shared RSVP cores now also accept the
`MANAGE_REGISTRATIONS` grant. The flag only hides controls: a mobile client
that calls a guest action for a collaborator with that grant gets the same
result as the web. Aligning the flag is a mobile contract change and is left
for a mobile release. Mobile collaborations list standalone-event grants only.

## Known gaps

- `EDIT_DETAILS` does not cover the Details form. `updateEvent` writes
  publication status, privacy, discovery listing, capacity and the
  registration window in one action, which are owner/admin decisions, so a
  co-organiser edits page content but not the title or dates. Splitting the
  form would let the grant cover the descriptive fields.
- The registration form questions are owner/admin only; no grant covers them.
- Custom check-in lists are web-only for now: the mobile API, offline check-in,
  the venue station and series occurrences do not reach them. The cores in
  `lib/core/checkinLists.ts` already take a `source` (`mobile-scan`,
  `mobile-manual`) so the mobile API can reuse them unchanged.
