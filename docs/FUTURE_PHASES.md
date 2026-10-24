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
- Hackathon submissions, judging, and results built on team registration: project submissions per team, judging criteria and scoring, judge assignments, and published results.
- Team registration for recurring series and occurrences (today series stay individual and their validators refuse team settings).
- Team support in the mobile API (create, join, and manage teams; team fields in DTOs) and the machine API (team rosters behind a separately scoped credential). Today the mobile API registers solo or returns `TEAM_REQUIRED`, and no API DTO has team fields.
- Email notifications for team invitations and join requests (today they appear only on the team and ticket pages).
- Extend the machine API only for concrete consumers: recurring series/instances, RSVP workflow data, separately scoped participant contact or registration answers, privacy-preserving feedback reads, and narrow idempotent writes.

## Scale and reliability

- Separate worker processes instead of the in-process outbox worker that each application instance runs.
- Load and soak testing with documented capacity targets.
- Queue-depth, latency, object-store, and email-delivery service-level objectives.
- Multi-region/read-replica planning if real traffic requires it.
- Automated restore verification and disaster-recovery exercises.

## Documentation rule

Move an item from this file to the appropriate current-state document only after the code, migrations, tests, configuration, and operational requirements are complete.
