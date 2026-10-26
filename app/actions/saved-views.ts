"use server";

import { z } from "zod";
import { auth } from "@/lib/auth";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import {
  createSavedView,
  deleteSavedView,
  listSavedViews,
  renameSavedView,
  resolveSavedViewAccess,
  setSavedViewShared,
  type SavedViewContext,
  type SavedViewResult,
} from "@/lib/core/savedViews";
import { savedViewSurfaceSchema, type SavedViewDto } from "@/lib/savedViews";
import type { ActionResult } from "./org";

/*
 * Saved views on the event dashboard's paged lists (docs/FEATURES.md,
 * "Saved views"). Each action authenticates, rate-limits on the "action"
 * bucket, and re-checks the surface's own permission for this event of this
 * organisation (lib/core/savedViews.ts) before touching a view. They return
 * the surface's refreshed view list so the Views menu stays current.
 */

const NO_PERMISSION = "You do not have permission to use views on this list.";

const scopeSchema = z.object({
  organisationSlug: z.string().trim().min(1).max(200),
  eventId: z.string().trim().min(1).max(128),
  surface: savedViewSurfaceSchema,
});

type Gate = { ok: true; ctx: SavedViewContext; input: Record<string, unknown> } | { ok: false; error: string };

async function gate(input: unknown): Promise<Gate> {
  const fields = typeof input === "object" && input !== null && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
  const scope = scopeSchema.safeParse({ organisationSlug: fields.organisationSlug, eventId: fields.eventId, surface: fields.surface });
  if (!scope.success) return { ok: false, error: "Invalid input." };
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in." };
  if (await isActionRateLimited("action", userId)) return { ok: false, error: "Too many changes. Try again shortly." };
  const ctx = await resolveSavedViewAccess(userId, scope.data.organisationSlug, scope.data.eventId, scope.data.surface);
  if (!ctx) return { ok: false, error: NO_PERMISSION };
  return { ok: true, ctx, input: fields };
}

export type SavedViewsActionData = { view?: SavedViewDto; views: SavedViewDto[] };

async function withList<T extends { id: string }>(ctx: SavedViewContext, result: SavedViewResult<T>): Promise<ActionResult<SavedViewsActionData>> {
  if (!result.ok) return result;
  const views = await listSavedViews(ctx);
  const view = views.find((row) => row.id === result.data.id);
  return { ok: true, data: { view, views } };
}

/** Save the current filters as a view: `{ organisationSlug, eventId, surface, name, params, shared? }`. */
export async function saveView(input: unknown): Promise<ActionResult<SavedViewsActionData>> {
  const g = await gate(input);
  if (!g.ok) return g;
  return withList(g.ctx, await createSavedView(g.ctx, { name: g.input.name, params: g.input.params, shared: g.input.shared }));
}

/** Rename one of your own views: `{ …scope, viewId, name }`. */
export async function renameView(input: unknown): Promise<ActionResult<SavedViewsActionData>> {
  const g = await gate(input);
  if (!g.ok) return g;
  return withList(g.ctx, await renameSavedView(g.ctx, g.input.viewId, g.input.name));
}

/** Share or stop sharing one of your own views: `{ …scope, viewId, shared }`. */
export async function shareView(input: unknown): Promise<ActionResult<SavedViewsActionData>> {
  const g = await gate(input);
  if (!g.ok) return g;
  return withList(g.ctx, await setSavedViewShared(g.ctx, g.input.viewId, g.input.shared));
}

/** Delete your own view, or (owners/admins) a shared view: `{ …scope, viewId }`. */
export async function deleteView(input: unknown): Promise<ActionResult<SavedViewsActionData>> {
  const g = await gate(input);
  if (!g.ok) return g;
  return withList(g.ctx, await deleteSavedView(g.ctx, g.input.viewId));
}
