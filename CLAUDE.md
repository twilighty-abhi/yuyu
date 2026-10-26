# Claude guidance for Yuyu

Read and follow [`AGENTS.md`](AGENTS.md) in full before making changes. It is
the canonical repository guidance and covers the current Next.js 16 rules,
product boundaries, security model, data/worker behaviour, testing, and
deployment constraints.

## Fast orientation

Yuyu is a production-oriented, self-hosted multi-tenant event platform. The
most sensitive current scenarios are organisation isolation and role checks;
event privacy and RSVP capacity; publishing, which sets `Event.status` and
releases `EventPage.isPublished` together in one transaction; opaque ticket,
certificate, invitation, and password-reset links; event short links that never
reveal hidden events; the
realtime ticket check-in endpoints (`/api/ticket/:token/{status,events}`,
check-in state only, channels keyed by RSVP id); the personal data export and
leave-organisation actions (own data and membership only); MFA and the
separate super-admin step-up, checked in every super-admin page; write-only,
encrypted instance SMTP/Google/alert-webhook settings; tenant-bound machine API
credentials; user-bound mobile API sessions (`/api/mobile/v1`, shared
`lib/core` mutations, strict DTOs);
image safety; outbox email delivery with an absolute `NEXT_PUBLIC_BASE_URL`;
and Docker/Helm deployment with PostgreSQL, Redis, S3, and SMTP.

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
`docs/TESTING.md`. Other sessions may edit the tree in parallel: commit with
explicit paths only. The user guide is the in-app help centre at `/help`,
written as MDX in `content/help/` (the old PDF user manual is gone).

Every new feature goes on its own branch (`feat/<short-name>`, or
`fix/<short-name>` for a bug fix) created from `main`, gets a GitHub pull
request into `main`, and is merged (merge commit, never squash or rebase) only
after the full checks pass locally and the PR's CI and Quality gate are green.
Never commit a feature directly to `main`; don't touch `staging` or delete
branches unless asked. See "Branching" in `AGENTS.md`.
