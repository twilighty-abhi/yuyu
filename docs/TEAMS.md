# Team registration

[Documentation index](README.md)

Team events (hackathons, game jams, competitions) register people in teams.
This page is the design contract for the feature; [Features](FEATURES.md)
summarises the shipped behaviour.

## Scope

- One-off events only. Recurring series and occurrences stay individual; the
  series validators refuse team settings.
- Judging, submissions, and results are a separate feature built on top of
  teams (see [Future phases](FUTURE_PHASES.md) until it ships).

## Event settings

| Field | Type | Meaning |
| --- | --- | --- |
| `registrationMode` | `INDIVIDUAL` (default) or `TEAM` | Turns team registration on. |
| `teamMinSize` | `Int?`, at least 1 | Teams below this size are flagged *Incomplete* to organisers and cannot be approved. |
| `teamMaxSize` | `Int?`, at least 2 and at least `teamMinSize` | Required in `TEAM` mode. Enforced under the event lock. |
| `soloPolicy` | `TEAMS_ONLY`, `SOLO_ALLOWED` (default), `SOLO_WITH_MATCHING` | Whether people may register without a team, and whether solo registrants can opt in to the *Looking for a team* list. |

Database CHECK constraints keep the sizes valid. `registrationMode` cannot change
while the event has registrations, and `teamMaxSize` cannot drop below the
current largest team. Organisers can set them when creating the event (the
last step of the **Create event** dialog, with the same wording and checks) and
edit them later in the event's **Publishing** section, under the sign-ups
question. Both use the same `TeamSettingsFields` component.

## Capacity counts registration units

In `TEAM` mode `Event.capacity` counts **units**: each team is one unit and each
solo registrant (an RSVP with no team) is one unit. A unit is *confirmed* when
the team or solo RSVP is `CONFIRMED`. Team members never consume extra units.

All unit counting happens inside the existing capacity transactions, which lock
the `Event` row with `SELECT ... FOR UPDATE` (`reserveRsvp`,
`confirmRsvpWithinCapacity`, cancel, restore, and the capacity-lowering check
in `updateEvent`). Every team mutation takes the same lock first, so team
mutations serialise with every other capacity change. A shared helper
(`countConfirmedUnits(tx, eventId)`) replaces the plain confirmed-RSVP count
wherever the event is in `TEAM` mode; `INDIVIDUAL` events keep the current
query untouched.

Displays follow the same rule. The public registration card shows places taken
in units. Organiser screens (event header, analytics, overview, dashboard home
and organisation event lists, super-admin activity) show units against capacity
("3 / 3 teams & solo places", or "teams" when solo registration is off) and
the number of people going separately. The mobile organiser `EventCounts`
carries `capacityUsed` for the same purpose (docs/MOBILE_API.md).

## Team status

`Team.status` reuses `RsvpStatus` (`CONFIRMED`, `WAITLISTED`,
`PENDING_APPROVAL`, `REJECTED`). Invariant: every RSVP with `teamId = T` has
`status = T.status`. Code that changes a team's status updates the team row and
all member RSVPs in the same transaction, guarded by the expected previous
status (conditional `updateMany`), and queues one outbox status email per
member.

- Creating a team decides its status with the same rules as an individual
  RSVP (`decideRsvpStatus`, applied to units): approval-required means
  `PENDING_APPROVAL`; otherwise `WAITLISTED` when confirmed units reach capacity,
  else `CONFIRMED`.
- Joining a team never changes capacity. The new RSVP takes the team's status.
  `REJECTED` teams cannot be joined. A join that would exceed `teamMaxSize`
  fails. The leader of a `REJECTED` team can still view it, remove members and
  disband it, and members can leave; rename, join/management link resets,
  leadership transfer and "looking for members" are refused (UI and cores).
- Organisers approve, reject, and promote **whole teams**. Individual
  approve/reject/promote on an RSVP that belongs to a team is refused with a
  message pointing to the team. Approving a team below `teamMinSize` is
  refused.
- When a unit is freed (a confirmed team disbanded, deleted or cancelled, a
  confirmed solo registrant cancelled or moved into a team), the existing
  auto-promotion applies to the oldest waitlisted **unit** (a team or solo
  RSVP), and only when the event is not approval-required.

## Joining

Both ways are always available in `TEAM` mode:

1. **Join link.** The leader shares `/{orgSlug}/{eventSlug}/team/{joinToken}`.
   It opens the event's normal registration form with the team shown and fixed.
   The page reveals only the team name, current size, and maximum size. It never
   reveals member names. It respects event visibility and invite-only rules
   exactly like the event page, so it never reveals a hidden event to someone
   who could not otherwise see it. The leader can regenerate the token, which
   retires the old link.
