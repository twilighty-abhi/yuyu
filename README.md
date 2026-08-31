# Yuyu

Yuyu is a self-hosted, multi-tenant event platform built with Next.js, PostgreSQL, Prisma, Auth.js, and Material UI. It supports public and private events, registrations, recurring series, attendee workflows, QR check-in, feedback, certificates, and instance administration.

## Quick start

```bash
npm install
docker compose up -d
cp .env.example .env
npm run db:migrate
npm run dev
```

Open `http://localhost:3000`.

## Documentation

The project handbook lives in [`docs/`](docs/README.md):

- [Features](docs/FEATURES.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Local development](docs/DEVELOPMENT.md)
- [Configuration](docs/CONFIGURATION.md)
- [Routes and HTTP endpoints](docs/ROUTES.md)
- [Machine API v1](docs/API.md)
- [Security model](docs/SECURITY.md)
- [Testing and quality gates](docs/TESTING.md)
- [Production release checklist](docs/PRODUCTION_RELEASE.md)
- [Production operations](docs/production-operations.md)
- [Production Docker deployment](docs/DEPLOYMENT_DOCKER.md)
- [Future work](docs/FUTURE_PHASES.md)

## Common commands

```bash
npm run dev                  # development server
npm run lint                 # ESLint
npx tsc --noEmit             # TypeScript validation
npm run test:unit            # unit tests
npm run test:integration     # PostgreSQL-backed tests
npm run test:e2e             # browser tests against development
npm run test:e2e:production  # browser tests against standalone output
npm run test:coverage        # repository-wide coverage report
npm run build                # production build
```

## License

No license file is currently included. Add one before distributing the project as open source.
