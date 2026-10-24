# Hackathon submissions, judging, and results

[Documentation index](README.md)

Builds on [team registration](TEAMS.md). This page is the design contract;
[Features](FEATURES.md) summarises the shipped behaviour.

## Scope

- One-off events in either registration mode. An **entrant** is a team (in
  `TEAM` mode) or a single RSVP (a solo registrant, or anyone in an
  `INDIVIDUAL` event).
- Only `CONFIRMED` entrants can submit.
- Mobile and machine APIs are out of scope; no DTO changes.

## Event settings (organiser, new **Judging** dashboard tab)

| Field | Meaning |
| --- | --- |
| `submissionsEnabled` | Turns the feature on for the event (submission form, judging, results, gallery). It can't be turned off once judging has started or results are published; closing the window is how organisers stop new projects. |
| `submissionsOpenAt`, `submissionsCloseAt` | Window, shown in the event timezone. Edits are refused outside it (server time, checked in the write transaction). |
| `judgingStatus` | `NOT_STARTED`, `OPEN`, `CLOSED`. Judges can only score while `OPEN`. Closing freezes scores. |
| `projectGalleryPublic` | After the window closes, show submitted projects at `/{orgSlug}/{eventSlug}/projects`. |
| `resultsPublishedAt` | Set when the organiser publishes results; clearing it unpublishes. |
| `resultsAnnouncedAt` | Set by the first publication that emails entrants; see Results. |

Settings changes, disqualification, closing judging, and publishing or
unpublishing results write audit events.

Entrants only reach the submission form on a live event (`PUBLISHED`, website
released). Submissions can be switched on while the event is a draft, so the
settings card shows a warning whenever the switch is on and the event is a
draft, offline (`HIDDEN`), or cancelled, and the save toast repeats it. On a
draft or offline event an entrant's ticket shows "Your project" with a line
saying submissions open once the event is published (or are unavailable while
it is offline) instead of a form; the submission pages themselves stay 404.

## Submissions

`Submission`: `eventId`; exactly one of `teamId` (unique) or `rsvpId` (unique),
enforced by a CHECK constraint; `title` (up to 120), `summary` (up to 4000,
plain text), `repoUrl`, `demoUrl`, `videoUrl` (optional, `https:` only, up to
500 characters, validated with `URL`); `status` `DRAFT`, `SUBMITTED`,
`WITHDRAWN`, `DISQUALIFIED`; `submittedAt`; `disqualifiedReason` (organiser-only);
timestamps.

Who may edit an entrant's submission (always re-scoped by event):

- **Team:** the leader via the team page (`/team/{manageToken}`), or any
  signed-in user who owns a member RSVP of that team.
- **Solo:** the signed-in owner of the RSVP, or the holder of a **submission
  link** `/submit/{token}`. A solo registrant requests that link from their
  ticket page; it is emailed to the RSVP's address through the outbox (so
  possessing the ticket QR alone is never enough). The token is random, at
  least 128 bits, stored as a SHA-256 hash on the RSVP-scoped row, and
  regenerating it retires the old one.

Entrants can save a draft, submit, edit while the window is open, and withdraw.
The editor's window line says when submissions open or close, that they are
closed, or, if the dates are missing, that the organisers haven't set them.
A team that is disbanded or a solo RSVP that is cancelled has its submission
deleted with it (cascade). An organiser's deletion of a team or registration
keeps the submission and its judging record (scores, reviews, assignments,
award places) in the undo snapshot, so undo restores them too.

An entrant is a team or a single RSVP, never both. When a solo registration
joins a team (accepting a join request or invitation, joining with a pasted
team link from the ticket or join page, or an organiser move), in the same
transaction (`moveSoloRsvpIntoTeamTx` and `organiserMoveMember` in
`lib/core/teams.ts`, both calling `retireSoloSubmissionForTeamTx` after every
other check, inside `teamTransaction` so the registration webhooks are sent
only after commit): a `SUBMITTED` solo project refuses the move until it
is withdrawn (or disqualified); a `DISQUALIFIED` one refuses a join from the
entrant side and is deleted by an organiser move; a `DRAFT` or `WITHDRAWN`
one is deleted. The solo submission link is retired. `submission-received` email goes to the person
who submitted. Organisers can disqualify (with a reason the entrant does not
see) and reinstate. Disqualifying removes the project's award places; the
dialog lists the awards it holds and, once results are published, warns that
the live results page changes straight away. Reinstating asks first and says
that lost awards are not given back (reassign them on the Awards tab).

## Judges

- New `EventPermission` value `JUDGE`, granted through the existing event
  collaborator invitation flow. A collaborator with only `JUDGE` sees only the
  judging workspace: no guest list, answers, emails, check-in, or event
  editing. Org owners and admins can also judge. `JUDGE` never satisfies any
  other check: `canAccessEvent` matches exact grants, so
  `canManageRegistrationsFor` (guest actions, team admin, attendee CSV),
  custom check-in lists (`CHECK_IN`/`EDIT_DETAILS`), email drafts and
  broadcasts (admin), and webhooks (admin) all refuse a judge-only
  collaborator, and `eventCapabilities` (`canJudge`, `isJudgeOnly`) shows such
  a viewer only the judging workspace. See [Permissions](PERMISSIONS.md).
