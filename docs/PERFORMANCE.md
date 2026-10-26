# Large-event performance

[Documentation index](README.md)

How Yuyu's team, judging and gallery screens behave on a large hackathon,
how that was measured, and what changed. Re-run the measurement after any
change to these read paths.

## Data set

`tests/perf/seed-large-event.mts` fills a fresh, disposable database
(deterministic, `createMany` in batches, fake `@load.yuyu.test` addresses,
no outbox rows):

| Event | Contents |
| --- | --- |
| Load Hackathon (TEAM, 2–4 per team, solo with matching; submissions on, judging OPEN, results published) | 5,000 teams of 1–4 people; 14,970 registrations; 500 solo registrants, 300 of them seekers; 29,940 registration answers; 4,009 submissions (3,546 SUBMITTED, 150 DISQUALIFIED, 252 drafts, 61 withdrawn); 6 rubric criteria; 25 JUDGE collaborators (two of them registered on a team, so conflicts of interest apply); 19,787 reviews with 113,996 scores; 10,638 assignments; 3,000 invites; 5,938 check-ins with history; a custom check-in list; 3 awards |
| 20 smaller events in 3 organisations | INDIVIDUAL and TEAM events with 300–900 registrations or 100–300 teams, their own submissions, reviews, scores, invites and check-ins, so every index has to pick out one event |

Across the instance: 16,176 users, 26,903 registrations, 6,935 teams,
5,115 submissions, 22,331 reviews and 123,803 scores.

## How it was measured

- **Queries.** `tests/perf/measure.perf.ts` calls every loader and core
  behind the screens below (the same functions the pages, Server Actions and
  routes call), captures each SQL statement Prisma sends through its query
  events, and re-runs every captured `SELECT` under
  `EXPLAIN (ANALYZE, BUFFERS)` with the parameters inlined. "Loader" is the
  median wall time of five runs after a warm-up, including the JavaScript
  that shapes the result; "slowest SQL" is the execution time of the most
  expensive statement in that call; "rows" are the rows that statement
  returned.
- **CSV routes.** `tests/perf/export-timing.mts` signs in to a production
  build (`npm run build`, standalone server, its own Redis) as the seeded
  owner and downloads each export, reporting time to first byte, total
  time and the server's peak resident memory. The "before" column is the
  same build of the previous code against the same data without the new
  indexes.
- **Equivalence.** `tests/perf/golden.perf.ts` records the judging outputs
  (ranking under both score methods, every Progress list, the Judges tab,
  both auto-assignment previews and every row of the judging CSV) and
  checks a later run returns exactly the same.

PostgreSQL 16 on a developer laptop that was also running other work, so
treat single-digit milliseconds as noise.

```bash
createdb yuyu_load
DATABASE_URL=postgresql://…/yuyu_load npm run db:deploy
PERF_DATABASE_URL=postgresql://…/yuyu_load node tests/perf/seed-large-event.mts
PERF_DATABASE_URL=postgresql://…/yuyu_load PERF_OUT=perf.json \
  npx vitest run --config tests/perf/vitest.perf.config.mts tests/perf/measure.perf.ts
PERF_DATABASE_URL=postgresql://…/yuyu_load PERF_GOLDEN_WRITE=golden.json \
  npx vitest run --config tests/perf/vitest.perf.config.mts tests/perf/golden.perf.ts   # then PERF_GOLDEN_CHECK
PERF_DATABASE_URL=postgresql://…/yuyu_load PERF_BASE_URL=http://127.0.0.1:4550 \
  PERF_SERVER_PID=<server pid> node tests/perf/export-timing.mts
```

The seed refuses a database whose name doesn't contain `load` or `perf`, or
one that already has organisations. The export timing sets a known password
on the seeded owner.

## Results

Targets: every dashboard read under 150 ms, CSV exports streamed in bounded
memory, nothing above O(n log n) in application code.

