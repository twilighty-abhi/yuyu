# Yuyu — Open-source event platform

Yuyu is a Next.js + PostgreSQL event platform with a clean Material Design 3 UI and a solid foundation for multi-tenant orgs, organiser dashboards, and future scalability.

## Tech stack

- Next.js (App Router, TypeScript)
- PostgreSQL
- Prisma ORM
- Auth.js / NextAuth v5 (email + password credentials and Google OAuth)
- Material Design 3 (MUI v9 + custom theme tokens)
- Zod validation

## What you can do (today)

- **Create organisations** (multi-member ready)
- **Create events**
- **Share public links**
- **RSVP** as a signed-in user or guest email
- **Organiser dashboard** for managing events, members, attendees, invites, and check-in
- **Discovery + search** for public events

## Routes (high level)

- **Public**
  - `/` home
  - `/:orgSlug` organisation page
  - `/:orgSlug/:eventSlug` event page
  - `/discover` global discovery
  - `/ticket/:token` ticket page for an RSVP token
- **Auth**
  - `/login`
- **Dashboard**
  - `/dashboard` your organisations
  - `/dashboard/org/new` create organisation
  - `/dashboard/:orgSlug` organisation dashboard
  - `/dashboard/:orgSlug/event/:eventId` event management
  - `/dashboard/:orgSlug/event/:eventId/check-in` check-in station
  - `/dashboard/:orgSlug/members` members + invite links
  - `/dashboard/:orgSlug/series/:seriesId` series management
- **API**
  - `POST /api/rsvp` submit RSVP (guest or logged-in)
  - `GET /api/search?q=...` search endpoint for public events

## Local development setup

### Prerequisites

- Node.js (recommended: 20+)
- Docker + Docker Compose

### 1) Install dependencies

```bash
npm install
```

### 2) Start Postgres

```bash
docker compose up -d
```

Default credentials are defined in `docker-compose.yml`.

### 3) Configure environment variables

Copy the example env file:

```bash
cp .env.example .env
```

Minimum required values:

- `DATABASE_URL`: your Postgres connection string
- `AUTH_SECRET`: session encryption secret
- `AUTH_URL`: base URL for auth callbacks (local: `http://localhost:3000`)

Optional:

- `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`: enable Google OAuth
- `NEXT_PUBLIC_AUTH_GOOGLE_CONFIGURED=1`: shows the Google button in the UI
- `EMAIL_FROM`: used in the email stub logs
- `SUPER_ADMIN_EMAIL`: a single email allowed to access `/super-admin`
- `NEXT_PUBLIC_BASE_URL`: used to generate share links/invite links/ticket links (recommended in production)
- `STORAGE_PUBLIC_BASE_URL`: used by `lib/storage` (stub) for URL generation

Generate a strong `AUTH_SECRET`:

```bash
openssl rand -base64 32
```

### 4) Run migrations + generate Prisma client

```bash
npm run db:migrate
```

### 5) Start the app

```bash
npm run dev
```

Open `http://localhost:3000`.

## Authentication

### Email and password

Users can create an account with name, email, and password, or sign in with an
existing email/password pair. Passwords are hashed with `bcryptjs` (cost 12) and
stored on `User.passwordHash`. Sessions use JWTs (required by Auth.js Credentials
provider); OAuth accounts are still persisted via the Prisma adapter.

Minimum password length: 8 characters. Update the schema in
`app/actions/auth.ts` if you want stricter rules.

### Google OAuth

1. Create OAuth credentials in Google Cloud Console.
2. Set:
   - `AUTH_GOOGLE_ID`
   - `AUTH_GOOGLE_SECRET`
   - `NEXT_PUBLIC_AUTH_GOOGLE_CONFIGURED=1`
3. Restart the dev server.

## Core workflows

### Create an organisation

1. Sign in.
2. Go to `/dashboard`.
3. Create an organisation at `/dashboard/org/new`.
4. You become the **OWNER** automatically.

### Create an event

1. Open `/dashboard/:orgSlug`.
2. Click **Create Event**.
3. Fill details (title, times, timezone, location/online, capacity, status).
4. If the event is **published**, it becomes visible on:
   - `/:orgSlug/:eventSlug`
   - the org page

### Share link

- Share the public event page URL: `/:orgSlug/:eventSlug`

### RSVP (guest or signed-in)

- Public event page shows an RSVP UI.
- Guests provide an email; signed-in users can RSVP without typing email.
- Duplicate RSVP attempts are blocked.

### Organiser: manage attendees

From `/dashboard/:orgSlug/event/:eventId`:

- View all RSVPs
- Search/filter attendees
- Remove RSVPs
- For advanced privacy modes:
  - Approve/reject pending approvals
  - Promote waitlisted attendees

### Organiser: member management + invite links

From `/dashboard/:orgSlug/members`:

- View members + roles
- Owner can change roles and remove members
- Admins can create invite links (token-based) for members to join

### Check-in station + tickets

- Each RSVP gets a `checkInToken`
- Attendees can open their ticket page: `/ticket/:token`
- Organisers can use the check-in station:
  - `/dashboard/:orgSlug/event/:eventId/check-in`

## Rate limiting

Rate limiting is enforced by `middleware.ts` using `lib/rateLimit.ts` for:

- `/api/*` (global)
- `/api/auth/*` (auth)
- `POST /api/rsvp` (rsvp)
- `/api/search` (search)

Note: the current implementation uses an **in-memory** store, which is fine for local/dev but should be replaced with a shared store (Redis/Upstash/etc.) for multi-instance production deployments.

## Super admin panel

- Route: `/super-admin`
- Access: **server-side enforced** by `SUPER_ADMIN_EMAIL` (only that email can access; others get a 404).
- Monitoring endpoints:
  - `GET /api/health`
  - `GET /api/health/db`

## Production deployment notes

### Environment variables

At minimum, set:

- `DATABASE_URL`
- `AUTH_SECRET`
- `AUTH_URL`

Recommended:

- `NEXT_PUBLIC_BASE_URL` (canonical base URL used for links)
- `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` if using Google OAuth

### Database

Use a managed Postgres (or a dedicated Postgres VM). Run migrations:

```bash
npm run db:migrate
```

### Prisma + Next.js bundling

`next.config.ts` includes:

- `serverExternalPackages: ["@prisma/client"]`

This prevents runtime issues where Prisma delegates for newer models (e.g. `eventSeries`) can be missing when bundled.

## Repo structure (core)

- `app/` routes (public + dashboard + API)
- `components/` reusable UI components (MUI)
- `lib/`
  - `auth.ts` NextAuth config
  - `db.ts` Prisma client singleton
  - `permissions.ts` RBAC helpers
  - `rateLimit.ts` middleware rate limiting
  - `validators.ts` Zod schemas
- `prisma/` schema + migrations

## License

Open-source (add your preferred license file if publishing).
