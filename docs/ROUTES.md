# Routes and HTTP endpoints

[Documentation index](README.md)

Dynamic segments are shown as `:name` for readability.

## Public pages

| Route | Purpose |
| --- | --- |
| `/` | Landing page |
| `/discover` | Paginated public event discovery |
| `/search` | Public event search UI |
| `/:orgSlug` | Public organisation page |
| `/:orgSlug/:eventSlug` | Public event details and RSVP |
| `/:orgSlug/:eventSlug/feedback` | Event feedback form when open |
| `/:orgSlug/i/:instanceId` | Recurring-series instance and RSVP |
| `/ticket/:token` | Attendee ticket status and QR page |
| `/join/org/:token` | Accept an organisation invitation |
| `/login` | Password and Google sign-in/signup |
| `/verify-email` | Consume a one-time email-verification link and activate a password account |
| `/reset-password` | Password-reset request and completion |

## User and organisation dashboard

| Route | Purpose |
| --- | --- |
| `/dashboard` | User's organisations |
| `/dashboard/security` | MFA and session controls |
| `/dashboard/org/new` | Create an organisation |
| `/dashboard/:orgSlug` | Organisation events and series |
| `/dashboard/:orgSlug/settings` | Organisation settings |
| `/dashboard/:orgSlug/members` | Members, roles, and invitations |
| `/dashboard/:orgSlug/event/:eventId` | Event overview, attendees, forms, invites, and feedback |
| `/dashboard/:orgSlug/event/:eventId/check-in` | Online/offline check-in station |
| `/dashboard/:orgSlug/series/:seriesId` | Recurring-series management |

Dashboard pages require authentication and enforce membership/role permissions on the server.

## Super-admin pages

The `/super-admin` area includes overview, audit log, auth, events, invites, monitoring, operations, organisations, storage, and users. The Auth page includes the instance-wide new-account creation control. Access requires the authenticated email configured in `SUPER_ADMIN_EMAIL`; other users receive a not-found response.

Every super-admin page additionally requires a current TOTP verification. Users without a valid 10-minute step-up proof are sent to `/super-admin-mfa`; authenticator MFA must be enrolled first from `/dashboard/security`.

## Public and application APIs

| Method and route | Authentication | Purpose |
| --- | --- | --- |
| `POST /api/rsvp` | Optional session | Submit an event or instance RSVP |
| `POST /api/feedback` | Public, rate-limited | Submit feedback; email is used only for certificate-enabled forms |
| `GET /api/search?q=...` | Public, rate-limited | Return matching public events |
| `GET /api/ticket/:token/download` | Opaque token | Download the attendee ticket |
| `GET /api/feedback/certificate/:token` | Opaque token | Download an eligible JPEG certificate |
| `GET /api/uploads/:key` | Public application route | Stream a stored safe derivative with response controls |
| `/api/auth/*` | Auth.js | Session, provider, callback, and credential endpoints |
| `GET /api/v1/events` | Machine bearer credential + `events:read` | Paginated tenant event metadata |
| `GET /api/v1/events/:eventId` | Machine bearer credential + `events:read` | Tenant-scoped event metadata |
| `GET /api/v1/events/:eventId/participants` | Machine bearer credential + `participants:read` | Paginated minimal confirmed-participant roster, with attendance filtering; `include=attendance` also requires `participants:attendance:read` |

Opaque ticket and certificate URLs are bearer capabilities. Do not log them or place them in analytics payloads.

## Health and scheduler APIs

| Method and route | Protection | Purpose |
| --- | --- | --- |
| `GET /api/health` | Public | Process liveness without database or Redis dependency |
| `GET /api/health/db` | `Authorization: Bearer $HEALTHCHECK_SECRET` | Database readiness check |
| `POST /api/internal/outbox` | `Authorization: Bearer $CRON_SECRET` | Deliver queued email and purge expired operational data |

Self-hosted Node.js instances run the outbox worker every minute. The endpoint remains available for an independent scheduler or manual recovery. Protected operational endpoints return a generic not-found response when authorization fails.

## Mutation endpoints

Most authenticated dashboard mutations are Next.js Server Actions under `app/actions/`, not conventional REST routes. They still require server-side authentication, role checks, validation, rate limiting, and audit behavior.

Organisation owners manage machine clients at `/dashboard/:orgSlug/settings/api`. This page requires a fresh human authentication before credential, scope, or client-state mutations.
