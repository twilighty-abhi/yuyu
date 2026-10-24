"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLoadMoreFocus } from "@/components/ui/use-load-more-focus";

/*
 * Cursor paging for a server-filtered list ("Load more"), the pattern of the
 * Guests → Teams view as a reusable hook. The first page of the default view
 * arrives with the server render; changing the view fetches its first page
 * (after `delayMs`, for typing), "Load more" appends the next page, and a
 * server refresh (a new `initial`, after a change) re-reads as many pages as
 * were showing so the list doesn't jump back to page one.
 *
 * A list opened with filters already set (a link or saved view in the
 * address bar) starts loading that view's first page on mount.
 *
 * Every fetch goes through a Server Action that re-checks permission and
 * scope; out-of-order replies are dropped, and a request that fails (such as
 * a dropped connection) shows an error instead of leaving the list loading.
 * Give the list element `id={listId}` so "Load more" moves focus to the
 * first new row.
 */

const LOAD_FAILED = "Couldn't load the list. Try again.";

export type ServerPage<R, M> = { rows: R[]; nextCursor: string | null; meta: M | null };
export type ServerPageResult<R, M> = { ok: true; page: ServerPage<R, M> } | { ok: false; error: string };

export function useServerPages<R, V, M>(options: {
  /** The default view's first page, from the server render. */
  initial: { rows: R[]; nextCursor: string | null; meta: M };
  view: V;
  /** A stable string for `view` (it changes exactly when the view does). */
  viewKey: string;
  /** True when `initial` describes `view`. */
  isDefaultView: boolean;
  /** Wait before fetching a changed view (debounce while typing); 0 fetches at once. */
  delayMs: number;
  /** `meta` is only read from first pages (cursor null). */
  fetchPage: (view: V, cursor: string | null) => Promise<ServerPageResult<R, M>>;
  keyOf: (row: R) => string;
}) {
  const { initial, view, viewKey, isDefaultView, delayMs } = options;
  const [rows, setRows] = useState<R[]>(initial.rows);
  const [nextCursor, setNextCursor] = useState<string | null>(initial.nextCursor);
  const [meta, setMeta] = useState<M>(initial.meta);
  // A view opened from the address bar (saved views) isn't the server-rendered first page: load it on mount.
  const [loading, setLoading] = useState<"replace" | "more" | null>(isDefaultView ? null : "replace");
  const [error, setError] = useState<string | null>(null);

  const seq = useRef(0);
  const pagesLoaded = useRef(1);
  const fetchRef = useRef(options.fetchPage);
  const safeFetch = useCallback(async (target: V, cursor: string | null): Promise<ServerPageResult<R, M>> => {
    try {
      return await fetchRef.current(target, cursor);
    } catch {
      return { ok: false, error: LOAD_FAILED };
    }
  }, []);
  const keyRef = useRef(options.keyOf);
  const viewRef = useRef(view);
  useEffect(() => {
    fetchRef.current = options.fetchPage;
    keyRef.current = options.keyOf;
    viewRef.current = view;
  });

  const merge = useCallback((current: R[], more: R[]) => {
    const seen = new Set(current.map((row) => keyRef.current(row)));
    return [...current, ...more.filter((row) => !seen.has(keyRef.current(row)))];
  }, []);

  /** Re-read the first `pages` pages of a view (1 for a fresh view). */
  const readPages = useCallback(async (target: V, pages: number, mode: "replace" | "quiet") => {
    const mine = ++seq.current;
    if (mode === "replace") setLoading("replace");
    setError(null);
    let collected: R[] = [];
    let cursor: string | null = null;
    let firstMeta: M | null = null;
    let loaded = 0;
    do {
      const res: ServerPageResult<R, M> = await safeFetch(target, cursor);
      if (mine !== seq.current) return;
      if (!res.ok) {
        setLoading(null);
        setError(res.error);
        return;
      }
      if (loaded === 0) firstMeta = res.page.meta;
      collected = merge(collected, res.page.rows);
      cursor = res.page.nextCursor;
      loaded += 1;
    } while (cursor && loaded < pages);
    setLoading(null);
    setRows(collected);
    setNextCursor(cursor);
    if (firstMeta != null) setMeta(firstMeta);
    pagesLoaded.current = loaded;
  }, [merge, safeFetch]);

  const { listId, beforeLoadMore } = useLoadMoreFocus(rows.length);
  const loadMore = useCallback(async () => {
    if (!nextCursor) return;
    beforeLoadMore();
    const mine = ++seq.current;
    setLoading("more");
    setError(null);
    const res = await safeFetch(viewRef.current, nextCursor);
    if (mine !== seq.current) return;
    setLoading(null);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setRows((current) => merge(current, res.page.rows));
    setNextCursor(res.page.nextCursor);
    pagesLoaded.current += 1;
  }, [beforeLoadMore, merge, nextCursor, safeFetch]);

  /** Re-read what is showing now (after a change made on this page). */
  const reload = useCallback(() => readPages(viewRef.current, pagesLoaded.current, "quiet"), [readPages]);

  const firstRun = useRef(true);
  const lastViewKey = useRef(viewKey);
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      if (!isDefaultView) void readPages(viewRef.current, 1, "replace");
      return;
    }
    const viewChanged = lastViewKey.current !== viewKey;
    lastViewKey.current = viewKey;
    if (!viewChanged) {
      // A server refresh: keep the same stretch of the list.
      if (!isDefaultView || pagesLoaded.current > 1) {
        void readPages(viewRef.current, pagesLoaded.current, "quiet");
        return;
      }
      const timer = window.setTimeout(() => {
        seq.current += 1;
        pagesLoaded.current = 1;
        setLoading(null);
        setError(null);
        setRows(initial.rows);
        setNextCursor(initial.nextCursor);
        setMeta(initial.meta);
      }, 0);
      return () => window.clearTimeout(timer);
    }
    const timer = window.setTimeout(() => {
      if (!isDefaultView) {
        void readPages(viewRef.current, 1, "replace");
        return;
      }
      seq.current += 1;
      pagesLoaded.current = 1;
      setLoading(null);
      setError(null);
      setRows(initial.rows);
      setNextCursor(initial.nextCursor);
      setMeta(initial.meta);
    }, isDefaultView ? 0 : delayMs);
    return () => window.clearTimeout(timer);
    // `initial` changes on every server refresh; `viewKey` on every view change.
  }, [viewKey, initial, isDefaultView, delayMs, readPages]);

  return { rows, setRows, nextCursor, meta, loading, error, loadMore, reload, listId };
}

/** `value`, once it has stopped changing for `delayMs` (search boxes). */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);
  return settled;
}