- **Managing judging is owner/admin only.** Settings, the rubric, judge
  assignments, disqualification and reinstatement, awards, results
  publication, and the scores CSV (`canManageJudging`, `resolveJudgingOrganiser`)
  need an organisation OWNER or ADMIN. No grant reaches them, not even
  `MANAGE_REGISTRATIONS`: judging decides the competition's outcome, which is
  not registration management, and a co-organiser who runs the guest list
  should not be able to rewrite the rubric or publish winners. A future
  dedicated grant could delegate it.
- Organisers choose **All judges see all submissions** or assign specific
  submissions to specific judges (`JudgeAssignment`).
- The **Judges** tab lists **Invited judges** (`JUDGE` grants; its count is
  theirs alone) with an empty state linking to Settings, then **Organisers who
  can also judge** (owners and admins). Inside the Judging tab, the **Score**
  view speaks to organisers as organisers: an empty rubric links to the rubric
  editor on Setup, and "not started" says to open judging there.
- **Conflict of interest:** a judge whose own account owns an RSVP on that
  entrant is never shown that submission and cannot score it (checked
  server-side).
- Judges see the submission content (title, summary, links, team name). They
  never see entrant emails, answers, or ticket links.

## Rubric and scoring

- `JudgingCriterion`: name (up to 80), description (up to 500), `weight` 1 to 10,
  `maxScore` 1 to 10, `position`. The rubric can only be changed while
  `judgingStatus = NOT_STARTED`.
- `JudgeScore`: one row per submission, judge, and criterion (unique), integer
  `0..maxScore`. `JudgeReview`: one per submission and judge with a private
  comment (up to 2000, organisers only) and `submittedAt`. Judges can save
  partial scores and submit when every criterion is scored. Writes are refused
  unless `judgingStatus = OPEN` and the submission is `SUBMITTED`.
- **Result score** = the mean over counted judges (a submitted review, the
  judge can still judge the event, and no conflict of interest with that
  entrant now) of
  `Σ(weight × score / maxScore) / Σ weight × 100`, rounded to one decimal.
  Submissions with no submitted reviews have no score. Ties share a rank.

## Results and awards

- `EventAward`: name (e.g. "Overall winner", "Best design"), description,
  `position`, plus `EventAwardWinner` (award, submission, `place` 1 or more,
  unique per award and place). Organisers assign winners manually, guided by
  the ranked score table. Only `SUBMITTED` submissions can win.
- Organiser **Results** view: ranked table (score, judges counted, per-criterion
  averages), judging progress per judge, and CSV export of scores
  (`/api/exports/events/{eventId}/judging`, owners and admins only). The CSV's
  review times are ISO 8601 in the event timezone with an explicit offset
  (`2026-10-25T14:30:00+05:30`), and the column header names the zone
  (`Review submitted (Asia/Kolkata)`). Until results are published, the
  publish card's hint follows the judging status: open judging first (not
  started), close judging to finalise the scores (open), or pick winners and
  publish (closed).
- **Publishing results** sets `resultsPublishedAt`, shows
  `/{orgSlug}/{eventSlug}/results` (awards, winners' project titles, team or
  entrant display names, and links), and queues one `results-published` email
  per confirmed entrant member, once: unpublishing withdraws undelivered
  announcements (and, when none had been delivered, clears
  `resultsAnnouncedAt`), and a re-publication emails only addresses whose copy
  was withdrawn. Scores and judge comments are never public.
- Results, gallery, and submission pages follow exactly the same visibility,
  publication, and invite rules as the event page, and return a real 404
  otherwise. On the entrant's own submission pages the entrant proof (team
  link, own registration, or submission link) stands in for the invite list,
  as on the ticket and team pages; the publication rule still applies.

## Tests

- Integration (`tests/integration/judging.db.test.ts`): submissions refused
  outside the window, for non-confirmed entrants, and across events or
  organisations; a solo submission token cannot edit another entrant; a
  `JUDGE`-only collaborator cannot read guests or another event; conflict of
  interest; scores refused unless judging is open; concurrent score writes
  stay unique; the result-score formula and tie ranks; awards only for
  submitted entries; the results page hidden until published and for
  non-public events; a solo project never carried into a team; deletion undo
  restoring the project and its judging record; reviews by revoked or
  conflicted judges not counted; submissions locked on once judging starts;
  the results announcement sent once across re-publication; links stored in
  canonical `https://` form; joining a team by link applies the same solo
  project rules and still sends registration webhooks; one team undo snapshot
  restoring the project, judging record, and custom check-in list records,
  with older snapshot formats still restoring; a `JUDGE`-only collaborator
  refused by registration, check-in list, email draft, webhook, and attendee
  export surfaces; CSV review times in the event timezone with an offset.
- Unit tests: `tests/unit/event-capabilities.test.ts` (judging flags for every
  role and grant), validators (URLs `https:` only), the score formula, DTOs for
  public results, gallery, and judge views (forbidden fields), the outbox
  payloads, and `tests/unit/judging-panel-copy.test.ts` (not-live warnings,
  publish hints, organiser versus judge copy, invited judges versus
  organisers, disqualify and reinstate impact, entrant window lines, the
  zoned CSV timestamp, and the active-tab scroll target).
- End to end (`tests/e2e/judging.spec.ts`): the core journey, plus the draft
  warning, state-accurate publish hints, the organiser rubric link, the judges
  split, the disqualify warning after publication, and the active tab scrolled
  into view on a phone.
