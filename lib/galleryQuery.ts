import { Prisma, SubmissionStatus } from "@prisma/client";
import type { GalleryFilter, GallerySort } from "@/lib/judgingPaging";

/*
 * SQL fragments for the public project gallery (docs/HACKATHON.md) and the
 * shared project search. Pure builders over `Prisma.sql` (every value is a
 * bound parameter), unit tested in tests/unit/gallery-query.test.ts. The
 * caller decides whether results are published before asking for the
 * `winners` filter or the `awards` order; these builders never check that.
 */

/** Escapes `\`, `%` and `_` so user text is matched literally inside ILIKE (same rule as `escapeLikePattern`). */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/**
 * Search on what the viewer is shown: the project title, the team name, or a
 * solo entrant's first name (the display name is "Ada L.", so the surname is
 * never matched and a search cannot reveal it). Wildcards match literally.
 * `s` is the `Submission` alias. Null for an empty query.
 */
export function projectSearchSql(query: string): Prisma.Sql | null {
  if (!query) return null;
  const pattern = `%${escapeLike(query)}%`;
  return Prisma.sql`(
    s."title" ILIKE ${pattern}
    OR EXISTS (SELECT 1 FROM "Team" t WHERE t."id" = s."teamId" AND t."name" ILIKE ${pattern})
    OR (s."teamId" IS NULL AND EXISTS (
      SELECT 1 FROM "RSVP" r LEFT JOIN "User" u ON u."id" = r."userId"
      WHERE r."id" = s."rsvpId"
        AND (regexp_split_to_array(btrim(COALESCE(NULLIF(btrim(u."name"), ''), r."guestName", '')), '[[:space:]]+'))[1] ILIKE ${pattern}
    ))
  )`;
}

/** The submission won at least one of its own event's awards. */
export function awardWinnerSql(): Prisma.Sql {
  return Prisma.sql`EXISTS (
    SELECT 1 FROM "EventAwardWinner" w JOIN "EventAward" a ON a."id" = w."awardId"
    WHERE w."submissionId" = s."id" AND a."eventId" = s."eventId"
  )`;
}

/** Every condition for one gallery listing: the event, SUBMITTED only, then the search and filter. */
export function galleryWhereSql(eventId: string, view: { query: string; filter: GalleryFilter }): Prisma.Sql {
  const conditions: Prisma.Sql[] = [
    Prisma.sql`s."eventId" = ${eventId}`,
    Prisma.sql`s."status" = ${SubmissionStatus.SUBMITTED}::"SubmissionStatus"`,
  ];
  const search = projectSearchSql(view.query);
  if (search) conditions.push(search);
  if (view.filter === "winners") conditions.push(awardWinnerSql());
  return Prisma.join(conditions, " AND ");
}

/**
 * `FROM` for a gallery listing. The `awards` order joins each project's best
 * award (lowest award position, then creation and id as on the results page,
 * then place) as `best`.
 */
export function galleryFromSql(sort: GallerySort): Prisma.Sql {
  if (sort !== "awards") return Prisma.sql`"Submission" s`;
  return Prisma.sql`"Submission" s
    LEFT JOIN LATERAL (
      SELECT a."position" AS "awardPosition", a."createdAt" AS "awardCreatedAt", a."id" AS "awardId", w."place" AS "place"
      FROM "EventAwardWinner" w JOIN "EventAward" a ON a."id" = w."awardId"
      WHERE w."submissionId" = s."id" AND a."eventId" = s."eventId"
      ORDER BY a."position" ASC, a."createdAt" ASC, a."id" ASC, w."place" ASC
      LIMIT 1
    ) best ON TRUE`;
}

/** `ORDER BY` for a gallery listing; every order ends in the unique `id`. */
export function galleryOrderSql(sort: GallerySort): Prisma.Sql {
  const alphabetical = Prisma.sql`lower(s."title") ASC, s."title" ASC, s."id" ASC`;
  switch (sort) {
    case "az":
      return alphabetical;
    case "awards":
      return Prisma.sql`(best."awardId" IS NULL) ASC, best."awardPosition" ASC, best."awardCreatedAt" ASC, best."awardId" ASC, best."place" ASC, ${alphabetical}`;
    case "newest":
    default:
      return Prisma.sql`s."submittedAt" DESC, s."id" DESC`;
  }
}
