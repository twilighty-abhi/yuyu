"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AtSign, Download, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Callout, EmptyState } from "@/components/ui/display";
import { Dropdown, SearchInput } from "@/components/ui/field";
import { cn } from "@/lib/cn";
import type { AttendeeRow } from "@/components/attendees/types";
import { ManualRsvpDialog } from "@/components/attendees/ManualRsvpDialog";
import { EditRsvpDialog } from "@/components/attendees/EditRsvpDialog";
import type { RegistrationFieldRow } from "@/components/registration/EventRegistrationFormEditor";
import { ConfirmationDialog } from "@/components/feedback/ConfirmationDialog";
import { useToast } from "@/components/feedback/ToastProvider";
import { deleteRsvp, restoreRsvp } from "@/app/actions/rsvp-admin";
import { approveRsvp, promoteFromWaitlist, reacceptRsvp, rejectRsvp } from "@/app/actions/rsvp-lifecycle";
import { undoCheckIn } from "@/app/actions/checkin";
import { GuestRow, type GuestRowActions } from "@/components/event-dashboard/guests/GuestRow";
import { useEventTabs } from "@/components/event-dashboard/EventDashboardTabs";
import { MoveToTeamDialog } from "@/components/event-dashboard/guests/MoveToTeamDialog";
import {
  GUEST_FILTERS,
  guestDisplayName,
  type GuestKindFilter,
  type GuestStatusFilter,
  type GuestTeamFilter,
} from "@/components/event-dashboard/guests/guestList";
import { useDebouncedValue, useServerPages, type ServerPageResult } from "@/components/event-dashboard/guests/useServerPages";
import { loadAttendeesPage } from "@/app/actions/guest-list";
import { attendeeViewSearchParams } from "@/lib/attendeeListQuery";
import { showingLabel } from "@/lib/keysetCursor";
import type { AttendeeFilterCounts, AttendeesPage } from "@/lib/eventDashboard/attendees";

const SEARCH_DELAY_MS = 300;

const NO_COUNTS: AttendeeFilterCounts = { all: 0, going: 0, waitlist: 0, approve: 0, declined: 0, checkedIn: 0 };

type View = { status: GuestStatusFilter; kind: GuestKindFilter; team: GuestTeamFilter; query: string };
type Meta = { counts: AttendeeFilterCounts; total: number };

const FILTER_DOTS: Record<GuestStatusFilter, string> = {
  all: "bg-ink",
  going: "bg-success-fg",
  waitlist: "bg-warning-fg",
  approve: "bg-warning-fg",
  declined: "bg-danger-fg",
  checkedIn: "bg-accent",
};

type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * Guests · People. The list is paged, filtered and searched on the server
 * (`loadAttendeesPage`), so every registration can be found and the chip
 * counts cover the whole event; "Load more" appends the next page.
 *
 * Whose registrations the list shows. A one-off event gets the full toolset;
 * a series date (RSVPs keyed by `eventInstanceId`) only gets the actions that
 * accept an instance id, so manual add, the CSV/email exports and undo
 * check-in are hidden there.
 */
export type GuestListTarget =
  | { kind: "event"; eventId: string; eventTitle: string }
  | { kind: "instance"; instanceId: string; seriesId: string };

