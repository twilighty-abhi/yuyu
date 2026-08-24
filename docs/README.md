# Yuyu documentation

This directory is the source of truth for the current product, its operation, and future plans. The code and Prisma migrations take precedence if a document becomes stale.

## Product and engineering

| Document | Purpose |
| --- | --- |
| [Features](FEATURES.md) | Current user-facing and administrative capabilities |
| [Architecture](ARCHITECTURE.md) | System boundaries, request flows, data model, and background work |
| [Local development](DEVELOPMENT.md) | Installation, database setup, and everyday commands |
| [Configuration](CONFIGURATION.md) | Environment-variable reference for development and production |
| [Routes](ROUTES.md) | Public pages, dashboards, APIs, and protected endpoints |
| [Security](SECURITY.md) | Authentication, authorization, privacy, abuse protection, and known boundaries |
| [Testing](TESTING.md) | Test suites, CI checks, coverage, and release verification |

## Deployment and operations

| Document | Purpose |
| --- | --- |
| [Production release](PRODUCTION_RELEASE.md) | Mandatory pre-deployment checklist |
| [Production operations](production-operations.md) | Deployments, probes, schedulers, backups, incidents, and privacy operations |
| [Helm chart](../charts/yuyu/README.md) | Kubernetes installation, migration hook, secrets, probes, and ingress configuration |
| [Future phases](FUTURE_PHASES.md) | Work that is not currently implemented |

## Recommended reading order

New contributors should read Development, Architecture, Features, and Security. Operators should additionally read Configuration, Production release, and Production operations before deploying.

## Documentation maintenance

Update the relevant page whenever a feature, route, environment variable, security control, migration requirement, or operational dependency changes. Do not describe planned behavior as an existing feature; planned work belongs in `FUTURE_PHASES.md`.
