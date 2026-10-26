import "server-only";

import { Prisma, type SavedViewSurface } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit";
import { canManageRegistrationsFor } from "@/lib/eventAccess";
import { getMembership, isOrgAdmin } from "@/lib/permissions";
import type { EventDashboardPermissions } from "@/lib/eventDashboard/context";
import {
  SAVED_VIEW_SURFACES,
  SAVED_VIEWS_LIST_LIMIT,
  SAVED_VIEWS_PER_USER_LIMIT,
  sanitizeViewParams,
  savedViewNameSchema,
  type SavedViewDto,
  type SavedViewSurfaceKey,
} from "@/lib/savedViews";

/*
 * Saved views on the event dashboard's paged lists (docs/FEATURES.md,
 * "Saved views"). Access is the surface's own permission, checked before
 * anything is read or written:
 *
 * - Guests → People: `canManageRegistrationsFor` (owner/admin or the
 *   event's MANAGE_REGISTRATIONS grant), as `loadAttendeesPage`.
 * - Guests → Teams: the same, on a TEAM event, as `loadTeamsPage`.
 * - Judging → Submissions, Results, Progress: organisation owner/admin, as
 *   `resolveJudgingOrganiser`.
 *
 * Every query is scoped by event, organisation and surface. A view's params
 * are re-sanitised against the surface allow-list on write and on read, and
 * only ever choose filters inside the list; they never grant access.
 * Only the creator renames or re-shares a view; the creator, or an
 * organisation owner/admin for a shared view, deletes it. Create, delete and
 * share changes are audited with the surface only (never the name or params).
 */

export type SavedViewContext = {
  userId: string;
  organisationId: string;
  orgSlug: string;
  eventId: string;
  surface: SavedViewSurfaceKey;
  /** Organisation OWNER/ADMIN: may delete other people's shared views. */
  isAdmin: boolean;
};

export type SavedViewResult<T> = { ok: true; data: T } | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

const NOT_FOUND = "That view no longer exists.";

/** Which surfaces the dashboard viewer can open (mirrors the checks in `resolveSavedViewAccess`). */
export function savedViewSurfacesFor(permissions: Pick<EventDashboardPermissions, "canManageRegistrations" | "canManageJudging">, teamMode: boolean): SavedViewSurfaceKey[] {
  const surfaces: SavedViewSurfaceKey[] = [];
  if (permissions.canManageRegistrations) surfaces.push("GUESTS_PEOPLE");
  if (permissions.canManageRegistrations && teamMode) surfaces.push("GUESTS_TEAMS");
  if (permissions.canManageJudging) surfaces.push("JUDGING_SUBMISSIONS", "JUDGING_RESULTS", "JUDGING_PROGRESS");
  return surfaces;
}

/** The surface's permission for this user on this event of this organisation, or null. */
export async function resolveSavedViewAccess(userId: string, organisationSlug: string, eventId: string, surface: SavedViewSurfaceKey): Promise<SavedViewContext | null> {
  if (!userId || !SAVED_VIEW_SURFACES.includes(surface)) return null;
  const org = await prisma.organisation.findUnique({ where: { slug: organisationSlug }, select: { id: true, slug: true } });
  if (!org) return null;
  const event = await prisma.event.findFirst({ where: { id: eventId, organisationId: org.id }, select: { id: true, registrationMode: true } });
  if (!event) return null;
  const membership = await getMembership(userId, org.id);
  const isAdmin = Boolean(membership && isOrgAdmin(membership.role));
  let allowed: boolean;
  switch (surface) {
    case "GUESTS_PEOPLE":
      allowed = await canManageRegistrationsFor({ userId, organisationId: org.id, eventId: event.id });
      break;
    case "GUESTS_TEAMS":
      allowed = event.registrationMode === "TEAM" && (await canManageRegistrationsFor({ userId, organisationId: org.id, eventId: event.id }));
      break;
    default:
      allowed = isAdmin;
  }
  return allowed ? { userId, organisationId: org.id, orgSlug: org.slug, eventId: event.id, surface, isAdmin } : null;
}

const viewSelect = {
  id: true,
  name: true,
  params: true,
  shared: true,
  userId: true,
  surface: true,
  createdAt: true,
  user: { select: { name: true } },
} satisfies Prisma.SavedViewSelect;

type ViewRow = Prisma.SavedViewGetPayload<{ select: typeof viewSelect }>;

