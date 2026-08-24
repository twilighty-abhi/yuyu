# Local development

[Documentation index](README.md)

## Prerequisites

- Node.js 20 or newer
- npm
- Docker and Docker Compose for local PostgreSQL

Redis, SMTP, and S3 are optional during ordinary local development. They are required or explicitly validated for production.

## First-time setup

```bash
npm install
docker compose up -d
cp .env.example .env
npm run db:migrate
npm run dev
```

Open `http://localhost:3000`. The Compose database defaults are already reflected in `.env.example`.

Generate development secrets when needed:

```bash
openssl rand -base64 32
```

Use independent values for `AUTH_SECRET`, `CRON_SECRET`, `HEALTHCHECK_SECRET`, `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY`, and `MFA_ENCRYPTION_KEY`. Do not commit `.env`.

## Database workflow

```bash
npm run db:migrate  # create/apply a development migration
npm run db:status   # show migration state
npm run db:verify   # verify the production schema contract
npm run db:studio   # open Prisma Studio
```

Prefer migrations over `db:push` for changes that will be deployed. Review generated SQL, indexes, nullability, data backfills, and cascade behavior before committing it.

## Everyday development

```bash
npm run dev
npm run lint
npx tsc --noEmit
npm run test:unit
```

Next.js 16 behavior may differ from older versions. Before changing framework APIs or conventions, read the applicable guide under `node_modules/next/dist/docs/` as required by `AGENTS.md`.

## Local service behavior

- PostgreSQL stores all application data.
- Without Redis, local rate limiting uses a process-local in-memory fallback.
- Without S3 configuration, local assets can remain as database blobs.
- Email requires an SMTP service or host. Use a local mail catcher if you need to inspect messages.
- Google login appears only when credentials are configured and `NEXT_PUBLIC_AUTH_GOOGLE_CONFIGURED=1` was present at build/start time.

## Before opening a pull request

```bash
npm run lint
npx tsc --noEmit
npm run test:coverage
npm run test:integration
npm run build
git diff --check
```

Run `npm run test:e2e:production` after building when changes affect routing, security headers, authentication, tickets, or public workflows.
