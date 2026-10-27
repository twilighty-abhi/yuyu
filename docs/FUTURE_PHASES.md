# Future phases

[Documentation index](README.md)

This page contains only work that is not currently implemented. Current behavior belongs in [Features](FEATURES.md).

## Security and assurance

- Replace email-knowledge certificate eligibility with one-time inbox verification when certificates carry value or personal data.
- Expand automated coverage for every Server Action, role boundary, cross-tenant access attempt, and failure/rollback path.
- Add automated SAST, secret scanning, container scanning, and a documented vulnerability-disclosure policy.
- Commission an independent penetration test and threat-model review before handling sensitive or regulated data.
- Add optional step-up authentication for especially destructive organiser and super-admin operations.

## Privacy and account lifecycle

- Self-service account deletion and correction beyond profile name/photo.
- Audited organiser exports with purpose/approval recording.
- Configurable tenant-level retention policies for registrations, feedback, and audit history.
- Consent and policy-version records where legally required.

## Product expansion

- Scheduled reminders, delivery preferences, and unsubscribe management for attendee communications.
- Calendar feeds and external calendar synchronization.
- Cross-event and organisation-level analytics with privacy-preserving aggregation.
- Custom domains and organisation-level themes (organisation logos and per-event accent colours already exist).
- More granular custom roles and per-action permissions.
- Import/export tools for events and attendee rosters.
- Team registration for recurring series and occurrences (today series stay individual and their validators refuse team settings).
- Attendee team actions in the mobile API (create, join and manage a team, *looking for a team*) and team rosters in the machine API behind a separately scoped credential. Today the mobile API lists teams and approves, rejects or promotes them for organisers and shows attendees their own team, but registers solo (or returns `TEAM_REQUIRED`), and the machine API has no team fields.
- Email notifications for team invitations and join requests (today they appear only on the team and ticket pages).
- Entrant submissions and judging management (settings, rubric, assignments, awards, results) in the mobile API, and published results in the machine API behind a separately scoped credential. Today the mobile API has only the judge's scoring workspace, and the machine API exposes no submissions, judging or results.
- Hackathon events in the organisation webhook catalogue ([Organisation webhooks](WEBHOOKS.md)), for example `submission.submitted`, `submission.withdrawn`, and `results.published`. Each needs a new event type in `lib/webhooks/eventTypes.ts`, a minimal payload builder (project title and entrant display name only, never scores, judge comments, or the disqualification reason), commit-point emission from `lib/core/judging.ts`, the endpoint form's type list, and tests, so it was left out of the first judging release.
- Attendance confirmation ("Are you still coming?") for recurring-series occurrences. Today only CONFIRMED registrations of one-off events are asked, because a series RSVP belongs to an `EventInstance` and `AttendanceCheck.eventId` points at an `Event`; covering occurrences needs an instance-scoped check, a per-occurrence Emails card and per-occurrence counts.
- Event crew in the mobile API (the crew list, food summary and crew flag on guest and check-in rows) and the machine API. Today crew tickets appear in both as ordinary confirmed registrations.
- Attendance confirmation in the mobile API: an optional `attendanceCheck { response }` on the organiser Guest DTO, the People filter, and the send, remind and share-link actions (which would reuse `lib/core/attendanceCheck.ts` unchanged, with `sendEmails`-equivalent admin-only access). The check-in desk badge is web-only too; the mobile `CheckInResult` has no attendance field yet. Today the mobile API exposes no attendance confirmation data.
- Optional automation for attendance confirmation (for example, a suggested send time) only if organisers ask for it. Today it is deliberately manual: nothing sends the question without an organiser's explicit click.
- Extend the machine API only for concrete consumers: recurring series/instances, RSVP workflow data, separately scoped participant contact or registration answers, privacy-preserving feedback reads, and narrow idempotent writes.

## Scale and reliability

- Separate worker processes instead of the in-process outbox worker that each application instance runs.
- Load and soak testing with documented capacity targets.
- Queue-depth, latency, object-store, and email-delivery service-level objectives.
- Multi-region/read-replica planning if real traffic requires it.
- Automated restore verification and disaster-recovery exercises.

## Documentation rule

Move an item from this file to the appropriate current-state document only after the code, migrations, tests, configuration, and operational requirements are complete.