Every dashboard scenario now meets the target. The slowest are Judging →
Progress at about 120 ms (was about 340 ms) and the results ranking at
about 100 ms (was about 310 ms). Both are computed over every project of
the event by design: ranks and outliers need the whole set.

### Screens

| Screen | Scenario | Rows (slowest statement) | Loader before (ms) | Loader after (ms) | Slowest SQL before (ms) | Slowest SQL after (ms) |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Guests · People | first page + chip counts | 51 → 4 | 13.2 | 5.1 | 4.5 | 2.0 |
| Guests · People | deep cursor page (row 14,000) | 51 → 51 | 6.0 | 3.7 | 1.1 | 0.9 |
| Guests · People | search name 'lovelace' | 4 → 4 | 23.8 | 18.0 | 17.1 | 16.5 |
| Guests · People | search email 'guest-1234' | 1 → 3 | 21.9 | 21.7 | 16.6 | 15.7 |
| Guests · People | search team name 'falcons 4' | 51 → 51 | 23.5 | 19.9 | 17.6 | 17.6 |
| Guests · People | filter status=going | 51 → 4 | 8.4 | 3.3 | 4.4 | 2.0 |
| Guests · People | filter status=waitlist | 4 → 4 | 5.3 | 3.2 | 2.1 | 2.0 |
| Guests · People | filter status=approve | 4 → 4 | 4.2 | 3.1 | 2.1 | 2.0 |
| Guests · People | filter status=declined | 4 → 4 | 4.9 | 3.1 | 2.0 | 2.0 |
| Guests · People | filter status=checkedIn | 51 → 4 | 7.8 | 3.3 | 2.3 | 2.0 |
| Guests · People | filter status=notCheckedIn | 51 → 4 | 6.5 | 3.0 | 2.6 | 2.0 |
| Guests · People | filter kind=guests | 51 → 4 | 5.7 | 3.1 | 2.5 | 1.2 |
| Guests · People | filter kind=users | 51 → 4 | 7.0 | 3.4 | 2.7 | 1.5 |
| Guests · People | filter team=solo | 1 → 1 | 5.0 | 3.1 | 1.2 | 1.2 |
| Guests · People | filter team=team | 51 → 4 | 7.7 | 3.2 | 4.3 | 2.2 |
| Guests · People | status counts (header) | 4 → 4 | 1.5 | 1.4 | 1.5 | 1.5 |
| Guests · Teams | first page | 51 → 149 | 2.6 | 2.1 | 0.6 | 0.1 |
| Guests · Teams | chip counts | 1 → 1 | 4.0 | 3.7 | 4.9 | 3.9 |
| Guests · Teams | search 'falcons' | 51 → 51 | 12.5 | 9.2 | 8.9 | 7.3 |
| Guests · Teams | search member 'guest-777' | 3 → 3 | 10.6 | 9.0 | 13.5 | 8.8 |
| Guests · Teams | filter going | 94 → 149 | 2.6 | 1.8 | 0.1 | 0.1 |
| Guests · Teams | filter waitlist | 79 → 151 | 2.6 | 1.7 | 0.1 | 0.1 |
| Guests · Teams | filter approve | 78 → 136 | 3.0 | 1.7 | 0.1 | 0.1 |
| Guests · Teams | filter declined | 149 → 149 | 2.7 | 1.7 | 0.1 | 0.1 |
| Guests · Teams | filter incomplete | 51 → 51 | 5.5 | 1.7 | 4.2 | 0.4 |
| Guests · Teams | filter looking | 51 → 132 | 2.1 | 1.7 | 0.3 | 0.1 |
| Guests · Teams | deep cursor page | 51 → 146 | 1.9 | 1.7 | 0.1 | 0.1 |
| Guests · Teams | move targets first page | 21 → 21 | 1.1 | 0.5 | 0.1 | 0.1 |
| Guests · Teams | move targets search 'owls' | 21 → 21 | 1.0 | 0.6 | 0.2 | 0.2 |
| Guests · Invites | first page | 50 → 1 | 1.3 | 0.6 | 0.4 | 0.2 |
| Guests · Invites | page 50 | 50 → 50 | 1.0 | 0.9 | 0.5 | 0.5 |
| Guests · Invites | search 'invitee-load-hackathon-12' | 50 → 50 | 2.6 | 2.5 | 1.4 | 0.8 |
| Check-in | recent first page | 26 → 16 | 2.5 | 0.5 | 1.4 | 0.0 |
| Check-in | recent next page | 26 → 14 | 2.7 | 0.5 | 1.3 | 0.0 |
| Check-in | attendee lookup 'hopper' | 12 → 12 | 19.6 | 2.5 | 15.8 | 0.5 |
| Check-in | offline roster (all) | 14,545 → 29,090 | 384.4 | 147.7 | 6.2 | 12.7 |
| Judging (organiser) | setup + status counts | 4 → 4 | 1.2 | 1.0 | 0.3 | 0.2 |
| Judging (organiser) | submissions first page | 51 → 132 | 2.5 | 1.9 | 0.5 | 0.1 |
| Judging (organiser) | submissions search 'climate' | 51 → 51 | 6.7 | 2.4 | 4.8 | 0.7 |
| Judging (organiser) | submissions status=DISQUALIFIED | 50 → 50 | 1.5 | 1.4 | 0.1 | 0.0 |
| Judging (organiser) | results page 1 (ranking) | 113,996 → 19,267 | 308.8 | 103.7 | 16.2 | 23.2 |
| Judging (organiser) | results page 40 | 113,996 → 19,267 | 324.1 | 97.0 | 16.1 | 22.3 |
| Judging (organiser) | results search 'health' | 113,996 → 19,267 | 269.4 | 95.3 | 14.1 | 22.3 |
| Judging (organiser) | award candidates search | 113,996 → 19,267 | 264.8 | 93.4 | 15.3 | 22.7 |
| Judging (organiser) | judges tab progress | 25 → 25 | 18.1 | 17.9 | 18.6 | 18.4 |
| Judging (organiser) | progress summary (all lists) | 112,288 → 19,267 | 337.3 | 122.0 | 14.1 | 23.7 |
| Judging (organiser) | progress below-target page 3 | 112,288 → 19,267 | 340.9 | 124.3 | 14.7 | 21.7 |
| Judging (organiser) | progress per judge | 112,288 → 19,267 | 330.0 | 121.1 | 14.4 | 22.6 |
| Judging (organiser) | progress outliers | 112,288 → 19,267 | 336.2 | 123.2 | 14.4 | 21.3 |
| Judging (organiser) | auto-assign preview (25 judges, keep) | 19,267 → 19,267 | 102.3 | 96.4 | 29.2 | 18.2 |
| Judging (organiser) | auto-assign preview (replace) | 19,267 → 19,267 | 105.1 | 100.4 | 29.4 | 17.9 |
| Saved-view presets | not submitted count | 1 → 1 | 3.4 | 3.1 | 2.9 | 2.6 |
| Saved-view presets | not submitted first page | 51 → 51 | 3.2 | 3.1 | 2.6 | 2.6 |
| Saved-view presets | not submitted search 'otters' | 51 → 51 | 3.6 | 3.6 | 2.2 | 2.1 |
| Saved-view presets | results unscored | 113,996 → 19,267 | 273.2 | 97.7 | 14.5 | 23.0 |
| Saved-view presets | results under two judges | 113,996 → 19,267 | 269.7 | 102.0 | 14.8 | 22.9 |
| Judge workspace | workspace list (first page + counts) | 1 → 1 | 9.9 | 9.1 | 8.2 | 7.6 |
| Judge workspace | workspace filter todo | 1 → 1 | 8.9 | 8.6 | 7.7 | 7.4 |
| Judge workspace | workspace search 'energy' | 26 → 1 | 26.8 | 8.3 | 23.3 | 7.5 |
| Judge workspace | score next | 1 → 1 | 6.9 | 6.6 | 5.0 | 5.0 |
| Public gallery and results | newest page 1 | 24 → 1 | 2.1 | 1.5 | 0.5 | 0.2 |
| Public gallery and results | newest page 60 | 24 → 1 | 2.0 | 1.5 | 0.7 | 0.2 |
| Public gallery and results | search 'water' | 1 → 1 | 44.2 | 5.4 | 24.2 | 3.4 |
| Public gallery and results | search entrant 'ada' | 1 → 9 | 46.2 | 9.0 | 24.0 | 3.8 |
| Public gallery and results | filter winners | 1 → 1 | 1.5 | 1.4 | 0.2 | 0.2 |
| Public gallery and results | sort a-z page 20 | 24 → 24 | 3.1 | 3.0 | 1.5 | 1.4 |
| Public gallery and results | sort awards | 24 → 24 | 8.8 | 8.7 | 8.3 | 7.3 |
| Public gallery and results | results page | 9 → 9 | 1.0 | 1.0 | 0.0 | 0.0 |
| Public gallery and results | results search 'smart' | 9 → 9 | 0.9 | 0.9 | 0.0 | 0.0 |
| Exports (in process) | judging results CSV (all reviews) | 113,996 → 19,267 | 1053.2 | 772.3 | 15.2 | 21.2 |
| Exports (in process) | judging submissions CSV | 201 → 552 | 286.8 | 270.7 | 0.5 | 0.2 |
| Exports (in process) | judging not-submitted CSV | 51 → 51 | 102.6 | 102.3 | 2.8 | 2.9 |
| Exports (in process) | results ranking (loadJudgingResults) | 113,996 → 19,267 | 294.3 | 103.1 | 16.7 | 22.4 |

