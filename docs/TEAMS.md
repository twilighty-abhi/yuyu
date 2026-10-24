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
current largest team. Organisers edit these in the event's **Publishing**
section, under the sign-ups question.

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
  fails.
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
  Regenerating it invalidates the old link. The check-in token (the ticket
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
- Accepting moves the seeker's RSVP into the team under the event lock: size is
  rechecked, the RSVP takes the team status, the profile is hidden, other
  pending requests for that RSVP are cancelled, and the freed solo unit
  triggers promotion.

## Organisers

- Guests tab gets a **Teams** view: name, status, size and min/max, an
  *Incomplete* badge below `teamMinSize`, leader, and members. Actions: approve,
  reject, promote from waitlist (all as one unit), rename, remove a member, move
  a member to another team (size rechecked, member takes the target team's
  status), and delete a team with the existing undo pattern where practical.
- People view shows each RSVP's team. Filters gain "In a team" and "Solo".
- Permission checks are unchanged: the same checks that guard the individual
  RSVP actions guard the team ones. Every query is scoped by event and
  organisation, and a team id from the browser is always re-read with its
  `eventId`.
- Attendee CSV adds `Team` and `Team role` columns. The check-in desk and lookup
  show the team name. Badges gain a `{{team}}` merge field. The personal data
  export includes the team name and role.
- The post-event PDF report shows team counts (teams, solo registrants, average
  size). It never lists seeker profiles.

## Email

New outbox kinds, following `lib/outbox.ts` conventions (payload type, enqueue
helper, validator, delivery branch, capability flag because they carry tokens):

- `team-created`: to the leader, with the team page link and the join link.
- `team-member-added`: to a member added by the leader, with their ticket link.

Status changes reuse the existing RSVP status email per member, naming the team.

## Mobile and machine APIs

Out of scope for this version beyond safety: `POST /api/mobile/v1/rsvp` on a
`TEAM` event registers solo when `soloPolicy` allows it, and otherwise returns
a deliberate error code (`TEAM_REQUIRED`). No API DTO gains team fields yet.

## Tests

- Integration (`tests/integration/teams.db.test.ts`): concurrent team creation
  for the last unit never oversells; concurrent joins never exceed
  `teamMaxSize`; team approval updates all members atomically; accepting a
  seeker frees a unit and promotes the oldest waitlisted unit; cross-event and
  cross-organisation team ids are refused; and a manage token for one team
  cannot act on another.
- Unit tests: validators, the unit-count helper, status decisions, DTOs for the
  join page and seeker list (forbidden fields), and the token hashing.