function toDto(row: ViewRow, viewer: { userId: string; isAdmin: boolean }): SavedViewDto {
  const mine = row.userId === viewer.userId;
  return {
    id: row.id,
    name: row.name,
    // Re-validated on read: a row written before an allow-list change only keeps what is still allowed.
    params: sanitizeViewParams(row.surface as SavedViewSurfaceKey, row.params),
    shared: row.shared,
    mine,
    canDelete: mine || (row.shared && viewer.isAdmin),
    createdBy: row.user.name?.trim() || "A teammate",
  };
}

const viewOrder: Prisma.SavedViewOrderByWithRelationInput[] = [{ createdAt: "asc" }, { id: "asc" }];

/**
 * One surface's menu rows: the viewer's own views first, then views others
 * shared, each oldest first. Own views are read on their own so that however
 * many views others share, the viewer's views (capped at
 * `SAVED_VIEWS_PER_USER_LIMIT` on create) always appear and stay manageable;
 * shared views fill the rest of `SAVED_VIEWS_LIST_LIMIT`.
 */
async function surfaceRows(ctx: { userId: string; organisationId: string; eventId: string }, surface: SavedViewSurfaceKey): Promise<ViewRow[]> {
  const scoped = { eventId: ctx.eventId, organisationId: ctx.organisationId, surface: surface as SavedViewSurface };
  const own = await prisma.savedView.findMany({ where: { ...scoped, userId: ctx.userId }, select: viewSelect, orderBy: viewOrder, take: SAVED_VIEWS_LIST_LIMIT });
  const room = SAVED_VIEWS_LIST_LIMIT - own.length;
  if (room <= 0) return own;
  const shared = await prisma.savedView.findMany({ where: { ...scoped, shared: true, userId: { not: ctx.userId } }, select: viewSelect, orderBy: viewOrder, take: room });
  return [...own, ...shared];
}

/** The views one surface's menu lists: the viewer's own and every shared one. */
export async function listSavedViews(ctx: SavedViewContext): Promise<SavedViewDto[]> {
  return (await surfaceRows(ctx, ctx.surface)).map((row) => toDto(row, ctx));
}

/**
 * Every surface's views for the dashboard render, each surface read on its
 * own so a busy list never crowds another out. `surfaces` must come from
 * `savedViewSurfacesFor` on the already-resolved dashboard permissions.
 */
export async function loadDashboardSavedViews(ctx: { userId: string; organisationId: string; eventId: string; isAdmin: boolean }, surfaces: SavedViewSurfaceKey[]): Promise<Partial<Record<SavedViewSurfaceKey, SavedViewDto[]>>> {
  const unique = [...new Set(surfaces)].filter((surface) => SAVED_VIEW_SURFACES.includes(surface));
  const lists = await Promise.all(unique.map(async (surface) => [surface, (await surfaceRows(ctx, surface)).map((row) => toDto(row, ctx))] as const));
  return Object.fromEntries(lists) as Partial<Record<SavedViewSurfaceKey, SavedViewDto[]>>;
}

const createInputSchema = z
  .object({
    name: savedViewNameSchema,
    params: z.unknown(),
    shared: z.boolean().optional().default(false),
  })
  .strip();

function fieldErrors(error: z.ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    (out[key] ??= []).push(issue.message);
  }
  return out;
}

/** Save the current filters as a named view (params sanitised to the surface allow-list). */
export async function createSavedView(ctx: SavedViewContext, input: unknown): Promise<SavedViewResult<SavedViewDto>> {
  const parsed = createInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };
  const params = sanitizeViewParams(ctx.surface, parsed.data.params);
  const owned = await prisma.savedView.count({ where: { eventId: ctx.eventId, organisationId: ctx.organisationId, surface: ctx.surface, userId: ctx.userId } });
  if (owned >= SAVED_VIEWS_PER_USER_LIMIT) return { ok: false, error: `You can keep up to ${SAVED_VIEWS_PER_USER_LIMIT} views here. Delete one first.` };
  const row = await prisma.savedView.create({
    data: {
      organisationId: ctx.organisationId,
      eventId: ctx.eventId,
      userId: ctx.userId,
      surface: ctx.surface,
      name: parsed.data.name,
      params: params as Prisma.InputJsonObject,
      shared: parsed.data.shared,
    },
    select: viewSelect,
  });
  await recordAuditEvent({
    action: "SAVED_VIEW_CREATED",
    actorUserId: ctx.userId,
    organisationId: ctx.organisationId,
    targetType: "SavedView",
    targetId: row.id,
    metadata: { eventId: ctx.eventId, surface: ctx.surface, shared: row.shared },
  });
  return { ok: true, data: toDto(row, ctx) };
}