For the ranking, Progress and auto-assignment rows, the slowest statement
after the change is the per-pair score aggregate. It runs slightly longer
than the old flat score read, but returns 19,267 aggregated rows instead of
113,996 score rows, which is where the time went before.

### CSV routes (production build, end to end)

| Route | Rows | First byte before (ms) | First byte after (ms) | Total before (ms) | Total after (ms) | Server RSS peak before (MiB) | after (MiB) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `…/{eventId}/attendees` (attendees (all)) | 14,970 | 6 | 7 | 452 | 291 | 230 | 211 |
| `…/{eventId}/attendees?status=going&q=a` (attendees (filtered: going, search)) | 12,636 | 12 | 6 | 338 | 312 | 263 | 237 |
| `…/{eventId}/attendee-emails` (attendee emails) | 14,970 | 15 | 7 | 156 | 78 | 288 | 262 |
| `…/{eventId}/teams` (teams (all)) | 5,000 | 10 | 7 | 281 | 150 | 319 | 294 |
| `…/{eventId}/judging` (judging results (all reviews)) | 19,787 | 436 | 119 | 1575 | 866 | 819 | 458 |
| `…/{eventId}/judging?view=submissions` (judging submissions) | 4,009 | 15 | 9 | 529 | 309 | 804 | 546 |

