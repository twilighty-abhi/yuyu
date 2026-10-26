"use client";

import { useCallback, useMemo } from "react";
import { loadUnsubmittedEntrantsPage } from "@/app/actions/judging-admin";
import { Button } from "@/components/ui/button";
import { Callout, Chip, EmptyState } from "@/components/ui/display";
import { Spinner } from "@/components/ui/spinner";
import { useServerPages, type ServerPageResult } from "@/components/event-dashboard/guests/useServerPages";
import { formatDayTime } from "@/lib/format/datetime";
import { showingLabel } from "@/lib/keysetCursor";
import type { JudgingDashboardUnsubmittedEntrant } from "@/lib/eventDashboard/judging";
import { SUBMISSION_STATUS_LABELS, SUBMISSION_STATUS_TONES, type JudgingScope } from "./JudgingPanelShared";

type View = { query: string };
type Meta = { total: number };

const NO_ROWS = { rows: [] as JudgingDashboardUnsubmittedEntrant[], nextCursor: null, meta: { total: 0 } };

/**
 * Judging → Submissions → Not submitted: confirmed teams and solo registrants
 * whose project isn't SUBMITTED (none yet, a draft, withdrawn, or
 * disqualified), oldest registration first, a server page at a time
 * (`loadUnsubmittedEntrantsPage`, organisers only). Names and sizes only.
 */
export function JudgingUnsubmittedList({ scope, query, total, timezone }: { scope: JudgingScope; query: string; total: number; timezone: string }) {
  const view = useMemo<View>(() => ({ query: query.trim() }), [query]);
  const initial = useMemo(() => ({ ...NO_ROWS, meta: { total } }), [total]);
  const fetchPage = useCallback(
    async (current: View, cursor: string | null): Promise<ServerPageResult<JudgingDashboardUnsubmittedEntrant, Meta>> => {
      const res = await loadUnsubmittedEntrantsPage({ ...scope, query: current.query, cursor });
      if (!res.ok || !res.data) return { ok: false, error: res.ok ? "Could not load entrants." : res.error };
      return { ok: true, page: { rows: res.data.entrants, nextCursor: res.data.nextCursor, meta: res.data.total != null ? { total: res.data.total } : null } };
    },
    [scope],
  );
  // Nothing is server-rendered for this view, so it always loads its first page.
  const list = useServerPages<JudgingDashboardUnsubmittedEntrant, View, Meta>({
    initial,
    view,
    viewKey: view.query,
    isDefaultView: false,
    delayMs: 300,
    fetchPage,
    keyOf: (row) => `${row.kind}:${row.id}`,
  });
  const shown = list.meta.total;

  return (
    <div className="flex flex-col gap-3">
      <p className="text-caption text-ink-muted">Confirmed teams and solo entrants without a submitted project.</p>
      {list.error ? (
        <Callout tone="danger" role="alert">
          {list.error}
        </Callout>
      ) : null}
      {list.loading === "replace" ? (
        <div className="flex justify-center py-6">
          <Spinner className="size-5" />
          <span className="sr-only">Loading entrants</span>
        </div>
      ) : list.rows.length === 0 ? (
        <EmptyState title={view.query ? "No matching entrants" : "Everyone has submitted"}>{view.query ? "Try another search." : "Every confirmed entrant has a submitted project."}</EmptyState>
      ) : (
        <ul id={list.listId} aria-label="Entrants without a submitted project" aria-busy={list.loading != null} className="flex flex-col divide-y divide-line rounded-lg border border-line bg-canvas">
          {list.rows.map((entrant) => (
            <li key={`${entrant.kind}:${entrant.id}`} className="flex flex-col gap-1 px-4 py-3.5">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-label text-ink">{entrant.name}</p>
                {entrant.submissionStatus ? (
                  <Chip size="sm" tone={SUBMISSION_STATUS_TONES[entrant.submissionStatus]}>
                    {SUBMISSION_STATUS_LABELS[entrant.submissionStatus]}
                  </Chip>
                ) : (
                  <Chip size="sm" tone="outline">
                    No project yet
                  </Chip>
                )}
              </div>
              <p className="text-caption text-ink-muted">
                {entrant.kind === "team" ? `Team · ${entrant.size} ${entrant.size === 1 ? "person" : "people"}` : "Solo"}
                {entrant.submissionTitle ? ` · “${entrant.submissionTitle}”` : ""} · registered {formatDayTime(entrant.registeredAt, timezone)}
              </p>
            </li>
          ))}
        </ul>
      )}
      {list.rows.length > 0 && list.loading !== "replace" ? (
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-ink-secondary">
          <span aria-live="polite">{showingLabel(list.rows.length, Math.max(shown, list.rows.length), shown === 1 ? "entrant" : "entrants")}</span>
          {list.nextCursor ? (
            <Button size="sm" variant="secondary" loading={list.loading === "more"} loadingLabel="Loading…" onClick={() => void list.loadMore()}>
              Load more entrants
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