/** The viewer's own view on this surface of this event, or null. */
function ownWhere(ctx: SavedViewContext, viewId: string): Prisma.SavedViewWhereInput {
  return { id: viewId, eventId: ctx.eventId, organisationId: ctx.organisationId, surface: ctx.surface, userId: ctx.userId };
}

const viewIdSchema = z.string().trim().min(1).max(128);

/** Rename one of the viewer's own views. */
export async function renameSavedView(ctx: SavedViewContext, viewId: unknown, name: unknown): Promise<SavedViewResult<SavedViewDto>> {
  const id = viewIdSchema.safeParse(viewId);
  if (!id.success) return { ok: false, error: NOT_FOUND };
  const parsedName = savedViewNameSchema.safeParse(name);
  if (!parsedName.success) return { ok: false, error: "Check the highlighted fields.", fieldErrors: { name: parsedName.error.issues.map((issue) => issue.message) } };
  const updated = await prisma.savedView.updateMany({ where: ownWhere(ctx, id.data), data: { name: parsedName.data } });
  if (updated.count === 0) return { ok: false, error: NOT_FOUND };
  const row = await prisma.savedView.findFirst({ where: ownWhere(ctx, id.data), select: viewSelect });
  return row ? { ok: true, data: toDto(row, ctx) } : { ok: false, error: NOT_FOUND };
}

/** Share one of the viewer's own views with everyone who can open this list, or stop sharing it. */
export async function setSavedViewShared(ctx: SavedViewContext, viewId: unknown, shared: unknown): Promise<SavedViewResult<SavedViewDto>> {
  const id = viewIdSchema.safeParse(viewId);
  if (!id.success || typeof shared !== "boolean") return { ok: false, error: NOT_FOUND };
  const updated = await prisma.savedView.updateMany({ where: { ...ownWhere(ctx, id.data), shared: !shared }, data: { shared } });
  const row = await prisma.savedView.findFirst({ where: ownWhere(ctx, id.data), select: viewSelect });
  if (!row) return { ok: false, error: NOT_FOUND };
  if (updated.count > 0) {
    await recordAuditEvent({
      action: shared ? "SAVED_VIEW_SHARED" : "SAVED_VIEW_UNSHARED",
      actorUserId: ctx.userId,
      organisationId: ctx.organisationId,
      targetType: "SavedView",
      targetId: row.id,
      metadata: { eventId: ctx.eventId, surface: ctx.surface },
    });
  }
  return { ok: true, data: toDto(row, ctx) };
}

/** Delete a view: the viewer's own, or (owners/admins) a shared one. */
export async function deleteSavedView(ctx: SavedViewContext, viewId: unknown): Promise<SavedViewResult<{ id: string }>> {
  const id = viewIdSchema.safeParse(viewId);
  if (!id.success) return { ok: false, error: NOT_FOUND };
  const scoped: Prisma.SavedViewWhereInput = { id: id.data, eventId: ctx.eventId, organisationId: ctx.organisationId, surface: ctx.surface };
  const row = await prisma.savedView.findFirst({ where: scoped, select: { id: true, userId: true, shared: true } });
  if (!row) return { ok: false, error: NOT_FOUND };
  const mine = row.userId === ctx.userId;
  // Someone else's private view is invisible to the viewer, so it reads as missing.
  if (!mine && !row.shared) return { ok: false, error: NOT_FOUND };
  if (!mine && !ctx.isAdmin) return { ok: false, error: "Only the person who saved this view, or an owner or admin, can delete it." };
  // Re-check the same rule in the delete itself, so a view un-shared meanwhile is not removed by an admin.
  const removed = await prisma.savedView.deleteMany({ where: { ...scoped, OR: [{ userId: ctx.userId }, ...(ctx.isAdmin ? [{ shared: true }] : [])] } });
  if (removed.count === 0) return { ok: false, error: NOT_FOUND };
  await recordAuditEvent({
    action: "SAVED_VIEW_DELETED",
    actorUserId: ctx.userId,
    organisationId: ctx.organisationId,
    targetType: "SavedView",
    targetId: row.id,
    metadata: { eventId: ctx.eventId, surface: ctx.surface, shared: row.shared, ownView: mine },
  });
  return { ok: true, data: { id: row.id } };
}
