# Yuyu

<p align="center">
  <a href="https://github.com/twilighty-abhi/yuyu">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="public/brand/lockup-horizontal-dark.svg" />
      <img src="public/brand/lockup-horizontal.svg" width="203" height="60" alt="Yuyu" />
    </picture>
  </a>
</p>

<p align="center">
  A self-hosted platform for creating, running, and following up on free events.
</p>

<p align="center">
  <a href="https://github.com/twilighty-abhi/yuyu">View on GitHub</a>
  ·
  <a href="docs/README.md">Documentation</a>
  ·
  <a href="docs/DEVELOPMENT.md">Local development</a>
  ·
  <a href="docs/DEPLOYMENT_DOCKER.md">Production deployment</a>
  ·
  <a href="CONTRIBUTING.md">Contributing</a>
</p>

Yuyu is a multi-tenant event platform built with Next.js, PostgreSQL, Prisma,
Auth.js, Tailwind CSS and Radix UI. It is designed for organisers who want to retain
control of their data and run free events without payments, ticket sales, or
advertising trackers.

## What it includes

- Public, hidden-link, invite-only, and approval-required events, with an option to list approval-required events on Discover
- A clear Publishing section, custom accent colours, a cover photo editor (crop, adjust, preview), and short links (`/aB3x9Kq`) for sharing
- Custom registration forms, capacity limits, waitlists, and approvals
- QR tickets that tear away live on the attendee's phone the moment they are checked in
- Offline-capable door check-in, PIN-locked door stations, and badge printing with a quick print sheet and stock-sized templates
- Event websites with programme tracks, speakers, venues, sponsors, FAQs, and resources
- Event emails with five designs, a review step, and a five-second undo before a broadcast sends
- Feedback forms, response reporting with CSV export, certificates built from text and image layers on your own artwork, and a post-event PDF report
- An account area with your registrations and certificates, your organisations (including leaving one), security settings, and a personal data export
- Team registration for hackathons and competitions (teams count as one place, join links, a team page, and *looking for a team* matching), with project submissions, rubric judging by invited judges, automatic judge assignment, awards, a public results page and a searchable project gallery
- An event crew list with crew tickets that never take a guest's place, a crew sign-up link, food preferences for catering, and an optional Crew section on the event page
- A manual "Are you still coming?" attendance confirmation before the event, with reminders and an optional switch that frees the place when a guest says No
- Custom check-in lists beyond venue entry (swag, meals, workshops), saved views and filtered CSV exports on long organiser lists, and server-side paging that keeps events with thousands of registrations fast
- Recurring event series, organisation roles, event collaborators (including judges), tenant-bound API clients, and signed organisation webhooks
- An in-app help centre at `/help` with search, screenshots and Help links from dashboard screens
- A mobile API (`/api/mobile/v1`) for the Yuyu Android and iOS apps: sign-in, your tickets and team, discovery and registration, organiser day-of work such as check-in, guest and team approval and the live programme, and a judge's scoring workspace
- A separate super-admin area with MFA step-up, instance settings that apply on every replica without a restart (SMTP with a test email, Google SSO, backup posture), and read-only insights on activity, email, and security
- An optional operational alerts webhook (Mattermost or Slack-compatible) for server errors, sign-in and email failures, browser crashes, and restarts, with redacted text
- Security-conscious operations: private object storage, CSP nonces, rate limiting, audit events, outbox email, and readiness checks
- Light and dark modes, accessible defaults, and organiser colours on every event page

## Design and brand

Yuyu's interface follows the [design system brief](docs/DESIGN.md): ink neutrals,
Bricolage Grotesque and Figtree, and organiser accent colours on event pages.
Yuyu's own identity is the **dot sign**, a 5×5 grid of round dots that draws a "Y"
in marigold (`#FFB547`). It appears only on Yuyu's surfaces. Organiser logos,
covers and certificates are never rebranded.

