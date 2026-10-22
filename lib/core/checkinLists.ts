import "server-only";

import { revalidatePath } from "next/cache";
import { EventPermission, Prisma, type RsvpStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { canAccessEvent, canViewEventDashboard } from "@/lib/eventAccess";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import type { Bucket } from "@/lib/rateLimit";
import { recordAuditEvent } from "@/lib/audit";
import { parseCheckInPayload } from "@/lib/checkIn";
import {
  MAX_CHECK_IN_LISTS,
  alreadyInListMessage,
  createCheckInListSchema,
  listCheckInSchema,
  listLookupSchema,
  reorderCheckInListsSchema,
  undoListCheckInSchema,
  updateCheckInListSchema,
  type CheckInListSource,
} from "@/lib/checkInLists";
import { commitListCheckIn, commitUndoListCheckIn } from "@/lib/checkInListMutations";
import type { ActionResult } from "@/app/actions/org";
import { flattenZodErrors } from "@/app/actions/utils";

/*
 * Custom check-in lists: the mutation core shared by the Server Actions in
 * app/actions/checkin-lists.ts and, later, the mobile API. Everything is
 * scoped to one standalone event of the organisation named by the caller.
 *
 * - Managing lists (create, rename, reorder, archive, restore, the
 *   requires-entry switch) needs organisation OWNER/ADMIN or the event's
 *   `EDIT_DETAILS` grant.
 * - Checking people into or out of a list needs OWNER/ADMIN or `CHECK_IN`,
 *   exactly like entry check-in, and uses the same `checkin` rate limit.
 *
 * An event outside the organisation, or one the caller cannot open at all,
 * answers "Event not found." (mapped to NOT_FOUND by the mobile layer).
 */

export type CheckInListOptions = { source?: CheckInListSource };

export type CheckInListSummary = {
  id: string;
  name: string;
  sortOrder: number;
  archived: boolean;
  requiresEntryCheckIn: boolean;
};

export type ListCheckInResultData = {
  listId: string;
  listName: string;
  rsvpId: string;
  displayName: string;
  email: string | null;
  status: RsvpStatus;
  alreadyCheckedIn: boolean;
  /** When this guest was checked into the list. */
  checkedInAt: string;
  /** Entry check-in time, unchanged by list check-ins. */
  entryCheckedInAt: string | null;
  /** "Checked in to Swag" or "Already checked in to Swag at 10:42". */
  message: string;
};

export type ListLookupRow = {
  rsvpId: string;
  displayName: string;
  email: string | null;
  status: RsvpStatus;
  entryCheckedInAt: string | null;
  listCheckedInAt: string | null;
};

type Need = "manage" | "checkIn";

const fail = (error: string, extra: { needsForce?: boolean; fieldErrors?: Record<string, string[]> } = {}) => ({ ok: false as const, error, ...extra });

function attendeeLabel(r: { user: { name: string | null; email: string | null } | null; guestName: string | null; guestEmail: string | null }) {
  return r.user?.name?.trim() || r.guestName?.trim() || r.user?.email || r.guestEmail || "Guest";
}

async function resolveEvent(actorUserId: string | null, organisationSlug: string, eventId: string, need: Need, bucket: Bucket) {
  if (!actorUserId) return fail("You must be signed in.");
  if (await isActionRateLimited(bucket, actorUserId)) {
    return fail(need === "checkIn" ? "Too many check-in requests. Please try again shortly." : "Too many changes. Please try again shortly.");
  }
  const org = await prisma.organisation.findUnique({ where: { slug: organisationSlug }, select: { id: true, slug: true } });
  if (!org) return fail("Event not found.");
  const event = await prisma.event.findFirst({ where: { id: eventId, organisationId: org.id }, select: { id: true, organisationId: true, timezone: true } });
  if (!event) return fail("Event not found.");
  const permission = need === "manage" ? EventPermission.EDIT_DETAILS : EventPermission.CHECK_IN;
  if (!(await canAccessEvent({ userId: actorUserId, organisationId: org.id, eventId: event.id, permission }))) {
    if (!(await canViewEventDashboard({ userId: actorUserId, organisationId: org.id, eventId: event.id }))) return fail("Event not found.");
    return fail(need === "manage" ? "You do not have permission to manage check-in lists." : "You do not have permission to operate check-in.");
  }
  return { ok: true as const, org, event, actorUserId };
}

function revalidateLists(orgSlug: string, eventId: string) {
  revalidatePath(`/dashboard/${orgSlug}/event/${eventId}`);
  revalidatePath(`/dashboard/${orgSlug}/event/${eventId}/check-in`);
}

function isUniqueViolation(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

const toSummary = (list: CheckInListSummary): CheckInListSummary => ({
  id: list.id,
  name: list.name,
  sortOrder: list.sortOrder,
  archived: list.archived,
  requiresEntryCheckIn: list.requiresEntryCheckIn,
});

const summarySelect = { id: true, name: true, sortOrder: true, archived: true, requiresEntryCheckIn: true } as const;

export async function createCheckInListForUser(actorUserId: string | null, input: unknown): Promise<ActionResult<CheckInListSummary>> {
  const parsed = createCheckInListSchema.safeParse(input);
  if (!parsed.success) return fail("Check the list name.", { fieldErrors: flattenZodErrors(parsed.error) });
  const { organisationSlug, eventId, name, requiresEntryCheckIn } = parsed.data;
  const ctx = await resolveEvent(actorUserId, organisationSlug, eventId, "manage", "create");
  if (!ctx.ok) return ctx;

  try {
    const created = await prisma.$transaction(async (tx) => {
      // Serialise list creation per event so the cap and the next position hold.
      await tx.$queryRaw`SELECT "id" FROM "Event" WHERE "id" = ${ctx.event.id} FOR UPDATE`;
      const aggregate = await tx.checkInList.aggregate({ where: { eventId: ctx.event.id }, _count: { _all: true }, _max: { sortOrder: true } });
      if (aggregate._count._all >= MAX_CHECK_IN_LISTS) return null;
      const list = await tx.checkInList.create({
        data: { eventId: ctx.event.id, name, requiresEntryCheckIn: Boolean(requiresEntryCheckIn), sortOrder: (aggregate._max.sortOrder ?? -1) + 1 },
        select: summarySelect,
      });
      await recordAuditEvent({
        action: "CHECK_IN_LIST_CREATED",
        actorUserId: ctx.actorUserId,
        organisationId: ctx.org.id,
        targetType: "CheckInList",
        targetId: list.id,
        metadata: { eventId: ctx.event.id, requiresEntryCheckIn: list.requiresEntryCheckIn },
        client: tx,
      });
      return list;
    });
    if (!created) return fail(`An event can have up to ${MAX_CHECK_IN_LISTS} check-in lists.`);
    revalidateLists(ctx.org.slug, ctx.event.id);
    return { ok: true, data: toSummary(created) };
  } catch (error) {
    if (isUniqueViolation(error)) return fail(`There is already a list called “${name}”.`, { fieldErrors: { name: ["Choose a different name."] } });
    throw error;
  }
}

export async function updateCheckInListForUser(actorUserId: string | null, input: unknown): Promise<ActionResult<CheckInListSummary>> {
  const parsed = updateCheckInListSchema.safeParse(input);
  if (!parsed.success) return fail("Check the list details.", { fieldErrors: flattenZodErrors(parsed.error) });
  const { organisationSlug, eventId, listId, name, requiresEntryCheckIn, archived } = parsed.data;
  const ctx = await resolveEvent(actorUserId, organisationSlug, eventId, "manage", "action");
  if (!ctx.ok) return ctx;

  try {
    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "CheckInList" WHERE "id" = ${listId} FOR UPDATE`;
      const current = await tx.checkInList.findFirst({ where: { id: listId, eventId: ctx.event.id }, select: summarySelect });
      if (!current) return { kind: "error", error: "List not found." } as const;
      // An archived list is read-only: the only change it accepts is a restore.
      const staysArchived = current.archived && archived !== false;
      if (staysArchived && (name !== undefined || requiresEntryCheckIn !== undefined)) {
        return { kind: "error", error: "Restore this list before changing it." } as const;
      }
      const renamed = name !== undefined && name !== current.name;
      const archiveChanged = archived !== undefined && archived !== current.archived;
      const entryChanged = requiresEntryCheckIn !== undefined && requiresEntryCheckIn !== current.requiresEntryCheckIn;
      if (!renamed && !archiveChanged && !entryChanged) return { kind: "ok", list: current } as const;
      const list = await tx.checkInList.update({
        where: { id: current.id },
        data: {
          ...(renamed ? { name } : {}),
          ...(archiveChanged ? { archived } : {}),
          ...(entryChanged ? { requiresEntryCheckIn } : {}),
        },
        select: summarySelect,
      });
      const action = archiveChanged ? (list.archived ? "CHECK_IN_LIST_ARCHIVED" : "CHECK_IN_LIST_RESTORED") : renamed ? "CHECK_IN_LIST_RENAMED" : "CHECK_IN_LIST_UPDATED";
      await recordAuditEvent({
        action,
        actorUserId: ctx.actorUserId,
        organisationId: ctx.org.id,
        targetType: "CheckInList",
        targetId: list.id,
        metadata: { eventId: ctx.event.id, renamed, archived: list.archived, requiresEntryCheckIn: list.requiresEntryCheckIn },
        client: tx,
      });
      return { kind: "ok", list } as const;
    });
    if (result.kind === "error") return fail(result.error);
    revalidateLists(ctx.org.slug, ctx.event.id);
    return { ok: true, data: toSummary(result.list) };
  } catch (error) {
    if (isUniqueViolation(error)) {
      return fail(name ? `There is already a list called “${name}”.` : "Another open list already uses this name. Rename one of them first.", { fieldErrors: { name: ["Choose a different name."] } });
    }
    throw error;
  }
}

export async function reorderCheckInListsForUser(actorUserId: string | null, input: unknown): Promise<ActionResult> {
  const parsed = reorderCheckInListsSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid list order.", { fieldErrors: flattenZodErrors(parsed.error) });
  const { organisationSlug, eventId, listIds } = parsed.data;
  const ctx = await resolveEvent(actorUserId, organisationSlug, eventId, "manage", "action");
  if (!ctx.ok) return ctx;

  const ok = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Event" WHERE "id" = ${ctx.event.id} FOR UPDATE`;
    const owned = await tx.checkInList.count({ where: { eventId: ctx.event.id, id: { in: listIds } } });
    if (owned !== listIds.length) return false;
    for (const [index, id] of listIds.entries()) {
      await tx.checkInList.update({ where: { id }, data: { sortOrder: index } });
    }
    await recordAuditEvent({
      action: "CHECK_IN_LISTS_REORDERED",
      actorUserId: ctx.actorUserId,
      organisationId: ctx.org.id,
      targetType: "Event",
      targetId: ctx.event.id,
      metadata: { lists: listIds.length },
      client: tx,
    });
    return true;
  });
  if (!ok) return fail("List not found.");
  revalidateLists(ctx.org.slug, ctx.event.id);
  return { ok: true };
}

const rsvpInclude = { user: { select: { name: true, email: true } } } as const;

export async function checkInToListForUser(actorUserId: string | null, input: unknown, options: CheckInListOptions = {}): Promise<ActionResult<ListCheckInResultData>> {
  const parsed = listCheckInSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid input.", { fieldErrors: flattenZodErrors(parsed.error) });
  const { organisationSlug, eventId, listId, rawInput, rsvpId, force } = parsed.data;
  const ctx = await resolveEvent(actorUserId, organisationSlug, eventId, "checkIn", "checkin");
  if (!ctx.ok) return ctx;

  const list = await prisma.checkInList.findFirst({ where: { id: listId, eventId: ctx.event.id }, select: { id: true, name: true, archived: true } });
  if (!list) return fail("List not found.");
  if (list.archived) return fail("This list is archived and read-only.");

  let rsvp;
  if (rawInput) {
    // The same parser as entry: ticket URL, raw token, or typed code.
    const token = parseCheckInPayload(rawInput);
    if (!token) return fail("Could not read a ticket code from that input.");
    rsvp = await prisma.rSVP.findUnique({ where: { checkInToken: token }, include: rsvpInclude });
    if (!rsvp) return fail("No matching ticket found.");
    if (rsvp.eventId !== ctx.event.id) return fail("This ticket is not for this event.");
  } else {
    rsvp = await prisma.rSVP.findFirst({ where: { id: rsvpId, eventId: ctx.event.id }, include: rsvpInclude });
    if (!rsvp) return fail("RSVP not found.");
  }

  const committed = await commitListCheckIn({
    listId: list.id,
    rsvpId: rsvp.id,
    actorUserId: ctx.actorUserId,
    source: options.source ?? "online",
    checkedInAt: new Date(),
    force: Boolean(force),
  });
  if (committed.state === "missing") return fail("RSVP not found.");
  if (committed.state === "ineligible") {
    return committed.gate.needsForce ? fail(committed.gate.reason, { needsForce: true }) : fail(committed.gate.reason);
  }

  const already = committed.state === "already-checked-in";
  if (!already) revalidateLists(ctx.org.slug, ctx.event.id);
  return {
    ok: true,
    data: {
      listId: list.id,
      listName: list.name,
      rsvpId: rsvp.id,
      displayName: attendeeLabel(rsvp),
      email: rsvp.user?.email ?? rsvp.guestEmail,
      status: rsvp.status,
      alreadyCheckedIn: already,
      checkedInAt: committed.checkedInAt.toISOString(),
      entryCheckedInAt: rsvp.checkedInAt?.toISOString() ?? null,
      message: already ? alreadyInListMessage(list.name, committed.checkedInAt, ctx.event.timezone) : `Checked in to ${list.name}`,
    },
  };
}

export async function undoListCheckInForUser(actorUserId: string | null, input: unknown, options: CheckInListOptions = {}): Promise<ActionResult> {
  const parsed = undoListCheckInSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid input.", { fieldErrors: flattenZodErrors(parsed.error) });
  const { organisationSlug, eventId, listId, rsvpId } = parsed.data;
  const ctx = await resolveEvent(actorUserId, organisationSlug, eventId, "checkIn", "checkin");
  if (!ctx.ok) return ctx;

  const [list, rsvp] = await Promise.all([
    prisma.checkInList.findFirst({ where: { id: listId, eventId: ctx.event.id }, select: { id: true } }),
    prisma.rSVP.findFirst({ where: { id: rsvpId, eventId: ctx.event.id }, select: { id: true } }),
  ]);
  if (!list) return fail("List not found.");
  if (!rsvp) return fail("RSVP not found.");

  const result = await commitUndoListCheckIn({ listId: list.id, rsvpId: rsvp.id, actorUserId: ctx.actorUserId, source: options.source ?? "online" });
  if (result === "missing") return fail("List not found.");
  if (result === "archived") return fail("This list is archived and read-only.");
  if (result === "not-checked-in") return fail("This guest is not checked in to this list.");
  revalidateLists(ctx.org.slug, ctx.event.id);
  return { ok: true };
}

/** Search for the list desk: the entry lookup plus each guest's state in this list. */
export async function lookupListAttendeesForUser(actorUserId: string | null, input: unknown): Promise<ActionResult<{ rows: ListLookupRow[] }>> {
  const parsed = listLookupSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid input.", { fieldErrors: flattenZodErrors(parsed.error) });
  const { organisationSlug, eventId, listId, query } = parsed.data;
  const ctx = await resolveEvent(actorUserId, organisationSlug, eventId, "checkIn", "checkin");
  if (!ctx.ok) return ctx;

  const list = await prisma.checkInList.findFirst({ where: { id: listId, eventId: ctx.event.id }, select: { id: true } });
  if (!list) return fail("List not found.");

  const q = query.trim();
  const rsvps = await prisma.rSVP.findMany({
    where: {
      eventId: ctx.event.id,
      OR: [
        { guestEmail: { contains: q, mode: "insensitive" } },
        { guestName: { contains: q, mode: "insensitive" } },
        { user: { email: { contains: q, mode: "insensitive" } } },
        { user: { name: { contains: q, mode: "insensitive" } } },
      ],
    },
    take: 12,
    orderBy: { createdAt: "desc" },
    include: { ...rsvpInclude, checkInListRecords: { where: { listId: list.id }, select: { checkedInAt: true } } },
  });
  return {
    ok: true,
    data: {
      rows: rsvps.map((r) => ({
        rsvpId: r.id,
        displayName: attendeeLabel(r),
        email: r.user?.email ?? r.guestEmail,
        status: r.status,
        entryCheckedInAt: r.checkedInAt?.toISOString() ?? null,
        listCheckedInAt: r.checkInListRecords[0]?.checkedInAt.toISOString() ?? null,
      })),
    },
  };
}