Server memory is the whole process's resident size, so it only rises
across a run; compare the two columns rather than reading them as
per-download figures. The bounded-memory guarantee comes from the stream
itself: `csvByteStream` reads the next batch only when the client has taken
the previous one, which `tests/unit/filtered-exports.test.ts` checks.

## What changed

### Indexes (`prisma/migrations/20261026000000_large_event_indexes`)

Six composite B-tree indexes, `CREATE INDEX IF NOT EXISTS` only. Each lets
a keyset-paged list read one page in index order instead of sorting every
row of the event:

| Index | Serves |
| --- | --- |
| `RSVP_eventId_createdAt_id_idx` | Guests · People newest first and its cursor pages |
| `RSVP_eventId_checkedInAt_id_idx` | Recent check-ins on the desk and the station |
| `Team_eventId_createdAt_id_idx` | Guests · Teams and the Teams CSV batches |
| `Submission_eventId_createdAt_id_idx` | Judging → Submissions and its CSV batches |
| `Submission_eventId_status_submittedAt_id_idx` | Judge workspace, gallery "newest", ranking input order, the score aggregates |
| `EventInvite_eventId_createdAt_id_idx` | Guests · Invites |

Prisma runs a migration inside a transaction, so the indexes can't be built
`CONCURRENTLY`. Each build takes a SHARE lock on its table: reads continue,
writes wait for the few seconds it takes. On a very large instance, create
the same indexes beforehand with `CREATE INDEX CONCURRENTLY` and the same
names; `IF NOT EXISTS` then makes the migration a no-op.
`tests/unit/migration-safety.test.ts` keeps the migration to `CREATE INDEX`
statements, and `npm run db:verify` checks the indexes exist.