- Brand components: `components/brand/` (`DotMark`, `DotLockup`, `DotFace`, `DotIcon`, `DotLoader`)
- SVG masters and generated icons: `public/brand/` (regenerate with `npm run brand:generate`)
- Usage rules: [docs/DESIGN.md §2.3](docs/DESIGN.md#23-colour--brand-dot-sign)
- The public About page opens a sealed-envelope building note on how Yuyu came to be (`components/landing/about/BuildingNote.tsx`)

## Quick start (local development)

```bash
npm install
docker compose up -d
cp .env.example .env
npm run db:migrate
npm run dev
```

Open `http://localhost:3000`.

Set `NEXT_PUBLIC_BASE_URL` to an address recipients can reach if you want links
and images in sent emails to work; previews in the dashboard work without it.

For local services and development notes, see [Local development](docs/DEVELOPMENT.md).

## Production deployment

Yuyu ships a standalone Docker build and a Helm chart. Production requires
TLS-backed PostgreSQL, Redis, private S3-compatible storage, authenticated SMTP,
and a reverse proxy. Apply migrations as a separate release step before rolling
out the application image.

`NEXT_PUBLIC_BASE_URL` must be the public HTTPS address (it is build-visible, so
changing it needs a rebuild); emails use it for every link and image. Redis also
carries live ticket check-in updates between replicas, so run more than one
replica only with a shared `REDIS_URL`. The reverse proxy or ingress must not
buffer the live ticket stream at `/api/ticket/:token/events`.

- [Docker deployment guide](docs/DEPLOYMENT_DOCKER.md)
- [Helm chart](charts/yuyu/README.md)
- [Production release checklist](docs/PRODUCTION_RELEASE.md)

## Documentation

The project handbook lives in [`docs/`](docs/README.md):

- [Features](docs/FEATURES.md)
- [Team registration](docs/TEAMS.md), [hackathon judging](docs/HACKATHON.md) and [event crew](docs/CREW.md)
- [Design system and brand](docs/DESIGN.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Local development](docs/DEVELOPMENT.md)
- [Configuration](docs/CONFIGURATION.md)
- [Routes and HTTP endpoints](docs/ROUTES.md)
- [Machine API v1](docs/API.md)
- [Mobile API v1](docs/MOBILE_API.md)
- [Organisation webhooks](docs/WEBHOOKS.md)
- [Security model](docs/SECURITY.md)
- [Permissions matrix](docs/PERMISSIONS.md)
- [Testing and quality gates](docs/TESTING.md)
- [Large-event performance](docs/PERFORMANCE.md)
- [Production release checklist](docs/PRODUCTION_RELEASE.md) (including [upgrading from production `bf7a04d`](docs/PRODUCTION_RELEASE.md#upgrading-from-production-bf7a04d))
- [Production operations](docs/production-operations.md)
- [Production Docker deployment](docs/DEPLOYMENT_DOCKER.md)
- [Isolated staging deployment](docs/DEPLOYMENT_STAGING.md)
- [Docker Hub publishing](docs/DOCKERHUB_ACTIONS.md)
- [Future work](docs/FUTURE_PHASES.md)
- [Changelog](CHANGELOG.md)

The user guide for organisers, guests, door staff and instance administrators
is the in-app help centre at `/help`, built from the MDX articles in
[`content/help/`](content/help/README.md). It replaces the old PDF user manual.

## Common commands

```bash
npm run dev                  # development server
npm run lint                 # ESLint
npx tsc --noEmit             # TypeScript validation
npm run test:unit            # unit tests
TEST_DATABASE_URL=… npm run test:integration  # PostgreSQL-backed tests; use a separate, disposable database
npm run test:e2e             # browser tests against development
npm run test:e2e:production  # browser tests against standalone output
npm run test:coverage        # repository-wide coverage report
npm run build                # production build
npm run brand:generate       # rebuild favicon, app icons, social card and email lockup from public/brand SVGs
npm run help:screenshots     # recapture help-centre screenshots (disposable local database only; see content/help/README.md)
```

Operator commands:

```bash
npm run db:deploy            # apply migrations (release step)
npm run db:status            # show migration state
npm run db:verify            # verify the production schema contract
npm run production:check     # validate production configuration
npm run db:backup            # create a database archive
npm run db:restore           # restore an archive (destructive; see production operations)
npm run storage:migrate      # move legacy database assets to S3
node scripts/check-instance-secrets.mjs  # check MFA_ENCRYPTION_KEY decrypts saved panel secrets
```

See [Testing](docs/TESTING.md) and [Production operations](docs/production-operations.md) for details.

## Contributing

Bug reports, ideas and pull requests are welcome:

- [Report a bug](https://github.com/twilighty-abhi/yuyu/issues/new)
- [Suggest an idea or ask a question](https://github.com/twilighty-abhi/yuyu/discussions)
- [Contributing guide](CONTRIBUTING.md)

Please report security issues privately rather than in a public issue (see the contributing guide).

## License

No license file is currently included. Do not redistribute the project as open
source until a license is added.
