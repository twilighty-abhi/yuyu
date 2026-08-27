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

- Self-service account data export, correction, and deletion workflows.
- Audited organiser exports with purpose/approval recording.
- Configurable tenant-level retention policies for registrations, feedback, and audit history.
- Consent and policy-version records where legally required.

## Product expansion

- Paid tickets, taxes, refunds, discounts, and payment-provider reconciliation.
- Rich attendee communications: campaigns, reminders, templates, delivery preferences, and unsubscribe management.
- Calendar feeds and external calendar synchronization.
- Expanded event analytics with privacy-preserving aggregation.
- Organisation branding, custom domains, and configurable certificate templates.
- More granular custom roles and per-action permissions.
- Import/export tools for events and attendee rosters.
- Extend the machine API only for concrete consumers: recurring series/instances, RSVP workflow data, separately scoped participant contact or registration answers, privacy-preserving feedback reads, and narrow idempotent writes.

## Scale and reliability

- Dedicated asynchronous workers instead of scheduler-driven HTTP batches.
- Load and soak testing with documented capacity targets.
- Queue-depth, latency, object-store, and email-delivery service-level objectives.
- Multi-region/read-replica planning if real traffic requires it.
- Automated restore verification and disaster-recovery exercises.

## Documentation rule

Move an item from this file to the appropriate current-state document only after the code, migrations, tests, configuration, and operational requirements are complete.
