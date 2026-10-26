import "server-only";

import { Prisma, RsvpStatus, SubmissionStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { escapeLikePattern } from "@/lib/core/teams";
import { entrantDisplayName } from "@/lib/judgingDto";
import type { JudgingOrganiserContext } from "@/lib/judgingAccess";
import { ORGANISER_SUBMISSIONS_PAGE_SIZE, unsubmittedEntrantsQuerySchema } from "@/lib/judgingOrganiserPaging";
import { decodeTimeCursor, encodeTimeCursor } from "@/lib/keysetCursor";

/*
 * Judging → Submissions → "Not submitted" (docs/HACKATHON.md): the entrants
 * who could submit a project but have not. An entrant is a CONFIRMED team,
 * or a CONFIRMED registration without a team (a solo entrant, the same rule
 * as `resolveEntrantForUser`). "Not submitted" means its project is anything
 * but SUBMITTED: none yet, a draft, withdrawn, or disqualified.
 *
 * Organisers only (callers pass `resolveJudgingOrganiser`); the event is
 * re-read inside the organisation. Rows carry display names, sizes and the
 * project's status and title, never emails, tokens or answers.
 */

export type UnsubmittedEntrantDto = {
  kind: "team" | "solo";
  /** The team id, or the solo registration's id. */
  id: string;
  name: string;
  /** Team members (1 for a solo entrant). */
  size: number;
  /** The project's status, or null when there is no project yet. */
  submissionStatus: SubmissionStatus | null;
  submissionTitle: string | null;
  registeredAt: Date;
};

export type UnsubmittedEntrantsPage = { entrants: UnsubmittedEntrantDto[]; nextCursor: string | null };

type EntrantRow = {
  kind: "team" | "solo";
  id: string;
  teamName: string | null;
  userName: string | null;
  guestName: string | null;
  size: bigint | number;
  submissionStatus: SubmissionStatus | null;
  submissionTitle: string | null;
  registeredAt: Date;
};

async function organiserEventId(ctx: JudgingOrganiserContext): Promise<string | null> {
  const event = await prisma.event.findFirst({ where: { id: ctx.eventId, organisationId: ctx.organisationId }, select: { id: true } });
  return event?.id ?? null;
}

/** Both kinds of entrant without a SUBMITTED project, as one SQL relation (`e`). */
function unsubmittedEntrantsSql(eventId: string): Prisma.Sql {
  return Prisma.sql`(
    SELECT 'team' AS "kind", t."id", t."name" AS "teamName", NULL::text AS "userName", NULL::text AS "guestName",
      (SELECT count(*) FROM "RSVP" m WHERE m."teamId" = t."id") AS "size",
      s."status" AS "submissionStatus", s."title" AS "submissionTitle", t."createdAt" AS "registeredAt"
    FROM "Team" t
    LEFT JOIN "Submission" s ON s."teamId" = t."id"
    WHERE t."eventId" = ${eventId} AND t."status" = ${RsvpStatus.CONFIRMED}::"RsvpStatus"
      AND (s."id" IS NULL OR s."status" <> ${SubmissionStatus.SUBMITTED}::"SubmissionStatus")
    UNION ALL
    SELECT 'solo' AS "kind", r."id", NULL::text AS "teamName", u."name" AS "userName", r."guestName",
      1 AS "size",
      s."status" AS "submissionStatus", s."title" AS "submissionTitle", r."createdAt" AS "registeredAt"
    FROM "RSVP" r
    LEFT JOIN "User" u ON u."id" = r."userId"
    LEFT JOIN "Submission" s ON s."rsvpId" = r."id"
    WHERE r."eventId" = ${eventId} AND r."teamId" IS NULL AND r."status" = ${RsvpStatus.CONFIRMED}::"RsvpStatus"
      AND (s."id" IS NULL OR s."status" <> ${SubmissionStatus.SUBMITTED}::"SubmissionStatus")
  ) e`;
}

/** The search over an entrant's team or registrant name and its project title. */
function searchSql(query: string): Prisma.Sql {
  if (!query) return Prisma.sql`TRUE`;
  const pattern = `%${escapeLikePattern(query)}%`;
  return Prisma.sql`(
    COALESCE(e."teamName", NULLIF(btrim(e."userName"), ''), NULLIF(btrim(e."guestName"), ''), '') ILIKE ${pattern}
    OR COALESCE(e."submissionTitle", '') ILIKE ${pattern}
  )`;
}

/** How many entrants have not submitted (the "Not submitted" chip), optionally under a search. */
export async function countUnsubmittedEntrants(ctx: JudgingOrganiserContext, query = ""): Promise<number> {
  const eventId = await organiserEventId(ctx);
  if (!eventId) return 0;
  const text = query.trim().slice(0, 100);
  const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) AS "count" FROM ${unsubmittedEntrantsSql(eventId)} WHERE ${searchSql(text)}`;
  return Number(rows[0]?.count ?? 0);
}

/**
 * One "Load more" page of entrants without a SUBMITTED project, oldest
 * registration first (keyset on registration time and id). The search matches
 * the team name, the registrant's name, or the draft's title.
 */
export async function listUnsubmittedEntrants(ctx: JudgingOrganiserContext, input: unknown = {}): Promise<UnsubmittedEntrantsPage> {
  const empty: UnsubmittedEntrantsPage = { entrants: [], nextCursor: null };
  const parsed = unsubmittedEntrantsQuerySchema.safeParse(input ?? {});
  if (!parsed.success) return empty;
  const { query, cursor } = parsed.data;
  const eventId = await organiserEventId(ctx);
  if (!eventId) return empty;

  const conditions: Prisma.Sql[] = [searchSql(query)];
  if (cursor) {
    const after = decodeTimeCursor(cursor);
    if (!after) return empty;
    // `createdAt` columns are UTC wall-clock timestamp(3).
    const at = after.at.toISOString().replace("Z", "");
    conditions.push(Prisma.sql`(e."registeredAt", e."id") > (${at}::timestamp(3), ${after.id})`);
  }
  const rows = await prisma.$queryRaw<EntrantRow[]>`
    SELECT e.* FROM ${unsubmittedEntrantsSql(eventId)}
    WHERE ${Prisma.join(conditions, " AND ")}
    ORDER BY e."registeredAt" ASC, e."id" ASC
    LIMIT ${ORGANISER_SUBMISSIONS_PAGE_SIZE + 1}`;
  const page = rows.slice(0, ORGANISER_SUBMISSIONS_PAGE_SIZE);
  const last = page[page.length - 1];
  return {
    entrants: page.map((row) => ({
      kind: row.kind,
      id: row.id,
      name: entrantDisplayName({
        team: row.kind === "team" ? { name: row.teamName ?? "" } : null,
        rsvp: row.kind === "solo" ? { guestName: row.guestName, user: { name: row.userName } } : null,
      }),
      size: Number(row.size),
      submissionStatus: row.submissionStatus,
      submissionTitle: row.submissionTitle,
      registeredAt: row.registeredAt,
    })),
    nextCursor: rows.length > ORGANISER_SUBMISSIONS_PAGE_SIZE && last ? encodeTimeCursor({ at: last.registeredAt, id: last.id }) : null,
  };
}
