import { Prisma } from "@prisma/client";

/*
 * Prisma stores every `DateTime` as `timestamp(3)` (without time zone) holding
 * UTC wall-clock time. A JS `Date` passed as a raw-SQL parameter is sent as
 * `timestamptz`, so PostgreSQL converts it with the session `TimeZone` before
 * writing or comparing it. On a server whose TimeZone is not UTC that shifts
 * the value by the offset (an IST cluster stored a reminder 5.5 hours in the
 * future). Raw SQL therefore uses these helpers for every timestamp.
 */

/** A `Date` as a UTC wall-clock `timestamp(3)` literal; `null` stays NULL. */
export function sqlUtcTimestamp(at: Date | null): Prisma.Sql {
  if (at === null) return Prisma.sql`NULL::timestamp(3)`;
  return Prisma.sql`${at.toISOString().replace("Z", "")}::timestamp(3)`;
}

/** The database's current time as a UTC wall-clock `timestamp(3)`, whatever the session TimeZone. */
export const SQL_UTC_NOW = Prisma.sql`(now() AT TIME ZONE 'UTC')::timestamp(3)`;
