# Future phases and reference

Living notes for work after Phase 1. Keep the Prisma schema lean; expand here first, then migrate.

## Deferred product scope

- Recurring events and exception dates
- Waitlists and RSVP states (e.g. `CONFIRMED`, `WAITLISTED`, `CANCELLED`)
- Invite-only events and approval flows
- Real email (magic links, confirmations, reminders) — replace Nodemailer stub with SMTP, Resend, etc.
- Analytics (views, conversion, attendance)
- Org-level billing and roles beyond OWNER/ADMIN/MEMBER

## Schema ideas (not implemented)

- `Event`: `createdByUserId`, `recurrenceRule`, `visibility` enum, `cancelledAt`
- `RSVP`: `status`, `checkedInAt`, optional `plusOne` count
- Partial unique indexes on `(eventId, userId)` / `(eventId, guestEmail)` if `attendeeKey` is removed
- Invite tokens table for private events

Phase 1 uses `RSVP.attendeeKey` (`user:{id}` or `guest:{email}`) for a single `@@unique([eventId, attendeeKey])` under Prisma.

## Suggested phases

- **Phase 2**: Outbound email, RSVP confirmation, organiser notifications
- **Phase 3**: Ticketing / paid events (Stripe or similar), refunds
- **Phase 4**: Discovery, SEO landing for orgs, social previews

## Operations

- **Local DB**: `docker compose up -d`, `DATABASE_URL` in `.env`, then `npx prisma migrate dev`
- **Production**: managed PostgreSQL; set `AUTH_SECRET`, `AUTH_URL`, OAuth credentials; run `prisma migrate deploy`
- **RSVP abuse**: add rate limiting (per IP / per email) at the action or edge layer in a later phase
- **App container**: Phase 1 runs Next on the host; a `Dockerfile` for the app is optional later

## Google sign-in UI

Set `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, and `NEXT_PUBLIC_AUTH_GOOGLE_CONFIGURED=1` so the login page shows the Google button.
