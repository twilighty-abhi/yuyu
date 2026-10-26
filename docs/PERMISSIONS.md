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
| `JUDGE` | The hackathon judging workspace only ([Hackathon judging](HACKATHON.md)): reading and scoring the submissions the judge may see, with private reviews. Standalone events only. It satisfies no other check, and a non-member whose only grant is `JUDGE` is *judge-only*: the dashboard shows the judging workspace and nothing else (`isJudgeOnly`) |

## Event dashboard

`/dashboard/:orgSlug/event/:eventId`. "Admin" means organisation OWNER/ADMIN.
"—" means the control is hidden or replaced by a "no permission" note.

| Area and control | Server check | Admin | Member | `EDIT_DETAILS` | `MANAGE_REGISTRATIONS` | `MANAGE_INVITATIONS` | `CHECK_IN` | `PUBLISH_AND_SCHEDULE` | `JUDGE` | All grants |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Open the dashboard | `loadEventDashboard`: membership, or any grant on the event | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Judging only³ | Yes |
| Header: live numbers | page render; `canManageRegistrations` | Yes | — | — | Yes | — | — | — | — | Yes |
| Header: report PDF (after the event) | `GET /api/reports/event/:id`: admin | Yes | — | — | — | — | — | — | — | — |
| Header and Check-in tab: Open check-in | check-in page: `CHECK_IN` | Yes | — | — | — | — | Yes | — | — | Yes |
| Overview: readiness "Publish" | `publishEvent`: `canPublishEvents` (admin) | Yes | — | — | — | — | — | — | — | — |
| Overview: cover image item, At a glance "Edit" | `updateEvent`: admin | Yes | — | — | — | — | — | — | — | — |
| Overview: programme item | schedule actions: `PUBLISH_AND_SCHEDULE` | Yes | — | — | — | — | — | Yes | — | Yes |
| Overview: registration-form item | registration-form actions: admin | Yes | — | — | — | — | — | — | — | — |
| Overview: station PIN item | `app/actions/checkin-station.ts`: admin | Yes | — | — | — | — | — | — | — | — |
| Overview: sign-ups, approvals ("Waiting for you") | RSVP cores: `MANAGE_REGISTRATIONS` | Yes | — | — | Yes | — | — | — | — | Yes |
| Overview: email item | broadcast core: admin | Yes | — | — | — | — | — | — | — | — |
| Overview: short link create/regenerate | `app/actions/shortLink.ts`: admin | Yes | — | — | — | — | — | — | — | — |
| Overview: existing short link (copy only) | none (public link) | Yes | Yes | Yes | Yes | Yes | Yes | Yes | — | Yes |
| Overview: "Embed" shortcut | none (Settings section is admin-only) | Yes | — | — | — | — | — | — | — | — |
| Overview: team card | collaborator actions: admin | Yes | — | — | — | — | — | — | — | — |
| Overview: readiness line "Attendance: N coming · N not coming · N no reply" (counts only, once guests were asked)⁴ | `loadAttendanceReplyCounts` only for `canSendEmails`: admin | Yes | — | — | — | — | — | — | — | — |
| Overview: "See how it went" (ended) | Analytics visibility | Yes | — | — | Yes | — | — | — | — | Yes |
| Guests · People: list, filters, ticket links | `loadAttendeesFirstPage` / `loadAttendeesPage` only for `canManageRegistrations` | Yes | — | — | Yes | — | — | — | — | Yes |
| Guests · People: attendance confirmation badge, note, filter and counts; CSV attendance columns | same list query and attendee CSV route: admin or `MANAGE_REGISTRATIONS` | Yes | — | — | Yes | — | — | — | — | Yes |
| Guests · People: approve, decline, give spot, add, edit, remove, undo remove | `lib/core/rsvpLifecycle.ts`, `lib/core/rsvpAdmin.ts`: `canManageRegistrationsFor` | Yes | — | — | Yes | — | — | — | — | Yes |
| Guests · People: undo check-in | `lib/core/checkin.ts`: `CHECK_IN` | Yes | — | — | — | — | — | — | — | Yes |
| Guests · Teams (TEAM events): list, approve, decline, give spot, rename, move member, delete and undo | `app/actions/team-admin.ts` via `resolveOrganiserEvent` (`lib/core/teams.ts`): `canManageRegistrationsFor` | Yes | — | — | Yes | — | — | — | — | Yes |
| Guests · Crew ([Event crew](CREW.md)): list and food summary, add, edit, show/hide, reorder, remove, photo upload, sign-up link create/rotate/disable | `app/actions/crew.ts` via `resolveOrganiserEvent` (`lib/core/teams.ts`): `canManageRegistrationsFor` | Yes | — | — | Yes | — | — | — | — | Yes |
| Guests · People: Export CSV / Export emails (current filters) | `GET /api/exports/events/:id/attendees`, `…/attendee-emails`: admin or `MANAGE_REGISTRATIONS` | Yes | — | — | Yes | — | — | — | — | Yes |
| Guests · Teams: Export CSV (current filters) | `GET /api/exports/events/:id/teams` via `resolveOrganiserEvent`: admin or `MANAGE_REGISTRATIONS` | Yes | — | — | Yes | — | — | — | — | Yes |
| Guests · Invites | `app/actions/invites.ts`: `MANAGE_INVITATIONS` | Yes | — | — | — | Yes | — | — | — | Yes |
| Event page · Details (title, dates, venue, capacity, privacy, discovery, registration window, cover, logo) | `updateEvent`, `uploadEventCoverImage`: admin | Yes | — | — | — | — | — | — | — | — |
| Event page · Page & programme: content editor | `app/actions/event-website.ts`: `EDIT_DETAILS` | Yes | — | Yes | — | — | — | — | — | Yes |
| Event page · Page & programme: "Open schedule" | schedule page and actions: `PUBLISH_AND_SCHEDULE` | Yes | — | — | — | — | — | Yes | — | Yes |
| Event page · Registration form | `app/actions/registration-form.ts`: `requireOrgRole(ADMIN)` | Yes | — | — | — | — | — | — | — | — |
| Emails: compose, test, send, history | `lib/core/broadcasts.ts`: admin | Yes | — | — | — | — | — | — | — | — |
| Emails: Attendance confirmation card (preview, ask guests, ask newly confirmed guests, remind people who haven't replied, release-on-decline switch)⁴ | `lib/core/attendanceCheck.ts`: admin (`canManageEvents`, exactly as broadcasts) | Yes | — | — | — | — | — | — | — | — |
| Check-in: desk, counts, ID cards | `lib/core/checkin.ts`: `CHECK_IN` | Yes | — | — | — | — | Yes | — | — | Yes |
| Check-in desk: attendance confirmation badge on a looked-up guest (no note) | `lib/core/checkin.ts`: `CHECK_IN` | Yes | — | — | — | — | Yes | — | — | Yes |
| Check-in: check-in lists card, list switcher, scan/search into a list, undo, list guest view | `lib/core/checkinLists.ts` (`checkInToListForUser`, `undoListCheckInForUser`, `lookupListAttendeesForUser`): `CHECK_IN` (`canCheckInToLists`) | Yes | — | — | — | — | Yes | — | — | Yes |
| Check-in: Manage lists (create, rename, reorder, archive, restore, requires entry check-in) | `lib/core/checkinLists.ts` (`createCheckInListForUser`, `updateCheckInListForUser`, `reorderCheckInListsForUser`): `EDIT_DETAILS` (`canManageCheckInLists`) | Yes | — | Yes² | — | — | — | — | — | Yes |
| Check-in: door station PIN on/reveal/rotate/off | `app/actions/checkin-station.ts`: admin + fresh sign-in | Yes | — | — | — | — | — | — | — | — |
| Check-in: Export attendance | attendee CSV route | Yes | — | — | —¹ | — | — | — | — | Yes |
| Feedback: form, settings, certificate builder | `app/actions/feedback-form.ts`, `app/actions/certificate.ts`: admin | Yes | — | — | — | — | — | — | — | — |
| Feedback: responses (paged, `loadFeedbackResponsesPage`) and CSV | `GET /api/exports/events/:id/feedback`: admin | Yes | — | — | — | — | — | — | — | — |
| Analytics: numbers | page render; `canViewAnalytics` | Yes | — | — | Yes | — | — | — | — | Yes |
| Analytics: report PDF | report route: admin | Yes | — | — | — | — | — | — | — | — |
| Settings: co-organisers (invite, grants, remove, cancel invite) | `app/actions/event-collaborators.ts`: admin | Yes | — | — | — | — | — | — | — | — |
| Settings: event address (slug) | `updateEventSlug`: admin | Yes | — | — | — | — | — | — | — | — |
| Settings: clone | `cloneEvent`: admin | Yes | — | — | — | — | — | — | — | — |
| Settings: embed snippets | none (public URLs); admin-only by product rule | Yes | — | — | — | — | — | — | — | — |
| Settings: delete event | `deleteEvent`: admin | Yes | — | — | — | — | — | — | — | — |
| Schedule page (`…/schedule`) | page and `saveSession`/track/delay actions: `PUBLISH_AND_SCHEDULE` | Yes | 404 | 404 | 404 | 404 | 404 | Yes | 404 | Yes |
| Check-in page (`…/check-in`) | page and check-in actions: `CHECK_IN` | Yes | 404 | 404 | 404 | 404 | Yes | 404 | 404 | Yes |
| Judging tab: shown | page render; `canJudge` or `canManageJudging`, and the event uses judging (`eventUsesJudging`) | Yes | — | — | — | — | — | — | Yes | Yes |
| Judging: workspace (submissions to judge, scores, private review, Score next project) | `lib/judgingAccess.ts` `resolveJudgeContext`, `lib/core/judging.ts` (`nextSubmissionForJudge` uses the list's visibility query): admin or `JUDGE`; conflict-of-interest entries hidden | Yes | — | — | — | — | — | — | Yes | Yes |
| Judging: settings, window, rubric, assignments, judging status, Hackathon emails switches | `resolveJudgingOrganiser`: admin (`canManageJudging`) | Yes | — | — | — | — | — | — | — | — |
| Judging: disqualify, reinstate, awards, Adjust for harsh/generous judges, publish and unpublish results | `resolveJudgingOrganiser`: admin | Yes | — | — | — | — | — | — | — | — |
| Judging: Send results email now (`sendResultsAnnouncement`) | `resolveJudgingOrganiser`: admin (same as publishing results); broadcast rate-limit bucket | Yes | — | — | — | — | — | — | — | — |
| Judging: Progress, review target, automatic assignment (preview and apply) | `resolveJudgingOrganiser` (`app/actions/judging-ops.ts`, `lib/core/judgingOps.ts`): admin | Yes | — | — | — | — | — | — | — | — |
| Judging: Submissions and Results Export CSV (current filters) | `GET /api/exports/events/:id/judging`: admin | Yes | — | — | — | — | — | — | — | — |
| Saved views on Guests · People and Teams: apply, save, rename, share, delete own; the URL filters | `app/actions/saved-views.ts` via `resolveSavedViewAccess` (`lib/core/savedViews.ts`): `canManageRegistrationsFor` (Teams: TEAM events) | Yes | — | — | Yes | — | — | — | — | Yes |
| Saved views on Judging · Submissions, Results, Progress | `resolveSavedViewAccess`: admin | Yes | — | — | — | — | — | — | — | — |
| Saved views: delete a view someone else shared | `deleteSavedView`: admin (creators always delete their own) | Yes | — | — | — | — | — | — | — | — |
| Settings: turn submissions on (before the Judging tab appears) | `updateJudgingSettings`: admin | Yes | — | — | — | — | — | — | — | — |

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

³ A non-member whose only grant is `JUDGE` sees the event header and the
judging workspace and nothing else: no tabs, header numbers, page link, or
check-in. A member or a co-organiser with other grants who also holds `JUDGE`
gets the Judging tab next to what their other grants allow.

⁴ Asking guests to confirm attendance emails them, so it follows the
broadcast rule exactly: organisation owners and admins only. No grant covers
emailing guests (`sendEmails` is admin-only on mobile too), so every
collaborator grant, `JUDGE` and "All grants" are refused with "You do not have
permission to email attendees.", and the card is not shown to them. The
guest's own answer page (`/attend/:token`) needs no account: the emailed link
is the only credential (see [Security](SECURITY.md#tokens-and-sensitive-links)).

A saved view only selects filters inside a list. It is never an access
grant: the list's own check runs first, a shared view is listed only to
people who pass that check on that event, and someone else's private view
reads as missing. Only its creator renames or re-shares a view.

Managing judging (settings, rubric, assignments, disqualification, awards,
results, scores CSV) is deliberately owner/admin only. It is not covered by
`MANAGE_REGISTRATIONS` or any other grant: judging decides the competition's
outcome rather than who attends, so a co-organiser who runs the guest list
cannot rewrite the rubric or publish winners. See
[Hackathon judging](HACKATHON.md#judges).

## Series page

`/dashboard/:orgSlug/series/:seriesId`, driven by `seriesCapabilities` with the
series-level grant. Grants on a standalone event never reach a series, and a
series grant never reaches a standalone event.

| Control | Server check | Admin | Member | `MANAGE_REGISTRATIONS` | `MANAGE_INVITATIONS` | `PUBLISH_AND_SCHEDULE` | Other grants (`JUDGE` cannot be granted on a series) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Open the page | membership, or any grant on the series | Yes | Yes | Yes | Yes | Yes | Yes |
| Series details form, delete series | `updateEventSeriesMeta`, `deleteEventSeries`: admin | Yes | — | — | — | — | — |
| Invites | `addSeriesInvite`, `removeSeriesInvite`: `MANAGE_INVITATIONS` on the series | Yes | — | — | Yes | — | — |
| Schedule items | `app/actions/schedule.ts`: `PUBLISH_AND_SCHEDULE` on the series | Yes | — | — | — | Yes | — |
| Attendees (first occurrence): approve, decline, give spot, edit, remove | RSVP cores: `MANAGE_REGISTRATIONS` on the series | Yes | — | Yes | — | — | — |
| Occurrence report PDFs | `GET /api/reports/instance/:id`: admin | Yes | — | — | — | — | — |

## Organisation-level screens

Creating events and series, organisation settings, members and invitations,
API access (`app/actions/api-clients.ts`, owner only), outgoing webhooks, and
deleting the organisation are owner/admin (or owner) operations that no
collaborator grant reaches.

| Control | Server check | Owner | Admin | Member | Collaborator (any grants) |
| --- | --- | --- | --- | --- | --- |
| Settings → Webhooks section and pages | `requireOrgRole(ADMIN)`; others are redirected to the organisation | Yes | Yes | — | — |
| Add, edit, delete endpoint; rotate secret; enable/disable | `app/actions/webhooks.ts`: `canManageWebhooks` (`lib/permissions.ts`), `webhookManage` rate limit, audited | Yes | Yes | — | — |
| Send test, Redeliver, delivery log | `app/actions/webhooks.ts`: `canManageWebhooks`, `webhookTest` rate limit | Yes | Yes | — | — |

Every webhook query includes the organisation, so an endpoint or delivery id
from another organisation is "not found" (a 404 page, or the action error
"Webhook endpoint not found."). See [Organisation webhooks](WEBHOOKS.md). Collaborators who are not members see only the list of events they
co-organise on `/dashboard/:orgSlug`.

## Mobile API

`lib/mobile/permissions.ts` derives `EventPermissions` for `/api/mobile/v1`:
`checkIn` and `schedule` match the web (`CHECK_IN`, `PUBLISH_AND_SCHEDULE`;
reading the programme is open to every organiser of the event, while setting
a live delay needs `schedule`);
`sendEmails`, `manageFeedback` and `manageRegistrationWindow` are admin-only on
both. `manageRegistrations` is still admin-only in the mobile contract, while
the web guest list and the shared RSVP cores now also accept the
`MANAGE_REGISTRATIONS` grant. The flag only hides controls: a mobile client
that calls a guest action for a collaborator with that grant gets the same
result as the web. Aligning the flag is a mobile contract change and is left
for a mobile release. Mobile collaborations list standalone-event grants only.
`judge` mirrors `canJudge` (OWNER/ADMIN or `JUDGE`) on events with submissions
switched on; the mobile judging routes resolve judges with the web's
`resolveJudgeContext`, and a `JUDGE`-only collaborator reaches nothing else
(organiser routes answer `NOT_FOUND`). The mobile Teams view and whole-team
actions use the web's `canManageRegistrationsFor` (so the
`MANAGE_REGISTRATIONS` grant works there, unlike the `manageRegistrations`
flag).

## Help centre

The guide at `/help` ([Features](FEATURES.md#help-centre)) is not a
dashboard, but two of its sections follow roles: *Connecting other tools*
(machine API and webhooks) needs an owner or admin role in any organisation,
and *Instance administration* is for the super-admin only
(`lib/help/access.ts`). Every other section is public. Collaborator grants
add nothing here. A section the viewer may not read is a real 404, is left
out of navigation, and is left out of the search index.

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