export function GuestsPeople({
  organisationSlug,
  target,
  title = "Guests",
  timeZone,
  now,
  initialPage,
  registrationFields,
  teamMode = false,
  canUndoCheckIn = true,
}: {
  organisationSlug: string;
  target: GuestListTarget;
  title?: string;
  timeZone: string;
  /** Server render time (ISO) so relative labels match between server and client. */
  now: string;
  /** The first page of the unfiltered list, with its counts. */
  initialPage: AttendeesPage;
  registrationFields: RegistrationFieldRow[];
  /** TEAM event: show each guest's team, the In a team / Solo filter, route status changes to Teams, and offer Move to team. */
  teamMode?: boolean;
  /** Undo check-in is a CHECK_IN operation, separate from managing registrations. */
  canUndoCheckIn?: boolean;
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [manualRsvpOpen, setManualRsvpOpen] = useState(false);
  const [status, setStatus] = useState<GuestStatusFilter>("all");
  const [kind, setKind] = useState<GuestKindFilter>("all");
  const [team, setTeam] = useState<GuestTeamFilter>("all");
  const { openTab } = useEventTabs();
  const [query, setQuery] = useState("");
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editGuest, setEditGuest] = useState<AttendeeRow | null>(null);
  const [removeGuest, setRemoveGuest] = useState<AttendeeRow | null>(null);
  const [undoGuest, setUndoGuest] = useState<AttendeeRow | null>(null);
  const [moveGuest, setMoveGuest] = useState<AttendeeRow | null>(null);

  const eventId = target.kind === "event" ? target.eventId : undefined;
  const scope = target.kind === "event" ? { eventId: target.eventId } : { eventInstanceId: target.instanceId };

  const searchedQuery = useDebouncedValue(query.trim(), SEARCH_DELAY_MS);
  const view: View = useMemo(() => ({ status, kind, team: teamMode ? team : "all", query: searchedQuery }), [status, kind, team, teamMode, searchedQuery]);
  const viewKey = JSON.stringify(view);
  const isDefaultView = view.status === "all" && view.kind === "all" && view.team === "all" && !view.query;
  const initial = useMemo(
    () => ({ rows: initialPage.rows as AttendeeRow[], nextCursor: initialPage.nextCursor, meta: { counts: initialPage.counts ?? NO_COUNTS, total: initialPage.total ?? 0 } as Meta }),
    [initialPage],
  );
  const scopeIds = useMemo(() => (target.kind === "event" ? { eventId: target.eventId } : { eventInstanceId: target.instanceId }), [target]);
  const fetchPage = useCallback(
    async (current: View, cursor: string | null): Promise<ServerPageResult<AttendeeRow, Meta>> => {
      const res = await loadAttendeesPage({ organisationSlug, ...scopeIds, ...current, cursor });
      if (!res.ok || !res.data) return { ok: false, error: res.ok ? "Could not load guests." : res.error };
      const { rows, nextCursor, counts, total } = res.data;
      return { ok: true, page: { rows, nextCursor, meta: counts && total != null ? { counts, total } : null } };
    },
    [organisationSlug, scopeIds],
  );
  const list = useServerPages<AttendeeRow, View, Meta>({ initial, view, viewKey, isDefaultView, delayMs: 0, fetchPage, keyOf: (row) => row.id });
  const { counts, total } = list.meta;
  const shownTotal = counts[view.status];
  const emailExportHref = eventId ? `/api/exports/events/${eventId}/attendee-emails${attendeeViewSearchParams(view) ? `?${attendeeViewSearchParams(view)}` : ""}` : null;

  function run<R extends ActionResult>(guest: AttendeeRow, action: () => Promise<R>, success: string | ((res: R & { ok: true }) => string)) {
    setBusyId(guest.id);
    startTransition(async () => {
      const res = await action();
      setBusyId(null);
      if (!res.ok) {
        showToast(res.error, "error");
        return;
      }
      showToast(typeof success === "string" ? success : success(res as R & { ok: true }), "success");
      router.refresh();
    });
  }

  const actions: GuestRowActions = {
    approve: (guest) => run(guest, () => approveRsvp({ organisationSlug, rsvpId: guest.id, ...scope }), "Approved"),
    decline: (guest) => run(guest, () => rejectRsvp({ organisationSlug, rsvpId: guest.id, ...scope }), "Declined"),
    promote: (guest) => run(guest, () => promoteFromWaitlist({ organisationSlug, rsvpId: guest.id, ...scope }), "Spot given"),
    reaccept: (guest) =>
      run(guest, () => reacceptRsvp({ organisationSlug, rsvpId: guest.id, ...scope }), (res) =>
        res.data?.status === "WAITLISTED" ? "Re-accepted. The event is full, so they are on the waitlist." : "Re-accepted",
      ),
    copyTicket: async (guest) => {
      try {
        await navigator.clipboard.writeText(guest.ticketUrl);
        showToast("Ticket link copied", "success");
      } catch {
        showToast("Could not copy", "error");
      }
    },
    edit: (guest) => setEditGuest(guest),
    undoCheckIn: eventId && canUndoCheckIn ? (guest) => setUndoGuest(guest) : undefined,
    remove: (guest) => setRemoveGuest(guest),
    openTeams: teamMode && target.kind === "event" ? () => openTab("guests", "teams") : undefined,
    // The dialog searches the event's teams on the server; the move itself is re-checked there.
    moveToTeam: teamMode && target.kind === "event" ? (guest) => setMoveGuest(guest) : undefined,
  };

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-h4 text-ink">{title}</h2>
        {target.kind === "event" ? (
          <div className="flex flex-wrap gap-2">
            {emailExportHref && shownTotal > 0 ? (
              <Button asChild variant="secondary" startIcon={<AtSign />}>
                <a href={emailExportHref} title="Export emails for every guest matching these filters">Export emails</a>
              </Button>
            ) : (
              <Button variant="secondary" startIcon={<AtSign />} disabled title="No guests match these filters">
                Export emails
              </Button>
            )}
            <Button asChild variant="secondary" startIcon={<Download />}>
              <a href={`/api/exports/events/${target.eventId}/attendees`}>Download CSV</a>
            </Button>
            <Button variant="primary" startIcon={<Plus />} onClick={() => setManualRsvpOpen(true)}>
              Add guest
            </Button>
          </div>
        ) : null}
      </div>

      {total === 0 && list.rows.length === 0 ? (
        <EmptyState mood="sleepy" title="No guests yet.">
          Registrations appear here as people sign up.{eventId ? " You can also add a guest yourself." : null}
        </EmptyState>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2.5">
            <div role="group" aria-label="Filter by status" className="flex flex-wrap gap-1.5">
              {GUEST_FILTERS.map(({ value, label }) => {
                const on = status === value;
                return (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setStatus(value)}
                    className={cn(
                      "inline-flex min-h-[38px] items-center gap-2 rounded-full border px-3.5 text-sm font-semibold transition-colors",
                      on ? "border-primary bg-primary text-on-primary" : "border-line-strong bg-canvas text-ink hover:bg-subtle",
                    )}
                  >
                    <span aria-hidden className={cn("size-2 rounded-full", value === "all" && on ? "bg-on-primary" : FILTER_DOTS[value])} />
                    {label}
                    <span className="opacity-75">{counts[value]}</span>
                  </button>
                );
              })}
            </div>
            <div className="flex w-full min-w-0 flex-wrap gap-2 sm:ml-auto sm:w-auto sm:flex-nowrap">
              <div className="min-w-0 flex-1 sm:w-[160px] sm:flex-none">
                <label htmlFor="guest-kind" className="sr-only">Registration type</label>
                <Dropdown id="guest-kind" value={kind} onChange={(event) => setKind(event.target.value as GuestKindFilter)} className="py-2 sm:text-sm">
                  <option value="all">Everyone</option>
                  <option value="guests">Guests only</option>
                  <option value="users">Signed-in users</option>
                </Dropdown>
              </div>
              {teamMode ? (
                <div className="min-w-0 flex-1 sm:w-[140px] sm:flex-none">
                  <label htmlFor="guest-team" className="sr-only">Team</label>
                  <Dropdown id="guest-team" value={team} onChange={(event) => setTeam(event.target.value as GuestTeamFilter)} className="py-2 sm:text-sm">
                    <option value="all">Teams and solo</option>
                    <option value="team">In a team</option>
                    <option value="solo">Solo</option>
                  </Dropdown>
                </div>
              ) : null}
              <div className="w-full min-w-0 sm:w-[260px]">
                <label htmlFor="guest-search" className="sr-only">Search guests by name or email</label>
                <SearchInput
                  id="guest-search"
                  placeholder={teamMode ? "Search name, email or team" : "Search name or email"}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onClear={() => setQuery("")}
                  autoComplete="off"
                  className="py-2 sm:text-sm"
                />
              </div>
            </div>
          </div>

          {list.error ? <Callout tone="danger" role="alert">{list.error}</Callout> : null}

          {list.loading === "replace" ? (
            <p role="status" className="text-body-ui text-ink-muted">Loading guests…</p>
          ) : list.rows.length === 0 ? (
            <EmptyState>{view.query ? "No guests match that search." : "No guests in this view."}</EmptyState>
          ) : (
            <ul id={list.listId} aria-label="Guests" aria-busy={list.loading != null} className="flex flex-col gap-2">
              {list.rows.map((guest) => (
                <GuestRow key={guest.id} guest={guest} timeZone={timeZone} now={now} busy={pending && busyId === guest.id} disabled={pending} actions={actions} />
              ))}
            </ul>
          )}

          {list.rows.length > 0 && list.loading !== "replace" ? (
            <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-ink-secondary">
              <span aria-live="polite">{showingLabel(list.rows.length, Math.max(shownTotal, list.rows.length), shownTotal === 1 ? "guest" : "guests")}</span>
              {list.nextCursor ? (
                <Button size="sm" variant="secondary" loading={list.loading === "more"} loadingLabel="Loading…" onClick={() => void list.loadMore()}>
                  Load more guests
                </Button>
              ) : null}
            </div>
          ) : null}
        </>
      )}

      {manualRsvpOpen && eventId ? <ManualRsvpDialog organisationSlug={organisationSlug} eventId={eventId} fields={registrationFields} onClose={() => setManualRsvpOpen(false)} onAdded={() => router.refresh()} /> : null}

      {moveGuest && eventId ? (
        <MoveToTeamDialog
          organisationSlug={organisationSlug}
          eventId={eventId}
          person={{ rsvpId: moveGuest.id, name: guestDisplayName(moveGuest), teamId: moveGuest.team?.id ?? null }}
          onClose={() => setMoveGuest(null)}
          onMoved={() => router.refresh()}
        />
      ) : null}

      {editGuest ? (
        <EditRsvpDialog
          organisationSlug={organisationSlug}
          {...scope}
          attendee={editGuest}
          fields={registrationFields}
          onClose={() => setEditGuest(null)}
          onUpdated={() => router.refresh()}
        />
      ) : null}

      <ConfirmationDialog
        open={Boolean(undoGuest)}
        title="Undo check-in?"
        message={`Mark ${undoGuest ? guestDisplayName(undoGuest) : "this guest"} as not checked in?`}
        confirmLabel="Undo check-in"
        destructive={false}
        loading={pending}
        onCancel={() => setUndoGuest(null)}
        onConfirm={() => {
          if (!undoGuest || !eventId) return;
          const guest = undoGuest;
          setUndoGuest(null);
          run(guest, () => undoCheckIn({ organisationSlug, eventId, rsvpId: guest.id }), "Check-in undone");
        }}
      />

      <ConfirmationDialog
        open={Boolean(removeGuest)}
        title="Remove Attendee"
        message={`Are you sure you want to remove ${removeGuest?.user?.name ?? removeGuest?.guestName ?? removeGuest?.guestEmail ?? "this attendee"}'s RSVP registration?`}
        confirmLabel="Remove"
        loading={pending}
        onCancel={() => setRemoveGuest(null)}
        onConfirm={() => {
          if (!removeGuest) return;
          const guest = removeGuest;
          setRemoveGuest(null);
          startTransition(async () => {
            const res = await deleteRsvp({ organisationSlug, rsvpId: guest.id, ...scope });
            if (!res.ok) {
              showToast(res.error, "error");
              return;
            }
            showToast(
              "Attendee removed",
              "success",
              {
                label: "Undo",
                onClick: () => {
                  startTransition(async () => {
                    const restored = await restoreRsvp({ organisationSlug, undoId: res.data!.undoId });
                    if (restored.ok) {
                      showToast("Attendee restored", "success");
                      router.refresh();
                    } else {
                      showToast(restored.error, "error");
                    }
                  });
                },
              },
              10000,
            );
            router.refresh();
          });
        }}
      />
    </div>
  );
}
