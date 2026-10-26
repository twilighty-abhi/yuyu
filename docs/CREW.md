# Event crew

[Documentation index](README.md)

The crew is an event's organising team: volunteers, hosts, stage and
logistics people. Organisers keep the crew list in **Guests → Crew**, every
crew member gets a ticket for check-in, and the event page can show the crew
as profile cards. This page is the design contract; [Features](FEATURES.md)
summarises the shipped behaviour.

## Scope

- One-off events only (`EventCrewMember.eventId`); recurring series and
  occurrences have no crew.
- A crew member is a person, not an account: they need no Yuyu sign-in.
- Crew are never part of a team and never take part in the guest
  registration flows (see [What the guest flows refuse](#what-the-guest-flows-refuse)).

## Data model

| Model / field | Meaning |
| --- | --- |
| `EventCrewMember` | One crew member: `name`, `email` (trimmed, lowercase; unique per event), `foodPreference`, `role`, `bio`, `photoUrl`, `linkedinUrl`, `showOnPage`, `joinedViaLink`, `sortOrder`. Belongs to the event and to exactly one RSVP (`rsvpId`, unique), and cascades from both. |
| `RSVP.isCrew` | Marks that RSVP as the member's crew ticket. |
| `EventCrewJoinLink` | At most one per event: the crew sign-up `token` and its `createdAt`. Cascades with the event. |
| `EventPageSectionType.CREW` | The public Crew section of the event page. |

The `RSVP_crew_shape` CHECK constraint (migration
`20261029000000_event_crew`) guarantees that a crew ticket belongs to an
event, has no team, and is `CONFIRMED`. Field limits: name 120, email 254,
food preference 80, role 120, bio 600, LinkedIn URL 500 (`http:` or `https:`
only); the photo must be an application upload in the organisation's
`event-crew` category. Names and bios are plain text. At most 500 crew members
per event.

## Capacity rule

Crew count in the event's headcount (they are confirmed and "going"), but
**never against `Event.capacity`**. Every capacity count spreads
`takesCapacity` (`{ isCrew: false }`, `lib/teamUnits.ts`) into its query:
`countConfirmedForCapacity`, `countConfirmedUnits` (team events), the
capacity helpers in `lib/rsvpCapacity.ts`, and `reserveRsvp` in
`lib/rsvpCore.ts`. An event with capacity 1 and two crew still takes one
confirmed attendee before the waitlist starts.

## Tickets and check-in

- Adding a crew member creates a `CONFIRMED` RSVP with `isCrew`, and queues
  the usual `rsvp-confirmation` outbox email. The worker re-reads the RSVP
  and words the email for the crew ("You're on the crew for …", "This is your
  crew ticket — show it at check-in.").
- When the email already has a **solo** registration for the event, an
  organiser adding them converts that registration into the crew ticket: it
  keeps its token, QR code and check-in, becomes `CONFIRMED`, and frees its
  place (a waitlisted guest is not promoted automatically; organisers give
  the spot as usual). Any *Looking for a team* profile is removed. A team
  member is refused until they leave their team.
- The ticket page shows a **Crew** chip and no cancel button or team
  section; **Account → Registrations** offers no cancel either. Crew check in
  at the desk like anyone else, and the desk shows their food preference.
- Removing a crew member deletes their ticket (and its check-in) with the
  crew row, and emits `registration.status_changed` (`CANCELLED`) to
  organisation webhooks. Adding one emits `registration.created` when a new
  ticket was created.

## Crew join link

Organisers can share a sign-up link (`/crew/:token`) so crew add themselves.

- The token is 32 random bytes, base64url, and is **stored as-is** like team
  join tokens: organisers can show it again from Guests → Crew. It is a
  bearer capability: never log it or put it in analytics or audit metadata.
- **Create** keeps an existing link, **Rotate** replaces the token (the old
  link stops working at once), **Disable** deletes it. Each is audited
  (`EVENT_CREW_LINK_CREATED`, `_ROTATED`, `_DISABLED`).
- Values that are not token-shaped are refused before any lookup. The page
  shows only the event and organisation names and time; its metadata is
  generic, and it is `noindex`, `no-referrer`, private no-store, and
  disallowed in `robots.txt`.
- Sign-ups are refused once the event is cancelled or has ended.
- People who join through the link start **hidden** (`showOnPage = false`,
  `joinedViaLink = true`) until an organiser reviews them and shows them on
  the page. The public form cannot set its own visibility.
- **No enumeration:** an email that is already on the crew, or that already
  has a registration for the event, gets the same success answer as a new
  sign-up and nothing changes. The link proves nothing about who owns an
  email, so it never converts someone's registration; organisers do that
  from Guests → Crew.
- Sign-ups use the `rsvp` rate-limit bucket per IP and per email; photo
  uploads through the link use the `upload` bucket per IP and per token, and
  go through the same validation and WebP re-encoding as every other upload.
  Link sign-ups are audited as `EVENT_CREW_JOINED_WITH_LINK` (event id only).

## Public Crew section

The event page gains a **Crew** section, listed in **Event page → Sections**.
It starts switched off and last in the order for every event, so nothing is
published until an organiser turns it on. It shows only members with
`showOnPage`, as cards with name, role, bio, photo and LinkedIn link
(`listPublicCrew`); never the email, food preference, or ticket.

## Permissions

Everything in Guests → Crew (list, add, edit, show/hide, reorder, remove,
photo upload, the join link) needs the guest-list permission: organisation
owners and admins, or a co-organiser with `MANAGE_REGISTRATIONS`
(`resolveOrganiserEvent` in `app/actions/crew.ts`). Organiser actions share
the `rsvp` rate-limit bucket and are audited (`EVENT_CREW_MEMBER_ADDED`,
`_UPDATED`, `_REMOVED`, `EVENT_CREW_PHOTO_UPLOADED`). Every core in
`lib/core/crew.ts` re-scopes the member or link to the event and
organisation, so ids from another tenant are "not found". The dashboard
shows food preferences grouped for catering.

## What the guest flows refuse

- Self-cancel of a crew ticket (`lib/core/rsvpCancel.ts`), from the ticket
  page, the account area and the mobile API.
- Organiser edit and remove from Guests · People
  (`updateRsvpRegistrationForUser`, `deleteRsvpForUser` in
  `lib/core/rsvpAdmin.ts`): crew are managed in Guests → Crew.
- Team joins, *Looking for a team* listings, invitations, and moves into a
  team (`lib/core/teams.ts` filters `isCrew: false`).
- Hackathon projects: crew are not entrants, cannot draft or submit, cannot
  request a submission link, and are not listed under *Not submitted*
  (`lib/core/judging.ts`, `lib/core/judgingEntrants.ts`).
- A second registration with the same email, through the usual duplicate-RSVP
  protection.

## Code and tests

Cores: `lib/core/crew.ts`. Server Actions: `app/actions/crew.ts`. Unit
suite `tests/unit/crew.test.ts` (schemas, tokens, food summary); PostgreSQL
suite `tests/integration/crew.db.test.ts`.
The full list of test conditions, with their coverage, is
[Event crew: test conditions](CREW_TEST_CONDITIONS.md).
