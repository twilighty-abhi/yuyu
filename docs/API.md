# Machine API v1

[Documentation index](README.md)

Yuyu exposes a tenant-bound, machine-to-machine REST API under `/api/v1`. It is an application contract, not a generic Prisma API.

## Authentication

Organisation owners manage API clients at `/dashboard/:orgSlug/settings/api`. Each client belongs to one organisation and has explicit scopes. Credentials are returned once and only their SHA-256 digest is stored.

Send the credential in the standard bearer header:

```http
Authorization: Bearer <credential-shown-at-creation>
```

Store credentials in the consuming service's secret manager. Never put them in URLs, source control, analytics, monitoring tags, or logs. Rotation is zero-downtime: create a replacement credential, deploy it to the consumer, verify it, then revoke the old credential. Credentials can optionally expire, and disabling a client immediately rejects all of its credentials.

Invalid, expired, revoked, and disabled credentials all receive the same generic `401` response.

## Scopes

| Scope | Capability |
| --- | --- |
| `events:read` | Read standalone event metadata belonging to the client's organisation |
| `participants:read` | Read the minimal confirmed-participant roster for an event belonging to the client's organisation; can filter it by attendance without returning attendance data |
| `participants:attendance:read` | With `participants:read`, opt in to the `checkedInAt` timestamp with `include=attendance` |

`participants:attendance:read` does not grant roster access by itself. Participant access does not include email, user IDs, registration answers, invitation data, feedback linkage, or ticket/check-in/certificate tokens.

## Endpoints

### List events

```http
GET /api/v1/events?limit=50&cursor=<cursor>
```

Requires `events:read`. The response contains explicit event fields and includes draft, published, and hidden standalone events owned by the authenticated organisation.

### Read an event

```http
GET /api/v1/events/:eventId
```

Requires `events:read`. Missing and cross-organisation IDs both return the same generic `404` response.

### List confirmed participants

```http
GET /api/v1/events/:eventId/participants?limit=50&cursor=<cursor>&attendance=checked_in&include=attendance
```

Requires `participants:read`. Only confirmed standalone-event RSVPs are returned. `attendance` accepts `all` (the default), `checked_in`, or `not_checked_in`; it does not require an extra scope because it only filters the existing minimal roster. `include=attendance` returns the nullable `checkedInAt` timestamp and additionally requires `participants:attendance:read`.

```json
{
  "data": [
    {
      "id": "example-rsvp-id",
      "displayName": "Participant name",
      "registeredAt": "2030-01-01T10:00:00.000Z",
      "checkedInAt": "2030-01-01T10:15:00.000Z"
    }
  ],
  "pagination": {
    "nextCursor": null
  }
}
```

## Pagination

Collections use opaque keyset cursors. `limit` defaults to 50 and cannot exceed 100. Send the returned `nextCursor` unchanged to fetch the next page. A null cursor means the collection is complete.

## Errors

Errors have one shape:

```json
{
  "error": {
    "code": "RESOURCE_NOT_FOUND",
    "message": "The requested resource was not found."
  }
}
```

Defined codes are `INVALID_REQUEST`, `INVALID_CREDENTIAL`, `INSUFFICIENT_SCOPE`, `RESOURCE_NOT_FOUND`, `RATE_LIMITED`, and `INTERNAL_ERROR`. Rate-limited responses include `Retry-After`. API responses use `Cache-Control: no-store`.

## Tenant and security rules

- The organisation always comes from the authenticated API client. Caller-supplied organisation identifiers are not accepted.
- Resource queries include the authenticated organisation in the database predicate.
- API routes use explicit selects and validated DTOs; Prisma records are never serialized directly.
- The existing proxy/IP ceiling and a per-client distributed API limit both apply. Production remains fail-closed when Redis is unavailable.
- Normal reads update a throttled last-used timestamp but do not create an audit event per request.
- Client creation, scope changes, credential creation/revocation, and client status changes are audited without secrets or PII.
- Operational health and outbox endpoints retain their separate bearer-secret mechanisms.

Recurring series/instances, RSVP workflow data, participant contact information, registration answers, feedback reads, and machine writes are not part of v1's current contract.
