# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- Role-based access control utilities (`requireAuth`, `requireOrgRole`, `canManageEvents`, `canManageMembers`, `canDeleteOrg`)
- Organisation dashboard (`/dashboard/[orgSlug]`) with stats, event list, and FAB create actions
- Event management panel (`/dashboard/[orgSlug]/event/[eventId]`) with tabs:
  - Overview, details editing, attendees table, invites, analytics cards, and check-in link
- Attendee management:
  - Search + filters
  - Delete RSVP
  - Approve/reject pending approvals
  - Promote from waitlist
- Organisation member management (`/dashboard/[orgSlug]/members`) with role changes/removals (owner-gated)
- Organisation invite links (`OrganisationInvite`) for adding members (token-based)
- Event status extended with `HIDDEN`
- Event privacy types: `PUBLIC`, `HIDDEN_LINK`, `APPROVAL_REQUIRED`, `INVITE_ONLY`
- RSVP status lifecycle: `CONFIRMED`, `WAITLISTED`, `PENDING_APPROVAL`, `REJECTED`
- RSVP API (`POST /api/rsvp`) backed by shared RSVP core (guest + logged-in)
- Rate limiting middleware for API/auth/RSVP/search (`middleware.ts` + `lib/rateLimit.ts`)
- Global discovery and search:
  - `/discover` public listings (filters + popular sort)
  - `/search` page and `GET /api/search?q=…` endpoint
- Invites for access control:
  - `EventInvite` for single events
  - `SeriesInvite` for recurring series
- Recurring events foundation:
  - `EventSeries` + `EventInstance` models
  - RRULE/ICS expansion + instance materialization (`lib/recurrence.ts`)
  - Series management dashboard (`/dashboard/[orgSlug]/series/[seriesId]`)
- Ticketing + check-in tooling:
  - Per-RSVP `checkInToken`, `checkedInAt`
  - Ticket page (`/ticket/[token]`) with QR panel + shareable link
  - Event check-in station (`/dashboard/[orgSlug]/event/[eventId]/check-in`)
- Modular stubs:
  - Email abstraction (`lib/email/*`) (no-op stub)
  - S3-compatible storage abstraction (`lib/storage/*`) (no-op stub)
- `.gitignore` tightened to exclude common local/generated artifacts (editor folders, caches, logs, temp files, local Prisma DB files)

### Changed

- Authentication: replaced email magic-link provider with an **email + password** Credentials provider (bcryptjs-hashed `User.passwordHash`) alongside existing Google OAuth. Sessions now use JWT strategy (required by Credentials). Login UI offers Sign in / Create account tabs.
- RSVP capacity handling: full events now place new RSVPs on `WAITLISTED` (instead of hard-blocking)
- Database schema expanded to support invites, RSVP lifecycle/check-in, privacy, and recurring series/instances

### Removed

- `nodemailer` dependency and the magic-link email stub in `lib/auth.ts`

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
