"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Info, RotateCcw, Search, X } from "lucide-react";
import { checkInToList, loadListRosterPage, lookupListAttendees, undoListCheckIn, type ListLookupRow } from "@/app/actions/checkin-lists";
import { Button, IconButton } from "@/components/ui/button";
import { FilterChip, Switch } from "@/components/ui/choice";
import { Callout, Chip, ProgressBar, type ChipTone } from "@/components/ui/display";
import { Input, Textarea } from "@/components/ui/field";
import { Tooltip } from "@/components/ui/menu";
import { useToast } from "@/components/feedback/ToastProvider";
import { CheckInQrScanner } from "@/components/checkin/CheckInQrScanner";
import { playRefusedFeedback, playSuccessFeedback } from "@/components/checkin/checkInFeedback";
import { cn } from "@/lib/cn";
import { formatTime } from "@/lib/format/datetime";
import { showingLabel } from "@/lib/keysetCursor";
import type { ListRosterPage } from "@/lib/eventDashboard/checkInLists";
import { useDebouncedValue, useServerPages, type ServerPageResult } from "@/components/event-dashboard/guests/useServerPages";

/*
 * The check-in desk for one custom list ("Swag", "Lunch – Day 1"). Scanning a
 * ticket, typing a code or choosing a guest from search marks them for this
 * list straight away, with undo. Entry check-in is never changed from here.
 */

export type ListDeskRosterRow = {
  rsvpId: string;
  displayName: string;
  email: string | null;
  status: string;
  entryCheckedInAt: string | null;
  listCheckedInAt: string | null;
  eligible: boolean;
};

type RosterFilter = "all" | "collected" | "notCollected";

type DeskResult =
  | { kind: "success" | "already"; rsvpId: string; displayName: string; email: string | null; message: string; checkedInAt: string }
  | { kind: "refused"; message: string; needsForce: boolean; retry?: { rawInput?: string; rsvpId?: string } };

const STATUS_CHIPS: Record<string, { label: string; tone: ChipTone }> = {
  WAITLISTED: { label: "Waitlist", tone: "warning" },
  PENDING_APPROVAL: { label: "To approve", tone: "warning" },
  REJECTED: { label: "Declined", tone: "danger" },
};

const SEARCH_DELAY_MS = 300;
const NO_COUNTS: Record<RosterFilter, number> = { all: 0, collected: 0, notCollected: 0 };
type RosterView = { filter: RosterFilter; query: string };

