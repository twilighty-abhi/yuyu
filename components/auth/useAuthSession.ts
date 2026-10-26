"use client";

import { useSyncExternalStore } from "react";
import { getSession } from "next-auth/react";
import type { Session } from "next-auth";

/*
 * The signed-in session for client chrome (site header and footer, the
 * organiser page header) and the RSVP form, as an external store instead of
 * next-auth's <SessionProvider> context.
 *
 * Why not the provider: it fetches the session after the first client render
 * and changes its context value. A context change above a streamed Suspense
 * boundary that React has not hydrated yet (the dashboard's loading.tsx
 * boundary, waiting for its batched reveal) makes React give up hydrating it
 * and render the whole panel again on the client, while the server copy waits
 * in the hidden `div#S:1` streaming container: two copies of every panel, with
 * duplicate ids such as #guest-search, until the reveal script removes it (or
 * indefinitely in a background tab, where the reveal's animation frame never
 * runs). A store update only re-renders the components that read it, so the
 * boundary hydrates the server HTML as it should
 * (tests/e2e/filtered-exports.spec.ts).
 *
 * The server snapshot is always "loading", like the provider without an
 * initial session, so server and client markup match.
 */

export type AuthSessionState =
  | { status: "loading"; data: null }
  | { status: "authenticated"; data: Session }
  | { status: "unauthenticated"; data: null };

const LOADING: AuthSessionState = { status: "loading", data: null };

/** A fetched session is reused for this long before a new reader refreshes it. */
const STALE_AFTER_MS = 60_000;

let snapshot: AuthSessionState = LOADING;
let lastSync = 0;
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();
let windowListeners = false;

function publish(next: AuthSessionState) {
  snapshot = next;
  for (const listener of listeners) listener();
}

/** Re-read the session from `/api/auth/session` (deduplicated while one is in flight). */
export function refreshAuthSession(): Promise<void> {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      // `broadcast: false`: this read must not wake other tabs into reading too.
      const session = await getSession({ broadcast: false });
      lastSync = Date.now();
      publish(session?.user ? { status: "authenticated", data: session } : { status: "unauthenticated", data: null });
    } catch {
      // Keep the last known state; the next focus or reader retries.
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

function onVisibilityChange() {
  if (document.visibilityState === "visible") void refreshAuthSession();
}

function onBroadcast(event: MessageEvent) {
  // next-auth posts { event: "session" } when another tab signs in or out.
  if ((event.data as { event?: string } | null)?.event === "session") void refreshAuthSession();
}

let channel: BroadcastChannel | null = null;

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!windowListeners) {
    windowListeners = true;
    document.addEventListener("visibilitychange", onVisibilityChange);
    if (typeof BroadcastChannel !== "undefined") {
      channel = new BroadcastChannel("next-auth");
      channel.addEventListener("message", onBroadcast);
    }
  }
  if (snapshot.status === "loading" || Date.now() - lastSync > STALE_AFTER_MS) void refreshAuthSession();
  return () => {
    listeners.delete(listener);
  };
}

/** The current session state; "loading" on the server and until the first read finishes. */
export function useAuthSession(): AuthSessionState {
  return useSyncExternalStore(subscribe, () => snapshot, () => LOADING);
}
