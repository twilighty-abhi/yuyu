"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useLoadMoreFocus } from "@/components/ui/use-load-more-focus";

/** Mirrors `CursorPage` in lib/core/teams.ts (the client bundle must not import server code). */
export type CursorListPage<T> = { items: T[]; nextCursor: string | null; total: number };

type PageResult<T> = { ok: true; data?: CursorListPage<T> } | { ok: false; error: string };
type Loader<T> = (query: string, cursor: string | null) => Promise<PageResult<T>>;

const SEARCH_DELAY_MS = 300;
const LOAD_FAILED = "Couldn't load the list. Try again.";

/** Stable stand-in while a list is unavailable, so the hook never sees a new object per render. */
export const EMPTY_CURSOR_PAGE: CursorListPage<never> = { items: [], nextCursor: null, total: 0 };

/**
 * A server-paged list with "Show more" and an optional search, for the team
 * page and the ticket page (the same pattern as the organiser Teams view).
 * The first page comes with the page render; searches and further pages go
 * through `load` (a read-only Server Action that re-checks access). When a
 * change refreshes the page (new `initial`), the list reloads as many pages
 * as were showing, with the current search. Attach `listRef` to the list
 * element so "Show more" moves focus to the first new item.
 */
export function useCursorList<T extends { id: string }>(initial: CursorListPage<T>, load: Loader<T>) {
  const [items, setItems] = useState<T[]>(initial.items);
  const [nextCursor, setNextCursor] = useState<string | null>(initial.nextCursor);
  const [total, setTotal] = useState(initial.total);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState<"replace" | "more" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loadRef = useRef(load);
  const requestSeq = useRef(0);
  const pagesLoaded = useRef(1);
  // The search the shown items belong to, so "Show more" never mixes a cursor with newer, unsent typing.
  const appliedQuery = useRef("");

  useEffect(() => {
    loadRef.current = load;
  });

  const fetchPage = useCallback(async (search: string, cursor: string | null) => {
    const seq = ++requestSeq.current;
    setLoading(cursor ? "more" : "replace");
    setError(null);
    let res: PageResult<T>;
    try {
      res = await loadRef.current(search.trim(), cursor);
    } catch {
      res = { ok: false, error: LOAD_FAILED };
    }
    if (seq !== requestSeq.current) return;
    setLoading(null);
    if (!res.ok || !res.data) {
      setError(res.ok ? LOAD_FAILED : res.error);
      return;
    }
    const page = res.data;
    setItems((current) => (cursor ? [...current, ...page.items.filter((item) => !current.some((other) => other.id === item.id))] : page.items));
    setNextCursor(page.nextCursor);
    setTotal(page.total);
    pagesLoaded.current = cursor ? pagesLoaded.current + 1 : 1;
    appliedQuery.current = search;
  }, []);

  /** Re-read the first `pages` pages in place (after a change). */
  const reloadPages = useCallback(async (search: string, pages: number) => {
    const seq = ++requestSeq.current;
    setError(null);
    const collected: T[] = [];
    let cursor: string | null = null;
    let total = 0;
    let loaded = 0;
    do {
      let res: PageResult<T>;
      try {
        res = await loadRef.current(search.trim(), cursor);
      } catch {
        res = { ok: false, error: LOAD_FAILED };
      }
      if (seq !== requestSeq.current) return;
      if (!res.ok || !res.data) {
        setError(res.ok ? LOAD_FAILED : res.error);
        return;
      }
      for (const item of res.data.items) if (!collected.some((other) => other.id === item.id)) collected.push(item);
      cursor = res.data.nextCursor;
      total = res.data.total;
      loaded += 1;
    } while (cursor && loaded < pages);
    setItems(collected);
    setNextCursor(cursor);
    setTotal(total);
    pagesLoaded.current = loaded;
    appliedQuery.current = search;
  }, []);

  // A search fetches its first page once typing pauses; clearing it goes back
  // to the page that came with the render. A refresh (new `initial`) reloads
  // the same stretch of the list.
  const firstRun = useRef(true);
  const lastQuery = useRef(query);
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    const searching = Boolean(query.trim());
    const queryChanged = lastQuery.current !== query;
    lastQuery.current = query;
    if (!queryChanged && (pagesLoaded.current > 1 || searching)) {
      void reloadPages(query, pagesLoaded.current);
      return;
    }
    const timer = window.setTimeout(() => {
      if (searching) {
        void fetchPage(query, null);
        return;
      }
      requestSeq.current += 1;
      pagesLoaded.current = 1;
      appliedQuery.current = "";
      setLoading(null);
      setError(null);
      setItems(initial.items);
      setNextCursor(initial.nextCursor);
      setTotal(initial.total);
    }, queryChanged && searching ? SEARCH_DELAY_MS : 0);
    return () => window.clearTimeout(timer);
  }, [query, initial, fetchPage, reloadPages]);

  const { listId, beforeLoadMore } = useLoadMoreFocus(items.length);
  const loadMore = useCallback(() => {
    if (!nextCursor) return;
    beforeLoadMore();
    void fetchPage(appliedQuery.current, nextCursor);
  }, [beforeLoadMore, fetchPage, nextCursor]);

  return { items, nextCursor, total, query, setQuery, loading, error, loadMore, listId };
}

/** "Showing 20 of 87" with a "Show more" button while more pages remain. */
export function ShowMoreFooter({
  shown,
  total,
  hasMore,
  loading,
  onMore,
  label = "Show more",
}: {
  shown: number;
  total: number;
  hasMore: boolean;
  loading: boolean;
  onMore: () => void;
  label?: string;
}) {
  if (!hasMore && shown >= total) return null;
  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
      <p className="text-caption text-ink-muted" aria-live="polite">
        Showing {shown} of {total}
      </p>
      {hasMore ? (
        <Button variant="secondary" size="sm" loading={loading} loadingLabel="Loading…" onClick={onMore}>
          {label}
        </Button>
      ) : null}
    </div>
  );
}