2. **Leader adds a member.** From the team page, the leader enters a name and
   email. This creates a guest RSVP on the team (registration open checks
   apply; custom questions are skipped, as with organiser manual add), and the
   member is emailed their own ticket through the outbox. Duplicate attendees
   are refused by the existing `attendeeKey` unique indexes. On invite-only
   events this way is refused, as public guest registration is: an address on
   the invite list does not prove who typed it, so invitees sign in with their
   invited account and use the join link.

3. **Already registered on your own.** A solo registrant (an RSVP with no
   team) of the same event joins a team with its join link and keeps their
   registration and ticket (`joinTeamWithExistingRsvp`):
   - On the join page, a signed-in person's own registration for the event is
     detected server-side: a solo one gets **Join {team}** instead of the form;
     one already in this team links to the ticket; one in another team is told
     to leave it first. When this browser remembers a ticket for the event
     (the event page's saved RSVP), the page offers to join with it. The page
     also tells guests to use their ticket page.
   - The ticket page of a solo registrant on a `TEAM` event has **Join a team**,
     which accepts a pasted join link (absolute, relative, or without its
     scheme) or a bare join token. Management links are refused.
   - The ticket token proves the registration; an account-owned registration
     also needs that account signed in. The join token is looked up inside the
     registration's own event only, so another event's link never matches.
   - Under the event lock: the team size is rechecked, the RSVP takes the
     team's status, its seeker profile is hidden, its pending invitations and
     requests are cancelled, and a confirmed solo unit is freed and promotes
     the oldest waitlisted unit. A checked-in registration can only join a
     `CONFIRMED` team. Rejected teams and declined registrations are refused.
     This works while the event and its page are published and the event has
     not ended (a withdrawn page refuses it, like the join page's 404), even
     after new registrations close, because it never adds a unit.

The event page's register button says what a `TEAM` event registers
(**Register your team**, or **Register a team or yourself** when solo sign-ups
are allowed; the waitlist and approval wording follows the same split). The
wording lives in `lib/registrationLabel.ts`, shared with the dashboard's
event-page preview.

The registration form, for a `TEAM` event, offers **Create a team** (team name
required, unique per event ignoring case), **Join with a link** (explains how to
get one), and **Register solo** only when `soloPolicy` allows it. With
`SOLO_WITH_MATCHING` the solo option has an opt-in "List me as looking for a
team" with a short headline (up to 120 characters) and up to 8 skills (each up
to 30 characters).

## Team page and capabilities

- The leader receives a **team management link** `/team/{manageToken}` in the
  confirmation email. The raw token is random (at least 128 bits),
  shown once, and stored only as a SHA-256 hash (`Team.manageTokenHash`).
  Regenerating it invalidates the old link; the page moves to the new address
  and the new link is emailed to the leader. The check-in token (the ticket
  QR) never grants team management.
- A signed-in leader also reaches the team page from **Account → Registrations**
  without the token.
- On the team page the leader can rename the team, regenerate the join link,
  add or remove members, transfer leadership to another member, set *Looking for
  members*, and disband the team. Members (from their ticket page) see the team
  name, the leader's name, and members' names. They can leave the team; leaving
  cancels their RSVP.
- If the leader cancels their own registration, leadership passes to the
  longest-standing member; with no members left the team is deleted and its
  unit freed.
- Removing a member or disbanding cancels those RSVPs (they can register again
  solo or in another team). Disbanding frees the unit.

## Looking for a team (`SOLO_WITH_MATCHING`)

- Solo registrants opt in with a `TeamSeekerProfile` (headline, skills,
  `visible`). They can edit or hide it from their ticket page.
- The list shows display name (first name and last initial), headline, and
  skills. It never shows email, answers, or ticket links. Only leaders of
  non-rejected teams with free space (from the team page) and other visible
  seekers (from their ticket page) of the **same event** can see it. Pages that
  show it are `noindex` and private-cache.
- A leader can **invite** a seeker, and a seeker can **request** to join a team
  that is *Looking for members*. These are `TeamJoinRequest` rows
  (`INVITE`/`REQUEST`, `PENDING`/`ACCEPTED`/`DECLINED`/`CANCELLED`), at most one
  pending per team and RSVP. The other side accepts or declines on their page.
  No email is sent for requests in this version.
- Accepting moves the seeker's RSVP into the team under the event lock with the
  same move as joining by link (size rechecked, team status taken, profile
  hidden, other pending requests cancelled, freed solo unit promotes, checked-in
  registrations only into a `CONFIRMED` team).
- Saving the profile from the ticket page resets the edit form to the stored
  values (trimmed, duplicate skills dropped).

## Organisers

- Guests tab gets a **Teams** view: name, status, size and min/max, an
  *Incomplete* badge below `teamMinSize`, leader, and members. It is paged on
  the server, oldest first, `ORGANISER_TEAMS_PAGE_SIZE` (50) teams at a time
  with **Load more** (keyset cursor on `createdAt, id`). Search matches team
  names and members' names and emails (LIKE wildcards are literal), and the
  status filters (including *Incomplete*) are applied in the query; the
  filter counts are aggregates. After a change, the view reloads as many
  pages as were showing. Searches and further pages go through the
  read-only `loadTeamsPage` action (same organiser check, `search` rate-limit
  bucket). The People view's move targets are a separate bounded list
  (`MAX_TEAM_MOVE_TARGETS`, 200, non-rejected teams). Actions: approve,
  reject, promote from waitlist (all as one unit), rename, remove a member, move
  a member to another team (size rechecked, member takes the target team's
  status), and delete a team with the existing undo pattern where practical.
- People view shows each RSVP's team. Filters gain "In a team" and "Solo".
- Permission checks are unchanged: the same checks that guard the individual
  RSVP actions guard the team ones. Every query is scoped by event and
  organisation, and a team id from the browser is always re-read with its
  `eventId`.
- Attendee CSV adds `Team` and `Team role` columns. The check-in desk and lookup
  show the team name, and the lookup also matches team names (teams of the same
  event only), listing that team's members. Badges gain a `{{team}}` merge field. The personal data
  export includes the team name and role.
- The post-event PDF report shows team counts (teams, solo registrants, average
  size). It never lists seeker profiles.

## Email

New outbox kinds, following `lib/outbox.ts` conventions (payload type, enqueue
helper, validator, delivery branch, capability flag because they carry tokens):

- `team-created`: to the leader, with the team page link and the join link
  (also sent to the new leader on a handover and after the leader resets the
  team page link).
- `team-member-added`: to a member added by the leader, with their ticket link.

Status changes reuse the existing RSVP status email per member, naming the team.

## Organisation webhooks

Team changes raise the same per-registration webhooks as individual RSVPs
(`docs/WEBHOOKS.md`), one per member, emitted only after the transaction has
committed and with the same minimal payload (no team name, emails or tokens):

- Creating a team, joining by link, and a leader adding a member:
  `registration.created`.
- Whole-team approve, reject and promote, automatic team promotion after a
  unit is freed, and a registration moved into a team with a different status
  (seeker accepted, solo join by link, organiser move):
  `registration.status_changed` for each member whose status changed.
- A member leaving, a leader removing a member, and disbanding:
  `registration.status_changed` with `CANCELLED`. An organiser deleting a team
  (or its last member): `REMOVED`. Undoing that deletion: the restored status
  with `previousStatus: "REMOVED"`.

Undoing a team deletion (or the deletion of a team's last member) also
restores each member's custom check-in list records, for lists that still
belong to the event, exactly like the single-RSVP undo.

## Mobile and machine APIs

Out of scope for this version beyond safety: `POST /api/mobile/v1/rsvp` on a
`TEAM` event registers solo when `soloPolicy` allows it, and otherwise returns
a deliberate error code (`TEAM_REQUIRED`). No API DTO gains team fields yet.

## Tests

- Integration (`tests/integration/teams.db.test.ts`): concurrent team creation
  for the last unit never oversells; concurrent joins never exceed
  `teamMaxSize`; team approval updates all members atomically; accepting a
  seeker frees a unit and promotes the oldest waitlisted unit; cross-event and
  cross-organisation team ids are refused; a manage token for one team
  cannot act on another; a solo registrant joining by link frees and promotes
  their unit, cancels pending requests and hides their profile, while other
  events' links, full teams and checked-in moves into an unconfirmed team are
  refused; the Teams view pages, searches and filters within one event; the
  check-in lookup matches team names within the event; whole-team approval,
  deletion, promotion, disbanding and undo send one minimal
  `registration.status_changed` webhook per member; and undoing a team
  deletion restores the members' custom check-in list records.
- Unit tests: validators, the unit-count helper, status decisions, DTOs for the
  join page and seeker list (forbidden fields), the token hashing, pasted
  join-link parsing, and the Teams view cursor and search escaping.
