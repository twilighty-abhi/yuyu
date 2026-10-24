"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Download, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Callout, EmptyState } from "@/components/ui/display";
import { Dropdown, SearchInput } from "@/components/ui/field";
import { cn } from "@/lib/cn";
import type { AttendeeRow } from "@/components/attendees/types";
import { ManualRsvpDialog } from "@/components/attendees/ManualRsvpDialog";
import { EditRsvpDialog } from "@/components/attendees/EditRsvpDialog";
import { ExportEmailsButton } from "@/components/attendees/ExportEmailsButton";
import type { RegistrationFieldRow } from "@/components/registration/EventRegistrationFormEditor";
import { ConfirmationDialog } from "@/components/feedback/ConfirmationDialog";
import { useToast } from "@/components/feedback/ToastProvider";
import { deleteRsvp, restoreRsvp } from "@/app/actions/rsvp-admin";
import { approveRsvp, promoteFromWaitlist, reacceptRsvp, rejectRsvp } from "@/app/actions/rsvp-lifecycle";
import { undoCheckIn } from "@/app/actions/checkin";
import { GuestRow, type GuestRowActions } from "@/components/event-dashboard/guests/GuestRow";
import { useEventTabs } from "@/components/event-dashboard/EventDashboardTabs";
import { MoveToTeamDialog, type MoveTargetTeam } from "@/components/event-dashboard/guests/MoveToTeamDialog";
import {
  GUEST_FILTERS,
  countGuestFilters,
  filterGuests,
  guestDisplayName,
  pageRange,
  type GuestKindFilter,
  type GuestStatusFilter,
  type GuestTeamFilter,
} from "@/components/event-dashboard/guests/guestList";

const PAGE_SIZE = 25;

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
  attendees,
  truncated,
  registrationFields,
  teamMode = false,
  teams = [],
  canUndoCheckIn = true,
}: {
  organisationSlug: string;
  target: GuestListTarget;
  title?: string;
  timeZone: string;
  /** Server render time (ISO) so relative labels match between server and client. */
  now: string;
  attendees: AttendeeRow[];
  truncated: boolean;
  registrationFields: RegistrationFieldRow[];
  /** TEAM event: show each guest's team, the In a team / Solo filter, and route status changes to Teams. */
  teamMode?: boolean;
  /** TEAM event: teams a solo registrant can be moved into. */
  teams?: MoveTargetTeam[];
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
  const [page, setPage] = useState(0);
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editGuest, setEditGuest] = useState<AttendeeRow | null>(null);
  const [removeGuest, setRemoveGuest] = useState<AttendeeRow | null>(null);
  const [undoGuest, setUndoGuest] = useState<AttendeeRow | null>(null);
  const [moveGuest, setMoveGuest] = useState<AttendeeRow | null>(null);

  const eventId = target.kind === "event" ? target.eventId : undefined;
  const scope = target.kind === "event" ? { eventId: target.eventId } : { eventInstanceId: target.instanceId };

  const counts = useMemo(() => countGuestFilters(attendees), [attendees]);
  const visible = useMemo(() => filterGuests(attendees, { status, kind, team: teamMode ? team : "all", query }), [attendees, status, kind, team, teamMode, query]);
  const range = pageRange(visible.length, page, PAGE_SIZE);
  const pageRows = visible.slice(range.page * PAGE_SIZE, range.page * PAGE_SIZE + PAGE_SIZE);

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
    moveToTeam: teamMode && target.kind === "event" && teams.length > 0 ? (guest) => setMoveGuest(guest) : undefined,
  };

  function resetPage<T>(setter: (value: T) => void) {
    return (value: T) => {
      setter(value);
      setPage(0);
    };
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {truncated ? (
        <Callout tone="warning">
          {target.kind === "event"
            ? "Only the 250 most recent registrations are loaded in this browser view, and its email export is limited to those records. Download the full attendee CSV for the complete list."
            : "Only the 250 most recent registrations are loaded in this browser view."}
        </Callout>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-h4 text-ink">{title}</h2>
        {target.kind === "event" ? (
          <div className="flex flex-wrap gap-2">
            <ExportEmailsButton size="md" eventTitle={target.eventTitle} attendees={visible} title="Export emails for the guests shown" />
            <Button asChild variant="secondary" startIcon={<Download />}>
              <a href={`/api/exports/events/${target.eventId}/attendees`}>Download CSV</a>
            </Button>
            <Button variant="primary" startIcon={<Plus />} onClick={() => setManualRsvpOpen(true)}>
              Add guest
            </Button>
          </div>
        ) : null}
      </div>

      {attendees.length === 0 ? (
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
                    onClick={() => resetPage(setStatus)(value)}
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
                <Dropdown id="guest-kind" value={kind} onChange={(event) => resetPage(setKind)(event.target.value as GuestKindFilter)} className="py-2 sm:text-sm">
                  <option value="all">Everyone</option>
                  <option value="guests">Guests only</option>
                  <option value="users">Signed-in users</option>
                </Dropdown>
              </div>
              {teamMode ? (
                <div className="min-w-0 flex-1 sm:w-[140px] sm:flex-none">
                  <label htmlFor="guest-team" className="sr-only">Team</label>
                  <Dropdown id="guest-team" value={team} onChange={(event) => resetPage(setTeam)(event.target.value as GuestTeamFilter)} className="py-2 sm:text-sm">
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
                  onChange={(event) => resetPage(setQuery)(event.target.value)}
                  onClear={() => resetPage(setQuery)("")}
                  autoComplete="off"
                  className="py-2 sm:text-sm"
                />
              </div>
            </div>
          </div>

          {visible.length === 0 ? (
            <EmptyState>{query.trim() ? "No guests match that search." : "No guests in this view."}</EmptyState>
          ) : (
            <ul aria-label="Guests" className="flex flex-col gap-2">
              {pageRows.map((guest) => (
                <GuestRow key={guest.id} guest={guest} timeZone={timeZone} now={now} busy={pending && busyId === guest.id} disabled={pending} actions={actions} />
              ))}
            </ul>
          )}

          {visible.length > 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-ink-secondary">
              <span aria-live="polite">
                Showing {range.first}–{range.last} of {visible.length}
              </span>
              {range.lastPage > 0 ? (
                <div className="flex gap-1.5">
                  <Button size="sm" variant="secondary" disabled={range.page === 0} onClick={() => setPage(range.page - 1)}>
                    Previous
                  </Button>
                  <Button size="sm" variant="secondary" disabled={range.page >= range.lastPage} onClick={() => setPage(range.page + 1)}>
                    Next
                  </Button>
                </div>
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
          teams={teams}
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
