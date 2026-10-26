/*
 * Client-side bookkeeping for the paged "Recent check-ins" list. Pure (no
 * I/O), so the desk and the venue station share it and unit tests cover it.
 *
 * The server re-renders the first page every refresh (after a check-in, and
 * every 30 seconds). Older pages the operator loaded with "Load more" are
 * kept below it, so a refresh adds new check-ins at the top instead of
 * collapsing the list, unless so many people arrived that the new first page
 * no longer reaches what was loaded; then the list restarts from the new
 * first page rather than show a gap.
 */

export type RecentRow = { rsvpId: string; checkedInAt: string };
export type RecentList<R extends RecentRow> = { rows: R[]; cursor: string | null };

/** Newest first: later check-in time, then the larger id (the server's order). */
export function compareRecent(a: RecentRow, b: RecentRow): number {
  if (a.checkedInAt !== b.checkedInAt) return a.checkedInAt < b.checkedInAt ? 1 : -1;
  if (a.rsvpId === b.rsvpId) return 0;
  return a.rsvpId < b.rsvpId ? 1 : -1;
}

/** Merge a fresh first page into the rows already showing. */
export function mergeRecentFirstPage<R extends RecentRow>(previous: RecentList<R>, first: { rows: R[]; nextCursor: string | null }): RecentList<R> {
  const fresh: RecentList<R> = { rows: first.rows, cursor: first.nextCursor };
  const tail = first.rows[first.rows.length - 1];
  const newestBefore = previous.rows[0];
  // Everything fits on the first page, or nothing more had been loaded.
  if (!first.nextCursor || !tail || !newestBefore || previous.rows.length <= first.rows.length) return fresh;
  // More arrivals than one page since the last refresh: the pages would not join up.
  if (compareRecent(tail, newestBefore) < 0) return fresh;
  const onFirst = new Set(first.rows.map((row) => row.rsvpId));
  const older = previous.rows.filter((row) => !onFirst.has(row.rsvpId) && compareRecent(row, tail) > 0);
  if (older.length === 0) return fresh;
  return { rows: [...first.rows, ...older], cursor: previous.cursor };
}

/** Append a "Load more" page (rows already showing are not repeated). */
export function appendRecentPage<R extends RecentRow>(previous: RecentList<R>, page: { rows: R[]; nextCursor: string | null }): RecentList<R> {
  const seen = new Set(previous.rows.map((row) => row.rsvpId));
  return { rows: [...previous.rows, ...page.rows.filter((row) => !seen.has(row.rsvpId))], cursor: page.nextCursor };
}
