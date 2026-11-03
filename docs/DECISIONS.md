# Decisions

Dated records of deliberate choices, including ones that undo earlier changes,
so they are not reverted by accident. Newest first. Each entry says what was
decided, why, and what would have to change before revisiting it.

## 2026-11-03: Outbox sends one batch of 20 emails per minute

**Decision.** Each outbox scheduler pass sends a single batch of up to 20
emails (`OUTBOX_DRAIN_BATCH = 20`, `OUTBOX_DRAIN_MAX_BATCHES = 1` in
`lib/outboxWorker.ts`), about 20 a minute per scheduler. Transactional email
(sign-in, verification, password reset, tickets, team and submission emails)
is still claimed before bulk sends within each batch, and a batch in which
every send fails still ends the pass.

**Context.** The 2026-10-27 release (`bc3171b`, "release gate fixes") changed
the drain to batches of 50, repeated for up to 40 seconds per pass, so a
10,000-recipient send would not sit in the queue for hours. Every email builds
its own nodemailer transport (`lib/email/transporter.ts`, deliberately
uncached so SMTP settings apply on the next send), so every email is its own
SMTP connection and login. After the release, a broadcast to about 200 guests
through Google Workspace (`smtp.gmail.com`) made about 200 logins in a few
seconds, and Gmail refused them with
`EAUTH 454-4.7.0 Too many login attempts, please try again later`. The rest of
the batch kept retrying, which prolonged the lockout, and the alert webhook
posted one "Email delivery failed; will retry" warning per message. Before the
release, at 20 a minute, the same broadcasts were delivered in full.

**Why this option.** This instance sends at low volume, and a 200-guest
broadcast arriving over about 10 minutes is acceptable. Restoring the known
good rate was the smallest, lowest-risk fix. The 2,000-messages-a-day
Workspace sending limit was not the cause.

**Not done (yet).** Reusing one pooled SMTP connection per pass (with a short
send-rate cap) and stopping a batch at the first login or connection error
would let the queue drain faster without extra logins. Revisit that before
raising the drain rate again, or if broadcasts grow to thousands of
recipients; at that size, also consider Google's SMTP relay
(`smtp-relay.gmail.com`) or a dedicated sending provider.
