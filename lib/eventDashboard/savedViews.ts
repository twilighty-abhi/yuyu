import "server-only";

import { cache } from "react";
import { loadDashboardSavedViews, savedViewSurfacesFor } from "@/lib/core/savedViews";
import type { EventDashboardContext } from "@/lib/eventDashboard/context";
import type { SavedViewDto, SavedViewSurfaceKey } from "@/lib/savedViews";

/*
 * Saved views for the event dashboard's lists (docs/FEATURES.md, "Saved
 * views"), loaded once per request for every list the viewer may open
 * (`savedViewSurfacesFor` mirrors each list's own permission). Views are an
 * extra on top of the lists: if they can't be read, the lists still render
 * (with presets only) rather than failing the whole dashboard.
 */
export const loadSavedViewsForDashboard = cache(async (ctx: EventDashboardContext): Promise<Partial<Record<SavedViewSurfaceKey, SavedViewDto[]>>> => {
  const surfaces = savedViewSurfacesFor(ctx.permissions, ctx.event.registrationMode === "TEAM");
  try {
    return await loadDashboardSavedViews(
      { userId: ctx.userId, organisationId: ctx.organisation.id, eventId: ctx.event.id, isAdmin: ctx.permissions.isAdmin },
      surfaces,
    );
  } catch {
    console.error("[saved views] loading failed");
    return {};
  }
});
