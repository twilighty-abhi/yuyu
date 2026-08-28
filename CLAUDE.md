# Claude guidance for Yuyu

Read and follow [`AGENTS.md`](AGENTS.md) in full before making changes. It is
the canonical repository guidance and covers the current Next.js 16 rules,
product boundaries, security model, data/worker behaviour, testing, and
deployment constraints.

## Fast orientation

Yuyu is a production-oriented, self-hosted multi-tenant event platform. The
most sensitive current scenarios are organisation isolation and role checks;
event privacy and RSVP capacity; opaque ticket, certificate, invitation, and
password-reset links; MFA and the separate super-admin step-up; write-only,
encrypted instance SMTP/Google settings; tenant-bound machine API credentials;
image safety; outbox email delivery; and Docker/Helm deployment with
PostgreSQL, Redis, S3, and SMTP.

Before changing framework behaviour, consult the relevant Next.js 16 guide in
`node_modules/next/dist/docs/`. Before changing an unfamiliar domain, consult
the matching document in `docs/` and the Prisma schema. Never expose or copy
values from `.env`; use `.env.example` for configuration names.

For instance settings, preserve this ordering: database values override legacy
environment fallbacks; secrets are encrypted at rest and never returned to the
browser; backup fields only record posture and do not control provider backups.
For the machine API, resolve the organisation from the bearer credential, check
an explicit scope, and return a deliberately minimal DTO.

At minimum, validate targeted changes with lint, TypeScript, and the relevant
test suite. For authorization, mutation, public-route, operational, API, or
deployment changes, follow the stronger checks listed in `AGENTS.md` and
`docs/TESTING.md`.
