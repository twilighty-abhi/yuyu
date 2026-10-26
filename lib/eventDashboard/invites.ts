import "server-only";

import { cache } from "react";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { containsText } from "@/lib/attendeeListQuery";

/*
 * Guests · Invites, one numbered page at a time. Callers must have checked
 * MANAGE_INVITATIONS for the event (organisation OWNER/ADMIN or the exact
 * grant, as `addEventInvite` does); the organisation is re-checked here.
 */

export const INVITES_PAGE_SIZE = 50;

export const invitesPageViewSchema = z
  .object({
    query: z.string().trim().max(200).optional().default(""),
    page: z.number().int().min(1).max(100_000).optional().default(1),
  })
  .strict();

export type EventInviteRow = { id: string; email: string; createdAt: string };

export type EventInvitesPage = {
  invites: EventInviteRow[];
  /** The page actually shown (a page past the end shows the last one). */
  page: number;
  pageCount: number;
  /** Invites matching the search. */
  matching: number;
  /** Every invite for the event (the sub-tab badge). */
  total: number;
  pageSize: number;
};

/** Clamp a requested 1-based page to the pages that exist (at least 1). */
export function clampPage(requested: number, matching: number, pageSize: number): { page: number; pageCount: number } {
  const pageCount = Math.max(1, Math.ceil(matching / pageSize));
  return { page: Math.min(Math.max(1, Math.floor(requested) || 1), pageCount), pageCount };
}

export async function listEventInvitesPage(scope: { eventId: string; organisationId: string }, input: unknown): Promise<EventInvitesPage> {
  const parsed = invitesPageViewSchema.safeParse(input ?? {});
  const view = parsed.success ? parsed.data : { query: "", page: 1 };
  const eventWhere = { eventId: scope.eventId, event: { organisationId: scope.organisationId } };
  const where = view.query ? { ...eventWhere, email: containsText(view.query) } : eventWhere;
  const [total, matching] = await Promise.all([
    prisma.eventInvite.count({ where: eventWhere }),
    view.query ? prisma.eventInvite.count({ where }) : null,
  ]);
  const matched = matching ?? total;
  const { page, pageCount } = clampPage(view.page, matched, INVITES_PAGE_SIZE);
  const invites = matched === 0
    ? []
    : await prisma.eventInvite.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * INVITES_PAGE_SIZE,
        take: INVITES_PAGE_SIZE,
        select: { id: true, email: true, createdAt: true },
      });
  return {
    invites: invites.map((invite) => ({ ...invite, createdAt: invite.createdAt.toISOString() })),
    page,
    pageCount,
    matching: matched,
    total,
    pageSize: INVITES_PAGE_SIZE,
  };
}

/** The first page for the event dashboard (invitation managers only). */
export const loadEventInvitesFirstPage = cache(async (eventId: string, organisationId: string) => listEventInvitesPage({ eventId, organisationId }, {}));
