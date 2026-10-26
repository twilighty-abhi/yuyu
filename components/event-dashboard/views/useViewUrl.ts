"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { applyViewParamsToUrl, viewParamsFromSearchParams, type SavedViewSurfaceKey, type ViewParams } from "@/lib/savedViews";

/*
 * URL-addressable list filters (docs/FEATURES.md, "Saved views"). A surface
 * reads its view from the address bar once, when it mounts (only the active
 * tab and sub-tab are mounted, and switching either clears every view key),
 * and writes it back with `history.replaceState` whenever it changes, so a
 * reload, a bookmark or "Copy link" reopens the same filters. Values are
 * sanitised against the surface's allow-list both ways.
 */

/** The view in the address bar when the surface mounted (sanitised). */
export function useInitialViewParams(surface: SavedViewSurfaceKey): ViewParams {
  const searchParams = useSearchParams();
  // In the browser read the live address: a tab switch rewrites it just before this surface mounts.
  const [initial] = useState(() => viewParamsFromSearchParams(surface, typeof window === "undefined" ? searchParams : new URLSearchParams(window.location.search)));
  return initial;
}

/** Keep the address bar in step with the surface's current filters. */
export function useSyncViewToUrl(surface: SavedViewSurfaceKey, params: ViewParams, enabled = true) {
  const key = JSON.stringify(params);
  useEffect(() => {
    if (!enabled) return;
    const url = applyViewParamsToUrl(new URL(window.location.href), surface, JSON.parse(key) as ViewParams);
    if (url.toString() !== window.location.href) window.history.replaceState(window.history.state, "", url);
  }, [surface, key, enabled]);
}