### Queries and application code

- **Results ranking** (`loadJudgingResults`; Results, award candidates,
  saved-view presets, the judging CSV). It used to load every score and
  review row of the event (114k + 22k rows) and index them by string keys.
  Now one aggregate (`judgeWorkOnSubmitted`) returns one row per judge and
  project, grouped per project through the existing
  `JudgeScore (submissionId, judgeUserId, criterionId)` unique index (no
  sort, no scan of other events' scores). The pure scoring
  (`computeJudgingResultsFromReviews` in `lib/judgingScore.ts`) does the
  same arithmetic in the same order, so the numbers are identical;
  `computeJudgingResults` keeps its signature and delegates to it.
- **Progress and auto-assignment** read the same per-pair aggregate instead
  of every score row. Two O(judges × projects) loops went: the
  conflict-of-interest pairs now come from each judge's own registrations
  (`conflictedPairs`), and a judge's visible-project count is
  projects minus their conflicts. Building each project's reviewer list no
  longer copies an array per review.
- **Judging CSV** reads each batch's scores and reviews by their own
  `submissionId` (index lookups) instead of a relation filter that scanned
  the score table on every batch, and groups reviews per project with a map
  instead of filtering the batch for each project (which was quadratic per
  batch).
- **CSV streaming** (`lib/csvExport.ts`). The export streams used to run
  their whole read loop in `start()`, queuing the entire file in memory
  whenever the client read slower than the database. `csvByteStream` is
  pull-based with a high-water mark of one batch, and a cancelled download
  stops the reads. The attendee, teams and judging exports use it, and so
  do the attendee-emails and feedback exports, which had their own copies
  of the loop.
- **Public gallery and judge search** (`projectSearchSql`). The correlated
  `EXISTS` on team and entrant names let PostgreSQL build hashed sub-plans
  over every team and every registration in the instance, so a public
  search grew with the whole instance. They are now scalar lookups by
  primary key for this event's projects, with the same matches.
- **Offline check-in roster.** Two set-based reads (registrations joined to
  their user and team in SQL, then all of their answers) instead of
  relation lookups with one 14,500-id `IN` list per relation.

### Correctness

- `tests/integration/judging-results-equivalence.db.test.ts` keeps the
  previous implementation as a reference and compares it with the new one
  on seeded data: ranks and ties, raw and adjusted scores, criterion
  averages and judges counted under both methods; counted reviews; Progress
  outliers and stale reviews; and the judging CSV rows. The data includes a
  revoked judge, a conflict of interest, drafts, partial and out-of-range
  scores, a judge with too few reviews and one whose scores never vary.
  Removing the eligibility filter makes it fail.
- At full scale, `tests/perf/golden.perf.ts` found the ranking, every
  Progress list, the Judges tab, both previews and all 19,788 judging CSV
  rows identical before and after.

## Known limits

- Name and email search on Guests · People, Teams and the check-in lookup
  joins the registrations of the event to `User`. PostgreSQL hash-joins the
  user table (16k rows here, about 15 ms), so the cost tracks the instance's
  user count. The planner switches to index lookups as that grows, and the
  search stays scoped to one event's registrations. A trigram index would
  need the `pg_trgm` extension, which this change does not add.
- The offline roster (about 150 ms) and the judging CSV (under 1 s) are
  whole-event downloads and remain O(n) in the event's size.
