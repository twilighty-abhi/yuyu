# Hackathon submissions, judging, and results

[Documentation index](README.md)

Builds on [team registration](TEAMS.md). This page is the design contract;
[Features](FEATURES.md) summarises the shipped behaviour.

## Scope

- One-off events in either registration mode. An **entrant** is a team (in
  `TEAM` mode) or a single RSVP (a solo registrant, or anyone in an
  `INDIVIDUAL` event).
- Only `CONFIRMED` entrants can submit. A declined (`REJECTED`) team or
  registration is final: its project can't be saved, submitted or withdrawn,
  matching the team-side refusals, and the entrant page says it was declined.
- The mobile API exposes the judge workspace only (list, score next, rubric,
  project, save scores, submit review; [Mobile API](MOBILE_API.md#judging-judges))
  through the same cores and `resolveJudgeContext`. Judging management
  (settings, rubric, assignments, awards, results) and the machine API stay
  out of scope.

## Event settings (organiser, new **Judging** dashboard tab)

| Field | Meaning |
| --- | --- |
| `submissionsEnabled` | Turns the feature on for the event (submission form, judging, results, gallery). It can't be turned off once judging has started or results are published; closing the window is how organisers stop new projects. |
| `submissionsOpenAt`, `submissionsCloseAt` | Window, shown in the event timezone. Edits are refused outside it (server time, checked in the write transaction). |
| `judgingStatus` | `NOT_STARTED`, `OPEN`, `CLOSED`. Judges can only score while `OPEN`. Closing freezes scores. |
| `projectGalleryPublic` | After the window closes, show submitted projects at `/{orgSlug}/{eventSlug}/projects`. |
| `resultsPublishedAt` | Set when the organiser publishes results; clearing it unpublishes. |
| `resultsAnnouncedAt` | Set by the first publication that emails entrants; see Results. |
| `reviewsPerProject` | Target judges per project (1 to 20, CHECK constraint; null uses the default of 3). Drives Judging → Progress and is the automatic assignment default; applying an automatic assignment stores its number here. |

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
- The **Score** list is paged on the server: 25 at a time with **Load more**
  (keyset cursor on `submittedAt, id`), filters **All**, **To score** (no
  submitted review yet), **In progress** and **Reviewed**, and a search on
  project title, team name, or a solo entrant's first name (the surname is
  never shown, so it is never matched). Visibility (status, assignment,
  conflict of interest) is applied in the same query, and the progress totals
  come from separate counts over everything the judge may see.
  `loadJudgeSubmissionsPage` re-resolves the judge on every call.
- **Score next project** (`nextSubmissionForJudge`,
  `loadNextJudgeSubmission`): while judging is `OPEN`, the server picks, among
  the projects this judge may score (same visibility query as the list) that
  they have not submitted a review for, one they already started (saved
  scores or a draft comment) first, then the fewest submitted reviews from
  anyone, then the oldest `submittedAt`, then `id`, and loads it like any
  opened project. After a judge submits a fresh review, the next project
  opens on its own with a toast ("Next up: …", with **Back to list**); the
  **All submissions** button also returns to the list. When nothing is left,
  the list shows a "You're all caught up" state. Focus moves to the project
  heading (or the done heading).
- The public gallery shows 24 projects per page with page numbers in the URL
  (`?page=N`, clamped to the last page by redirect) and an optional `?q=`
  search on the same fields (trimmed, whitespace collapsed, at most 100
  characters, ILIKE with `%`, `_` and `\` matched literally). Orders
  (`?sort=`): **Newest** (default, `submittedAt DESC, id DESC`), **A–Z**
  (`lower(title), title, id`) and, once results are published, **Awards
  first** (each project's best award by award position, creation and id as
  on the results page, then place; then everyone else A–Z, then `id`). Once
  results are published, `?filter=winners` (**Award winners**, with its own
  count) narrows to SUBMITTED projects holding an `EventAwardWinner` of the
  same event, and each card shows award badges (award name and place only).
  Before publication `winners` and `awards` fall back to the defaults and no
  badges are loaded, so the gallery never reveals winners early; any other
  invalid value falls back too. Search, filter and order run in SQL
  (`lib/galleryQuery.ts`, params in `lib/judgingPaging.ts`), counts come from
  separate queries under the same conditions, and the controls are a GET
  form (`next/form`) plus plain links, so every view is a shareable URL and
  works without JavaScript; the count is announced in a polite live region.
  Each plain page is its own canonical URL; searched, filtered and re-sorted
  views point their canonical at the plain gallery (no filter params) and are
  not indexed. The public results page is bounded by the award limits
  (`EVENT_AWARDS_LIMIT` awards, places up to `EVENT_AWARD_PLACE_MAX`); once it
  lists more than 10 winners it offers the same `?q=` search, matched on the
  shown project title and entrant name, dropping awards without a match.

## Automatic assignment

Judging → Progress → **Assign judges automatically** (owners and admins,
`canManageJudging`; cores in `lib/core/judgingOps.ts`, the pure algorithm in
`lib/judgingAssignment.ts`).

- **Who judges (the pool).** The organiser ticks the judges to draw from.
  Every `JUDGE` collaborator is ticked by default; organisation owners and
  admins are listed apart and are in the pool only when ticked (they opt in
  per run). The server re-reads eligibility (a `JUDGE` grant on the event, or
  OWNER/ADMIN of the organisation) inside the transaction and refuses the
  whole run if anyone picked can no longer judge.
- **Judges per project** N (1 to 20, default `reviewsPerProject`, else 3).
- **Keep current assignments**: existing assignments stay and count towards N
  when their judge can still judge the event and has no conflict; only the
  gaps are filled. **Start over**: existing assignments on submitted projects
  are removed, except where that judge has already saved a score or a review
  for the project (kept and counted). An assignment the new plan would pick
  straight back is left in place rather than removed and re-added.
- **Work started without an assignment.** While judges see every project,
  they can score with no assignments at all. Applying switches judges to
  "assigned projects only", so in either mode every project a judge (in the
  pool or not) has already saved scores, a draft comment or a submitted
  review for becomes that judge's assignment, provided they can still judge
  and have no conflict. It counts towards N and towards the judge's load, so
  nobody loses access to their own work and finished projects aren't given
  extra judges. When judges already see assigned projects only, a submitted
  review without an assignment still counts towards N (it counts in Results)
  and its judge isn't picked for that project again.
- **Algorithm.** Every `SUBMITTED` project gets N judges from the pool. A
  judge is never given a project they have a conflict of interest with (the
  same rule as the judge's own list: their account owns an RSVP on that
  entrant). Projects with the fewest possible judges go first; for each, the
  judges are taken from a min-heap on current load (kept plus new
  assignments on submitted projects), ties broken by a 32-bit FNV-1a hash of
  judge id and project id, then judge id, so the same input always gives the
  same plan and a re-run with nothing changed plans no changes, in either
  mode. Projects that
  can't reach N (too few judges without a conflict) are reported.
- **Preview first.** Preview writes nothing and shows each judge's
  assignments now, the change, and the total after, the projects short of N
  (the first 50 and a count), how many started projects become assignments,
  and a warning when judges currently see every project. It returns a
  fingerprint of the plan.
- **Apply** takes the Event row lock (`FOR UPDATE`, scoped by organisation),
  re-plans, refuses if the plan's fingerprint differs from the preview
  ("changed since the preview"), then in one transaction removes and adds
  assignments (including the started projects above), sets `judgesSeeAll = false` (judges then see only their
  assigned projects) and `reviewsPerProject = N`, and writes
  `JUDGES_AUTO_ASSIGNED` (N, mode, counts only, including `adopted`). Refused while judging is
  `CLOSED` or results are published.

## Progress

Judging → **Progress** (owners and admins only; the Judging tab's sub-tab
`?sub=judging-progress`). Computed on the server over the event's submitted
projects, then shown as numbered pages of 25 per list
(`loadJudgingProgressPage`, re-checked as an organiser on every call, on the
`search` rate-limit bucket). A *counted* review is the same as in Results:
submitted, by someone who can still judge the event, with no conflict of
interest. Rules are pure functions in `lib/judgingProgress.ts`.

- **Summary**: projects at target, review coverage (counted reviews, each
  project capped at the target, over projects × target), outlier and stale
  counts, and the **Target judges per project** field (empty for the
  default; audited `JUDGING_REVIEW_TARGET_UPDATED`).
- **Projects below target**: counted reviews under the target, fewest first,
  with in-progress and assigned counts.
- **Judges**: every invited judge, and organisers once they have
  assignments, scores, or reviews. Assigned (or, when judges see all, every
  project they may see), started (scores saved, review unsubmitted),
  submitted, and completion (submitted reviews of those projects over their
  number, 0 to 100), lowest completion first.
- **Outlier scores**: for a project with counted reviews from n ≥ 3 judges,
  a judge whose weighted percentage differs from the mean of the other
  judges' by more than 2 × the population standard deviation of all n; with
  n = 2, both judges when they are more than 25 points apart. Advisory only;
  nothing changes.
- **Stale reviews**: saved scores, review not submitted, last score saved
  more than 24 hours ago, oldest first.

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
  This is the **raw** score.
- **Adjusted score** ("Adjust for harsh/generous judges",
  `Event.scoreNormalization` = `ZSCORE`; `RAW` by default). Per judge, over
  that judge's counted reviews of `SUBMITTED` projects, take the mean `m` and
  the population standard deviation `sd` of their judge scores (the 0..100
  weighted percentages above); each of their scores `x` becomes
  `clamp(50 + 15 × (x − m) / sd, 0, 100)`. A judge with fewer than 3 counted
  reviews, or with `sd = 0`, keeps raw scores. The adjusted score is the mean
  of those per-judge scores, rounded to one decimal. Revoked and conflicted
  judges are left out exactly as for raw scores, so they never shift anyone's
  scale. Both scores are always computed (pure functions in
  `lib/judgingScore.ts`); the event's method only picks which one ranks (the
  Results table, the Awards picker, the CSV's rank and result score). The
  switch is owner/admin only (`setScoreNormalization`, audited
  `JUDGING_SCORE_NORMALIZATION_CHANGED` with `from` and `to`) and can change
  at any time: ranks only guide manual award choices, and public pages never
  show scores or ranks.

## Results and awards

- `EventAward`: name (e.g. "Overall winner", "Best design"), description,
  `position`, plus `EventAwardWinner` (award, submission, `place` 1 or more,
  unique per award and place). Organisers assign winners manually, guided by
  the ranked score table. Only `SUBMITTED` submissions can win.
- Organiser **Results** view: ranked table (raw and adjusted scores, the
  active one marked "ranks", judges counted, per-criterion averages), the
  **Adjust for harsh/generous judges** switch, judging progress per judge, and
  CSV export of scores (`/api/exports/events/{eventId}/judging`, owners and
  admins only; columns *Result score* (the active method's), *Raw score* and
  *Adjusted score*). The CSV's
  review times are ISO 8601 in the event timezone with an explicit offset
  (`2026-10-25T14:30:00+05:30`), and the column header names the zone
  (`Review submitted (Asia/Kolkata)`). Until results are published, the
  publish card's hint follows the judging status: open judging first (not
  started), close judging to finalise the scores (open), or pick winners and
  publish (closed).
- **Organiser paging** (`lib/judgingOrganiserPaging.ts`): Submissions loads
  50 projects at a time, oldest first (keyset on `createdAt, id`), with "Load
  more". Its status filter and search (title, team name or registrant name)
  run on the server, and the chip and tab counts are per-status totals. The
  ranking is computed over every project, then Results shows numbered pages
  of 50, so a rank and a tie are the same on every page. A search filters the
  ranked rows without renumbering them. The Awards winner picker searches the
  ranked `SUBMITTED` projects on the server, 20 at a time. The Judges view
  takes its counts from aggregates.
- **Filtered exports**: Results **Export CSV** holds the ranked rows matching
  the search and score chip showing, ranked under the score method the table
  shows (`q`, `scored`, `method`), with ranks from the whole ranking.
  Submissions **Export CSV** (`view=submissions&status=&q=`) holds every
  project matching the chip and search: project, entrant, team or solo,
  status, submitted and updated times in the event timezone, summary, links,
  assigned judges' names and the disqualification reason; *Not submitted*
  exports the entrants instead. Both read their view's own query in batches of
  200 projects (`planJudgingResultsExport`, `planJudgingSubmissionsExport`),
  stay owner/admin only with an empty 404 for anyone else, and audit filter
  names only (`JUDGING_SCORES_EXPORTED`, `JUDGING_SUBMISSIONS_EXPORTED`).
- **Saved views** ([Features → Saved views](FEATURES.md#saved-views)):
  Submissions, Results and Progress keep their filters in the address bar
  and have a **Views** menu (owners and admins, like the rest of judging
  management). Submissions gains **Not submitted** (`status=notSubmitted`):
  instead of projects it lists *entrants* without a `SUBMITTED` project,
  meaning `CONFIRMED` teams and `CONFIRMED` registrations without a team,
  whose project is missing, a draft, withdrawn or disqualified
  (`lib/core/judgingEntrants.ts`, one `UNION ALL` query with keyset paging on
  registration time and id, display names and sizes only, through
  `loadUnsubmittedEntrantsPage`, `search` bucket), with its chip count.
  Results gains a score filter (`scored=unscored`: `SUBMITTED` with no counted
  review; `scored=underTwo`: fewer than two) that filters the ranked rows
  without renumbering them, with counts over the whole ranking. Progress
  can show one list (`show=below-target`, `judges`, `outliers`, `stale`).
  Presets: *Not submitted*, *Drafts*, *Disqualified*; *Unscored*, *Scored by
  fewer than 2 judges*; *Below target*.
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
  `tests/integration/judging-normalise-next.db.test.ts`: raw versus adjusted
  ranking, the owner-only audited switch, both scores in the CSV, revoked
  judges left out of the scale, and score-next order (started first, fewest
  reviews, oldest), conflicts, assignments, the done state, closed judging
  and event scoping.
  `tests/integration/judging-paging.db.test.ts`: the judge list and the
  gallery paged end to end with ties on `submittedAt` (no gaps or repeats),
  progress filters and totals, search (wildcards literal, surnames never
  matched), assignments, conflict of interest, event scoping, forged cursors,
  page clamping, and every winner kept on the results page.
  `tests/integration/gallery.db.test.ts`: gallery orders with id tiebreaks,
  search (title, team, first name only, literal wildcards, bounded), the
  winners filter and awards order hidden until results are published and
  correct after (best award, place, then A–Z; disqualified winners and other
  events never shown), combined search, filter and order, invalid params
  falling back, public-safe DTOs, the results page search, and the event
  page's visibility rules (organisation, gallery switch, window, page
  release, status, invite-only) as a real 404.
  `tests/integration/judging-ops.db.test.ts`: the `reviewsPerProject` CHECK,
  preview writing nothing, apply in one transaction (assignments, judges see
  only assigned, target stored, audit), stale fingerprints refused,
  conflicts never assigned and shortfalls reported, ineligible judges
  refused and organisers only when picked, replace keeping started
  assignments, organisation scoping, closed judging and published results
  refused, every action refused to judges and outsiders, and the progress
  lists (below target, per judge, outliers, stale, page clamping).
- Unit tests: `tests/unit/judging-paging.test.ts` (cursor, query bounds,
  `?page=`/`?q=` parsing, page clamping, gallery links),
  `tests/unit/gallery-query.test.ts` (`?filter=`/`?sort=` parsing and
  fallbacks, publication gating, short links, the bound and escaped search,
  event scoping, and every order's id tiebreak),
  `tests/unit/judging-assignment.test.ts` (balance, conflicts, shortfalls,
  determinism, keep and replace), `tests/unit/judging-progress.test.ts`
  (outlier and stale rules, target, schemas),
  `tests/unit/judging-ops-copy.test.ts`,
  `tests/unit/event-capabilities.test.ts` (judging flags for every
  role and grant), validators (URLs `https:` only), the score formula and
  the hand-computed adjusted-score fixtures (`tests/unit/judging-score.test.ts`), DTOs for
  public results, gallery, and judge views (forbidden fields), the outbox
  payloads, and `tests/unit/judging-panel-copy.test.ts` (not-live warnings,
  publish hints, organiser versus judge copy, invited judges versus
  organisers, disqualify and reinstate impact, entrant window lines, the
  zoned CSV timestamp, and the active-tab scroll target).
- End to end (`tests/e2e/judging.spec.ts`): the core journey, plus the draft
  warning, state-accurate publish hints, the organiser rubric link, the judges
  split, the disqualify warning after publication, and the active tab scrolled
  into view on a phone. `tests/e2e/judging-ops.spec.ts`: automatic
  assignment previewed and applied from Progress (even loads, a judge's own
  project skipped, judges then see only assigned), the outlier and stale
  lists, and no Progress view for a `JUDGE`-only collaborator.
  `tests/integration/saved-views.db.test.ts` and `tests/e2e/saved-views.spec.ts`
  cover the Not submitted, Unscored and Below target views.