export function CheckInListDesk(props: {
  organisationSlug: string;
  eventId: string;
  timeZone: string;
  list: { id: string; name: string; requiresEntryCheckIn: boolean; collected: number; eligible: number };
  /** The first page of "Guests for <list>" with its chip counts; further pages, filters and search are fetched. */
  initialRoster: ListRosterPage;
}) {
  const { organisationSlug, eventId, timeZone, list, initialRoster } = props;
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  const [manual, setManual] = useState("");
  const [override, setOverride] = useState(false);
  const [result, setResult] = useState<DeskResult | null>(null);
  const [lookupQuery, setLookupQuery] = useState("");
  const [lookupRows, setLookupRows] = useState<ListLookupRow[]>([]);
  const [filter, setFilter] = useState<RosterFilter>("all");
  const [rosterQuery, setRosterQuery] = useState("");
  const target = useMemo(() => ({ organisationSlug, eventId, listId: list.id }), [eventId, list.id, organisationSlug]);

  // "Guests for <list>" is paged, filtered, searched and counted on the server.
  const searchedRoster = useDebouncedValue(rosterQuery.trim(), SEARCH_DELAY_MS);
  const rosterView: RosterView = useMemo(() => ({ filter, query: searchedRoster }), [filter, searchedRoster]);
  const initialRosterState = useMemo(
    () => ({ rows: initialRoster.rows as ListDeskRosterRow[], nextCursor: initialRoster.nextCursor, meta: initialRoster.counts ?? NO_COUNTS }),
    [initialRoster],
  );
  const fetchRosterPage = useCallback(
    async (view: RosterView, cursor: string | null): Promise<ServerPageResult<ListDeskRosterRow, Record<RosterFilter, number>>> => {
      const res = await loadListRosterPage({ ...target, filter: view.filter, query: view.query, cursor });
      if (!res.ok || !res.data) return { ok: false, error: res.ok ? "Could not load guests." : res.error };
      return { ok: true, page: { rows: res.data.rows, nextCursor: res.data.nextCursor, meta: res.data.counts } };
    },
    [target],
  );
  const roster = useServerPages<ListDeskRosterRow, RosterView, Record<RosterFilter, number>>({
    initial: initialRosterState,
    view: rosterView,
    viewKey: `${rosterView.filter}|${rosterView.query}`,
    isDefaultView: rosterView.filter === "all" && !rosterView.query,
    delayMs: 0,
    fetchPage: fetchRosterPage,
    keyOf: (row) => row.rsvpId,
  });
  const counts = roster.meta;

  const markLookup = useCallback((rsvpId: string, listCheckedInAt: string | null) => {
    setLookupRows((rows) => rows.map((row) => (row.rsvpId === rsvpId ? { ...row, listCheckedInAt } : row)));
  }, []);

  const submit = useCallback((input: { rawInput?: string; rsvpId?: string }, force: boolean) => {
    startTransition(async () => {
      const res = await checkInToList({ ...target, ...input, force });
      if (!res.ok) {
        setResult({ kind: "refused", message: res.error, needsForce: Boolean(res.needsForce), retry: input });
        playRefusedFeedback();
        return;
      }
      const data = res.data!;
      setResult({ kind: data.alreadyCheckedIn ? "already" : "success", rsvpId: data.rsvpId, displayName: data.displayName, email: data.email, message: data.message, checkedInAt: data.checkedInAt });
      markLookup(data.rsvpId, data.checkedInAt);
      setManual("");
      if (!data.alreadyCheckedIn) {
        playSuccessFeedback();
        router.refresh();
      }
    });
  }, [markLookup, router, target]);

  const undo = useCallback((rsvpId: string, displayName: string) => {
    startTransition(async () => {
      const res = await undoListCheckIn({ ...target, rsvpId });
      if (!res.ok) {
        showToast(res.error, "error");
        return;
      }
      setResult((current) => (current && current.kind !== "refused" && current.rsvpId === rsvpId ? null : current));
      markLookup(rsvpId, null);
      showToast(`${displayName} removed from ${list.name}`, "success");
      router.refresh();
    });
  }, [list.name, markLookup, router, showToast, target]);

  const onScan = useCallback((text: string) => {
    if (pending) return;
    submit({ rawInput: text }, override);
  }, [override, pending, submit]);

  const runLookup = () => {
    if (lookupQuery.trim().length < 2) {
      setLookupRows([]);
      return;
    }
    startTransition(async () => {
      const res = await lookupListAttendees({ ...target, query: lookupQuery });
      if (!res.ok) {
        showToast(res.error, "error");
        return;
      }
      setLookupRows(res.data!.rows);
    });
  };

  const rate = list.eligible > 0 ? Math.round((list.collected / list.eligible) * 1000) / 10 : 0;

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-4 border-b border-line pb-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink-muted">Check-in list</p>
          <h2 className="break-words text-h4 text-ink">{list.name}</h2>
        </div>
        <div className="min-w-[160px]">
          <p className="font-display text-ink" data-testid="list-count">
            <span className="text-[28px] font-extrabold">{list.collected}</span>
            <span className="text-base font-semibold text-ink-muted"> / {list.eligible} collected</span>
          </p>
          <p className="text-caption text-ink-muted">{list.eligible > 0 ? `${rate}% of eligible guests` : "No eligible guests yet"}</p>
          {list.eligible > 0 ? <ProgressBar value={Math.min(list.collected, list.eligible)} max={list.eligible} tone="success" label={`Collected for ${list.name}`} className="mt-1.5" /> : null}
        </div>
      </header>

      {list.requiresEntryCheckIn ? (
        <Callout tone="info">Guests must be checked in at entry before they can be marked for {list.name}.</Callout>
      ) : null}

      <div className="flex flex-col gap-3 rounded-lg border border-line bg-canvas p-4 sm:flex-row sm:items-center">
        <div className="flex items-center gap-2.5">
          <Switch id="list-check-in-override" checked={override} onCheckedChange={setOverride} />
          <label htmlFor="list-check-in-override" className="text-label text-ink">Override waitlist</label>
          <Tooltip content="The same rule as entry: allows waitlisted guests only. Pending approval and declined registrations stay blocked.">
            <IconButton label="About override" size="sm"><Info /></IconButton>
          </Tooltip>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-5">
          <section aria-labelledby="list-scan-title" className="flex flex-col gap-3">
            <div>
              <h3 id="list-scan-title" className="text-title text-ink">Scan QR</h3>
              <p className="text-sm text-ink-muted">Each scan marks the guest for {list.name} straight away. Undo is one tap away.</p>
            </div>
            <CheckInQrScanner onScan={onScan} disabled={pending} />
          </section>

          <section aria-labelledby="list-manual-title" className="flex flex-col gap-3 rounded-lg border border-line bg-canvas p-4">
            <h3 id="list-manual-title" className="text-title text-ink">Manual code</h3>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (manual.trim()) submit({ rawInput: manual }, override);
              }}
              className="flex flex-col gap-2.5"
            >
              <label htmlFor="list-check-in-manual" className="sr-only">Ticket URL or code</label>
              <Textarea id="list-check-in-manual" rows={2} placeholder="Ticket URL or code" value={manual} onChange={(event) => setManual(event.target.value)} disabled={pending} />
              <Button type="submit" variant="primary" disabled={pending || !manual.trim()} className="self-start">
                Check in to {list.name}
              </Button>
            </form>
          </section>
        </div>

        <div className="flex flex-col gap-5">
          <div aria-live="polite" aria-atomic="true">
            {result ? <ResultPanel result={result} listName={list.name} timeZone={timeZone} pending={pending} onNext={() => setResult(null)} onUndo={undo} onForce={(retry) => submit(retry, true)} /> : null}
          </div>

          <section aria-labelledby="list-search-title" className="flex flex-col gap-3 rounded-lg border border-line bg-canvas p-4">
            <h3 id="list-search-title" className="text-title text-ink">Search guests</h3>
            <div className="flex gap-2">
              <label htmlFor="list-check-in-search" className="sr-only">Name or email</label>
              <Input
                id="list-check-in-search"
                placeholder="Name or email"
                value={lookupQuery}
                onChange={(event) => setLookupQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    runLookup();
                  }
                }}
              />
              <Button variant="primary" startIcon={<Search />} onClick={runLookup} disabled={pending}>Search</Button>
            </div>
            {lookupRows.length > 0 ? (
              <ul aria-label="Search results" className="flex flex-col divide-y divide-line">
                {lookupRows.map((row) => (
                  <li key={row.rsvpId} className="flex flex-wrap items-center gap-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[15px] font-semibold text-ink">{row.displayName}</p>
                      {row.email ? <p className="truncate text-sm text-ink-muted">{row.email}</p> : null}
                      <div className="mt-1 flex flex-wrap gap-1">
                        {STATUS_CHIPS[row.status] ? <Chip size="sm" tone={STATUS_CHIPS[row.status]!.tone}>{STATUS_CHIPS[row.status]!.label}</Chip> : null}
                        {row.listCheckedInAt ? <Chip size="sm" tone="success" icon={<Check />}>{list.name} · {formatTime(row.listCheckedInAt, timeZone)}</Chip> : null}
                        {!row.entryCheckedInAt ? <Chip size="sm" tone="neutral">Not checked in at entry</Chip> : null}
                      </div>
                    </div>
                    {row.listCheckedInAt ? (
                      <Button size="sm" variant="quiet" onClick={() => undo(row.rsvpId, row.displayName)} disabled={pending} aria-label={`Undo ${list.name} for ${row.displayName}`}>Undo</Button>
                    ) : (
                      <Button size="sm" variant="primary" onClick={() => submit({ rsvpId: row.rsvpId }, override)} disabled={pending} aria-label={`Check ${row.displayName} in to ${list.name}`}>Check in</Button>
                    )}
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        </div>
      </div>

      <section aria-labelledby="list-roster-title" className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h3 id="list-roster-title" className="text-h4 text-ink">Guests for {list.name}</h3>
          <p className="text-caption text-ink-muted">Confirmed guests, plus anyone already in this list, in registration order.</p>
        </div>
        <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
          <div role="group" aria-label="Filter guests" className="flex flex-wrap gap-2">
            <FilterChip selected={filter === "all"} onClick={() => setFilter("all")}>All <span className="opacity-75">{counts.all}</span></FilterChip>
            <FilterChip selected={filter === "collected"} onClick={() => setFilter("collected")}>Collected <span className="opacity-75">{counts.collected}</span></FilterChip>
            <FilterChip selected={filter === "notCollected"} onClick={() => setFilter("notCollected")}>Not collected <span className="opacity-75">{counts.notCollected}</span></FilterChip>
          </div>
          <div className="sm:w-64">
            <label htmlFor="list-roster-filter" className="sr-only">Filter by name or email</label>
            <Input id="list-roster-filter" placeholder="Filter by name or email" value={rosterQuery} autoComplete="off" onChange={(event) => setRosterQuery(event.target.value)} />
          </div>
        </div>
        {roster.error ? <Callout tone="danger" role="alert">{roster.error}</Callout> : null}
        {roster.loading === "replace" ? (
          <p role="status" className="text-body-ui text-ink-muted">Loading guests…</p>
        ) : roster.rows.length === 0 ? (
          <p className="text-body-ui text-ink-muted">{initialRoster.counts?.all === 0 && filter === "all" && !rosterView.query ? "No confirmed guests yet." : "No guests match this filter."}</p>
        ) : (
          <ul id={roster.listId} aria-label={`Guests for ${list.name}`} aria-busy={roster.loading != null} className="flex flex-col divide-y divide-line rounded-lg border border-line bg-canvas px-4">
            {roster.rows.map((row) => (
              <li key={row.rsvpId} className="flex flex-wrap items-center gap-3 py-3">
                <span aria-hidden className={cn("flex size-6 shrink-0 items-center justify-center rounded-full", row.listCheckedInAt ? "bg-success-bg text-success-fg" : "bg-muted text-ink-muted")}>
                  {row.listCheckedInAt ? <Check className="size-4" /> : null}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-semibold text-ink">{row.displayName}</p>
                  <p className="truncate text-caption text-ink-muted">
                    {row.listCheckedInAt ? `Collected ${formatTime(row.listCheckedInAt, timeZone)}` : row.eligible ? "Not collected" : list.requiresEntryCheckIn && !row.entryCheckedInAt ? "Not checked in at entry" : "Not eligible"}
                    {row.email ? ` · ${row.email}` : ""}
                  </p>
                </div>
                {STATUS_CHIPS[row.status] ? <Chip size="sm" tone={STATUS_CHIPS[row.status]!.tone}>{STATUS_CHIPS[row.status]!.label}</Chip> : null}
                {row.listCheckedInAt ? (
                  <Button size="sm" variant="quiet" startIcon={<RotateCcw />} onClick={() => undo(row.rsvpId, row.displayName)} disabled={pending} aria-label={`Undo ${list.name} for ${row.displayName}`}>Undo</Button>
                ) : (
                  <Button size="sm" variant="secondary" onClick={() => submit({ rsvpId: row.rsvpId }, override)} disabled={pending} aria-label={`Check ${row.displayName} in to ${list.name}`}>Check in</Button>
                )}
              </li>
            ))}
          </ul>
        )}
        {roster.rows.length > 0 && roster.loading !== "replace" ? (
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-ink-secondary">
            <span aria-live="polite">{showingLabel(roster.rows.length, Math.max(counts[filter], roster.rows.length), "guests")}</span>
            {roster.nextCursor ? (
              <Button size="sm" variant="secondary" loading={roster.loading === "more"} loadingLabel="Loading…" onClick={() => void roster.loadMore()}>
                Show more
              </Button>
            ) : null}
          </div>
        ) : null}
      </section>
    </div>
  );
}

function ResultPanel({ result, listName, timeZone, pending, onNext, onUndo, onForce }: {
  result: DeskResult;
  listName: string;
  timeZone: string;
  pending: boolean;
  onNext: () => void;
  onUndo: (rsvpId: string, displayName: string) => void;
  onForce: (retry: { rawInput?: string; rsvpId?: string }) => void;
}) {
  if (result.kind === "refused") {
    return (
      <section data-testid="list-result" className={cn("flex flex-col gap-3 rounded-xl p-6", result.needsForce ? "border-2 border-warning-solid bg-warning-bg text-warning-fg" : "bg-danger-bg text-danger-fg")}>
        <p className="text-[15px] font-semibold">{result.needsForce ? "On the waitlist" : `Not added to ${listName}`}</p>
        <p className="text-body-ui">{result.message}</p>
        <div className="flex flex-wrap gap-2">
          {result.needsForce && result.retry ? (
            <Button size="sm" variant="primary" onClick={() => onForce(result.retry!)} disabled={pending}>Admit anyway</Button>
          ) : null}
          <Button size="sm" variant="secondary" startIcon={<X />} onClick={onNext}>Scan again</Button>
        </div>
      </section>
    );
  }
  const success = result.kind === "success";
  return (
    <section data-testid="list-result" className={cn("flex flex-col gap-3 rounded-xl p-6", success ? "bg-success-solid text-white" : "bg-emphasis text-ink")}>
      <p className="text-[15px] font-semibold">{success ? `Checked in to ${listName} at ${formatTime(result.checkedInAt, timeZone)}` : result.message}</p>
      <p className="break-words font-display text-[30px] font-extrabold leading-none tracking-[-0.03em]">{result.displayName}</p>
      {result.email ? <p className="text-sm opacity-90">{result.email}</p> : null}
      <div className="mt-1 flex flex-wrap gap-2">
        <Button size="sm" variant={success ? "inverse" : "secondary"} startIcon={<X />} onClick={onNext}>Next guest</Button>
        <Button size="sm" variant={success ? "inverse" : "quiet"} startIcon={<RotateCcw />} onClick={() => onUndo(result.rsvpId, result.displayName)} disabled={pending}>Undo</Button>
      </div>
    </section>
  );
}
