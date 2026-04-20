# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.0] - 2026-04-20

### Added

- Next.js 16 (App Router) with TypeScript
- PostgreSQL via Prisma ORM (v6) with Docker Compose for local development
- Auth.js / NextAuth v5: Google OAuth (optional via env) and email magic link with **stub** `sendVerificationRequest` (logs link to server console)
- Domain models: `User`, `Organisation`, `Membership` (OWNER / ADMIN / MEMBER), `Event` (DRAFT / PUBLISHED), `RSVP` (logged-in or guest email) with `attendeeKey` for deduplication
- Organisation creation with creator as OWNER (transaction)
- Event creation with title-based slug and collision suffix; members can create; only OWNER/ADMIN can publish or create as PUBLISHED
- Public org page `/{orgSlug}` and public event page `/{orgSlug}/{eventSlug}` (published events; draft events visible to org members only)
- RSVP server action with capacity check and duplicate handling
- Material UI v9 theme (MD3-inspired tokens), responsive layout, event cards, dialogs, RSVP form
- Zod validation for org, event, and RSVP payloads
- SEO: `generateMetadata` on published event pages
- Documentation: `docs/FUTURE_PHASES.md` for deferred scope and later phases

### Security

- Dashboard routes require session
- Event creation requires organisation membership
- Publishing requires OWNER or ADMIN
- Public RSVP only for PUBLISHED events

### Not in scope (Phase 1)

- Recurring events, waitlists, invite-only flows, approval workflows
- Transactional email delivery (beyond development stub)
- Analytics, ticketing, payments
