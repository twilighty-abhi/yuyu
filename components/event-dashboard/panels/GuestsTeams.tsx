"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowRightLeft, Crown, Download, MoreHorizontal, Pencil, Trash2, UserMinus, UserX } from "lucide-react";
import { approveTeam, deleteTeam, loadTeamsPage, promoteTeam, rejectTeam, renameTeamAsOrganiser } from "@/app/actions/team-admin";
import { deleteRsvp, restoreRsvp } from "@/app/actions/rsvp-admin";
import { ConfirmationDialog } from "@/components/feedback/ConfirmationDialog";
import { useToast } from "@/components/feedback/ToastProvider";
import { Button, IconButton } from "@/components/ui/button";
import { useLoadMoreFocus } from "@/components/ui/use-load-more-focus";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Avatar, Callout, Chip, EmptyState, type ChipTone } from "@/components/ui/display";
import { Field, Input, SearchInput } from "@/components/ui/field";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { cn } from "@/lib/cn";
import { teamExportSearchParams } from "@/lib/teamExport";
import { NO_SAVED_VIEWS, viewParam, type SavedViewDto, type ViewParams } from "@/lib/savedViews";
import { SavedViewsMenu } from "@/components/event-dashboard/views/SavedViewsMenu";
import { useInitialViewParams, useSyncViewToUrl } from "@/components/event-dashboard/views/useViewUrl";
import type { DashboardTeam, DashboardTeamsPage } from "@/lib/eventDashboard/teams";
import { GUEST_STATUS_LABELS } from "@/components/event-dashboard/guests/guestList";
import { MoveToTeamDialog } from "@/components/event-dashboard/guests/MoveToTeamDialog";
import {
  TEAM_FILTERS,
  teamCheckInLabel,
  teamSizeLabel,
  type TeamStatusFilter,
} from "@/components/event-dashboard/guests/teamList";

const CHIP_TONES: Record<DashboardTeam["status"], ChipTone> = {
  CONFIRMED: "success",
  WAITLISTED: "warning",
  PENDING_APPROVAL: "warning",
  REJECTED: "danger",
};

type Member = DashboardTeam["members"][number];
type Result = { ok: true } | { ok: false; error: string };

/**
 * Guests → Teams (docs/TEAMS.md). Teams are approved, declined and given a
 * place as one unit; members can be moved or removed one at a time. Every
 * action is re-checked on the server (organisation admin, team re-read with
 * its event, the event lock for capacity).
 *
 * The list is paged on the server: the first page comes with the panel, and
 * searches, status filters and "Load more" fetch bounded pages through
 * `loadTeamsPage`.
 */
const SEARCH_DELAY_MS = 300;

export function GuestsTeams({
  organisationSlug,
  eventId,
  initialPage,
  approvalRequired,
  savedViews = NO_SAVED_VIEWS,
}: {
  organisationSlug: string;
  eventId: string;
  initialPage: DashboardTeamsPage;
  approvalRequired: boolean;
  /** Saved views for this list (the viewer's own and shared ones). */
  savedViews?: readonly SavedViewDto[];
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  // Filters live in the address bar (saved views): a link reopens the same view.
  const fromUrl = useInitialViewParams("GUESTS_TEAMS");
  const [status, setStatus] = useState<TeamStatusFilter>(viewParam(fromUrl, "status") as TeamStatusFilter);
  const [query, setQuery] = useState(viewParam(fromUrl, "q"));
  const [searchedQuery, setSearchedQuery] = useState(query.trim());
  useEffect(() => {
    const timer = window.setTimeout(() => setSearchedQuery(query.trim()), SEARCH_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [query]);
  const viewParams: ViewParams = {};
  if (status !== "all") viewParams.status = status;
  if (searchedQuery) viewParams.q = searchedQuery;
  useSyncViewToUrl("GUESTS_TEAMS", viewParams);
  const applyView = useCallback((params: ViewParams) => {
    setStatus(viewParam(params, "status") as TeamStatusFilter);
    setQuery(viewParam(params, "q"));
  }, []);
  const [declining, setDeclining] = useState<DashboardTeam | null>(null);
  const [deleting, setDeleting] = useState<DashboardTeam | null>(null);
  const [renaming, setRenaming] = useState<DashboardTeam | null>(null);
  const [moving, setMoving] = useState<{ member: Member; team: DashboardTeam } | null>(null);
  const [removing, setRemoving] = useState<{ member: Member; team: DashboardTeam } | null>(null);

  const [teams, setTeams] = useState<DashboardTeam[]>(initialPage.teams);
  const { listId: teamListId, beforeLoadMore } = useLoadMoreFocus(teams.length);
  const [nextCursor, setNextCursor] = useState<string | null>(initialPage.nextCursor);
  // A view opened from the address bar isn't the server-rendered first page: it loads on mount.
  const [loadingList, setLoadingList] = useState<"replace" | "more" | null>(status === "all" && !query.trim() ? null : "replace");
  const [listError, setListError] = useState<string | null>(null);
  const requestSeq = useRef(0);
  const counts = initialPage.counts;
  const scope = { organisationSlug, eventId };

  // How many pages the current view holds, so a refresh after a change can
  // reload the same stretch instead of dropping pages added with "Load more".
  const pagesLoaded = useRef(1);

  const fetchPage = useCallback(
    async (view: { query: string; status: TeamStatusFilter }, cursor: string | null) => {
      const seq = ++requestSeq.current;
      setLoadingList(cursor ? "more" : "replace");
      setListError(null);
      const res = await loadTeamsPage({ organisationSlug, eventId, query: view.query.trim(), filter: view.status, cursor });
      if (seq !== requestSeq.current) return;
      setLoadingList(null);
      if (!res.ok || !res.data) {
        setListError(res.ok ? "Could not load teams." : res.error);
        return;
      }
      const page = res.data;
      setTeams((current) => (cursor ? [...current, ...page.teams.filter((team) => !current.some((other) => other.id === team.id))] : page.teams));
      setNextCursor(page.nextCursor);
      pagesLoaded.current = cursor ? pagesLoaded.current + 1 : 1;
    },
    [organisationSlug, eventId],
  );

  /** Re-read the first `pages` pages of a view in place (after a change). */
  const reloadPages = useCallback(
    async (view: { query: string; status: TeamStatusFilter }, pages: number) => {
      const seq = ++requestSeq.current;
      setListError(null);
      const collected: DashboardTeam[] = [];
      let cursor: string | null = null;
      let loaded = 0;
      do {
        const res = await loadTeamsPage({ organisationSlug, eventId, query: view.query.trim(), filter: view.status, cursor });
        if (seq !== requestSeq.current) return;
        if (!res.ok || !res.data) {
          setListError(res.ok ? "Could not load teams." : res.error);
          return;
        }
        for (const team of res.data.teams) if (!collected.some((other) => other.id === team.id)) collected.push(team);
        cursor = res.data.nextCursor;
        loaded += 1;
      } while (cursor && loaded < pages);
      setTeams(collected);
      setNextCursor(cursor);
      pagesLoaded.current = loaded;
    },
    [organisationSlug, eventId],
  );

  // A search or a filter fetches its first page (a search waits for typing
  // to pause; the unfiltered view uses the first page that came with the
  // panel). A refresh after a change (new `initialPage`) reloads as many
  // pages as were showing.
  const firstRun = useRef(true);
  const lastView = useRef({ query, status });
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      if (status === "all" && !query.trim()) return;
      const timer = window.setTimeout(() => void fetchPage({ query, status }, null), 0);
      return () => window.clearTimeout(timer);
    }
    const unfiltered = status === "all" && !query.trim();
    const viewChanged = lastView.current.query !== query || lastView.current.status !== status;
    lastView.current = { query, status };
    if (!viewChanged && pagesLoaded.current > 1) {
      void reloadPages({ query, status }, pagesLoaded.current);
      return;
    }
    const timer = window.setTimeout(() => {
      if (!unfiltered) {
        void fetchPage({ query, status }, null);
        return;
      }
      requestSeq.current += 1;
      pagesLoaded.current = 1;
      setLoadingList(null);
      setListError(null);
      setTeams(initialPage.teams);
      setNextCursor(initialPage.nextCursor);
    }, viewChanged && !unfiltered && query.trim() ? SEARCH_DELAY_MS : 0);
    return () => window.clearTimeout(timer);
  }, [query, status, fetchPage, reloadPages, initialPage]);

  function run(id: string, action: () => Promise<Result>, success: string) {
    setBusyId(id);
    startTransition(async () => {
      const res = await action();
      setBusyId(null);
      if (!res.ok) {
        showToast(res.error, "error");
        return;
      }
      showToast(success, "success");
      router.refresh();
    });
  }

  function withUndo(id: string, action: () => Promise<{ ok: true; data?: { undoId: string } } | { ok: false; error: string }>, success: string, restored: string) {
    setBusyId(id);
    startTransition(async () => {
      const res = await action();
      setBusyId(null);
      if (!res.ok) {
        showToast(res.error, "error");
        return;
      }
      const undoId = res.data?.undoId;
      showToast(
        success,
        "success",
        undoId
          ? {
              label: "Undo",
              onClick: () => {
                startTransition(async () => {
                  const back = await restoreRsvp({ organisationSlug, undoId });
                  if (back.ok) {
                    showToast(restored, "success");
                    router.refresh();
                  } else {
                    showToast(back.error, "error");
                  }
                });
              },
            }
          : undefined,
        10000,
      );
      router.refresh();
    });
  }

  // The CSV holds every team matching the chip and search showing, read on the server.
  const exportQuery = teamExportSearchParams({ status, query });
  const exportHref = `/api/exports/events/${eventId}/teams${exportQuery ? `?${exportQuery}` : ""}`;

  if (counts.all === 0 && teams.length === 0) {
    return (
      <EmptyState mood="sleepy" title="No teams yet.">
        Teams appear here when someone signs up and creates one.
      </EmptyState>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-h4 text-ink">Teams</h2>
          <p className="text-caption text-ink-muted">Each team counts as one place.{approvalRequired ? " Approve or decline a whole team at once." : null}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <SavedViewsMenu surface="GUESTS_TEAMS" scope={scope} params={viewParams} onApply={applyView} initialViews={savedViews} />
          {counts[status] > 0 ? (
            <Button asChild variant="secondary" startIcon={<Download />}>
              <a href={exportHref} title="Export every team matching this filter and search">Export CSV</a>
            </Button>
          ) : (
            <Button variant="secondary" startIcon={<Download />} disabled title="No teams match this filter">
              Export CSV
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2.5">
        <div role="group" aria-label="Filter teams by status" className="flex flex-wrap gap-1.5">
          {TEAM_FILTERS.map(({ value, label }) => {
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
                {label}
                <span className="opacity-75">{counts[value]}</span>
              </button>
            );
          })}
        </div>
        <div className="w-full min-w-0 sm:ml-auto sm:w-[260px]">
          <label htmlFor="team-search" className="sr-only">Search teams by name or member</label>
          <SearchInput
            id="team-search"
            placeholder="Search team or member"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onClear={() => setQuery("")}
            autoComplete="off"
            className="py-2 sm:text-sm"
          />
        </div>
      </div>

      {listError ? <Callout tone="danger" role="alert">{listError}</Callout> : null}

      {loadingList === "replace" ? (
        <p role="status" className="text-body-ui text-ink-muted">Loading teams…</p>
      ) : teams.length === 0 ? (
        <EmptyState>{query.trim() ? "No teams match that search." : "No teams in this view."}</EmptyState>
      ) : (
        <ul id={teamListId} aria-label="Teams" aria-busy={loadingList != null} className="flex flex-col gap-2.5">
          {teams.map((team) => {
            const busy = pending && busyId === team.id;
            const checkIn = teamCheckInLabel(team);
            return (
              <li key={team.id} className="flex min-w-0 flex-col gap-3 rounded-xl border border-line bg-canvas px-4 py-3.5">
                <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
                  <div className="flex min-w-0 flex-[1_1_220px] flex-col">
                    <span className="truncate font-bold text-ink">{team.name}</span>
                    <span className="truncate text-caption text-ink-muted">
                      {teamSizeLabel(team)}
                      {checkIn ? ` · ${checkIn}` : ""}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Chip size="sm" tone={CHIP_TONES[team.status]}>{GUEST_STATUS_LABELS[team.status]}</Chip>
                    {team.incomplete ? <Chip size="sm" tone="outline">Incomplete</Chip> : null}
                    {team.lookingForMembers ? <Chip size="sm" tone="accent">Looking for members</Chip> : null}
                  </div>
                  <div className="ml-auto flex flex-wrap items-center justify-end gap-1.5">
                    {team.status === "PENDING_APPROVAL" ? (
                      <>
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={pending}
                          loading={busy}
                          // Incomplete teams keep a focusable, aria-disabled button so keyboard
                          // and screen-reader users reach the reason it is unavailable.
                          aria-disabled={team.incomplete || undefined}
                          aria-describedby={team.incomplete ? `team-approve-reason-${team.id}` : undefined}
                          onClick={() => {
                            if (team.incomplete) return;
                            run(team.id, () => approveTeam({ ...scope, teamId: team.id }), `${team.name} approved`);
                          }}
                          aria-label={`Approve team ${team.name}`}
                        >
                          Approve
                        </Button>
                        <Button size="sm" variant="dangerQuiet" disabled={pending} onClick={() => setDeclining(team)} aria-label={`Decline team ${team.name}`}>
                          Decline
                        </Button>
                      </>
                    ) : null}
                    {team.status === "WAITLISTED" ? (
                      <Button size="sm" variant="secondary" disabled={pending} loading={busy} onClick={() => run(team.id, () => promoteTeam({ ...scope, teamId: team.id }), `${team.name} has a place`)} aria-label={`Give team ${team.name} a place`}>
                        Give a place
                      </Button>
                    ) : null}
                    <Menu>
                      <MenuTrigger asChild>
                        <IconButton size="sm" variant="secondary" label={`More actions for team ${team.name}`} disabled={pending}>
                          <MoreHorizontal />
                        </IconButton>
                      </MenuTrigger>
                      <MenuContent>
                        <MenuItem icon={<Pencil />} onSelect={() => setRenaming(team)}>
                          Rename team
                        </MenuItem>
                        {team.status === "WAITLISTED" ? (
                          <MenuItem danger icon={<UserX />} onSelect={() => setDeclining(team)}>
                            Decline team
                          </MenuItem>
                        ) : null}
                        <MenuSeparator />
                        <MenuItem danger icon={<Trash2 />} onSelect={() => setDeleting(team)}>
                          Delete team
                        </MenuItem>
                      </MenuContent>
                    </Menu>
                  </div>
                </div>
                {team.incomplete && team.status === "PENDING_APPROVAL" ? (
                  <p id={`team-approve-reason-${team.id}`} className="text-caption text-ink-muted">
                    Can&apos;t be approved yet: this team needs at least {team.minSize} people.
                  </p>
                ) : null}
                <ul aria-label={`Members of ${team.name}`} className="flex flex-col divide-y divide-line rounded-lg bg-subtle">
                  {team.members.map((member) => (
                    <li key={member.rsvpId} className="flex min-w-0 items-center gap-3 px-3 py-2">
                      <Avatar name={member.name} size="sm" tone={member.checkedIn ? "success" : "neutral"} />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="flex min-w-0 items-center gap-1.5 text-sm font-semibold text-ink">
                          <span className="truncate">{member.name}</span>
                          {member.isLeader ? (
                            <span className="inline-flex shrink-0 items-center gap-1 text-caption font-semibold text-ink-secondary">
                              <Crown aria-hidden className="size-3.5" />
                              Leader
                            </span>
                          ) : null}
                        </span>
                        <span className="truncate text-caption text-ink-muted">
                          {member.email ?? ""}
                          {member.checkedIn ? `${member.email ? " · " : ""}Checked in` : ""}
                        </span>
                      </span>
                      <Menu>
                        <MenuTrigger asChild>
                          <IconButton size="sm" variant="quiet" label={`Actions for ${member.name}`} disabled={pending}>
                            <MoreHorizontal />
                          </IconButton>
                        </MenuTrigger>
                        <MenuContent>
                          <MenuItem icon={<ArrowRightLeft />} onSelect={() => setMoving({ member, team })}>
                            Move to another team
                          </MenuItem>
                          <MenuSeparator />
                          <MenuItem danger icon={<UserMinus />} onSelect={() => setRemoving({ member, team })}>
                            Remove from event
                          </MenuItem>
                        </MenuContent>
                      </Menu>
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ul>
      )}

      {nextCursor && loadingList !== "replace" ? (
        <div className="flex justify-center">
          <Button variant="secondary" loading={loadingList === "more"} loadingLabel="Loading…" onClick={() => {
              beforeLoadMore();
              void fetchPage({ query, status }, nextCursor);
            }}>
            Load more teams
          </Button>
        </div>
      ) : null}

      <ConfirmationDialog
        open={declining != null}
        title="Decline this team?"
        message={`Everyone in ${declining?.name ?? "this team"} will be told they don't have a place.`}
        confirmLabel="Decline team"
        loading={pending}
        onCancel={() => setDeclining(null)}
        onConfirm={() => {
          if (!declining) return;
          const team = declining;
          setDeclining(null);
          run(team.id, () => rejectTeam({ ...scope, teamId: team.id }), `${team.name} declined`);
        }}
      />

      <ConfirmationDialog
        open={deleting != null}
        title="Delete this team?"
        message={`${deleting?.name ?? "This team"} and its ${deleting?.size === 1 ? "member's registration" : `${deleting?.size ?? 0} members' registrations`} will be removed. You can undo this for a few minutes.`}
        confirmLabel="Delete team"
        loading={pending}
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          if (!deleting) return;
          const team = deleting;
          setDeleting(null);
          withUndo(team.id, () => deleteTeam({ ...scope, teamId: team.id }), `${team.name} deleted`, `${team.name} restored`);
        }}
      />

      <ConfirmationDialog
        open={removing != null}
        title="Remove from the event?"
        message={
          removing
            ? `${removing.member.name}'s registration will be removed from ${removing.team.name}.${
              removing.team.size <= 1
                ? " They're its only member, so the team is removed too; undo brings both back."
                : removing.member.isLeader
                  ? " Leadership passes to the longest-standing member."
                  : ""
            } You can undo this for a few minutes.`
            : ""
        }
        confirmLabel="Remove"
        loading={pending}
        onCancel={() => setRemoving(null)}
        onConfirm={() => {
          if (!removing) return;
          const { member, team } = removing;
          setRemoving(null);
          withUndo(team.id, () => deleteRsvp({ ...scope, rsvpId: member.rsvpId }), `${member.name} removed`, `${member.name} restored`);
        }}
      />

      {renaming ? (
        <RenameTeamDialog
          team={renaming}
          onClose={() => setRenaming(null)}
          onRename={async (name) => {
            const res = await renameTeamAsOrganiser({ ...scope, teamId: renaming.id, name });
            if (res.ok) {
              showToast("Team renamed", "success");
              router.refresh();
            }
            return res;
          }}
        />
      ) : null}

      {moving ? (
        <MoveToTeamDialog
          organisationSlug={organisationSlug}
          eventId={eventId}
          person={{ rsvpId: moving.member.rsvpId, name: moving.member.name, teamId: moving.team.id }}
          onClose={() => setMoving(null)}
          onMoved={() => router.refresh()}
        />
      ) : null}
    </div>
  );
}

function RenameTeamDialog({ team, onClose, onRename }: { team: DashboardTeam; onClose: () => void; onRename: (name: string) => Promise<Result> }) {
  const [name, setName] = useState(team.name);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <Dialog open onOpenChange={(next) => { if (!next && !pending) onClose(); }}>
      <DialogContent size="sm">
        <form
          className="flex min-h-0 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            setError(null);
            startTransition(async () => {
              const res = await onRename(name);
              if (!res.ok) {
                setError(res.error);
                return;
              }
              onClose();
            });
          }}
        >
          <DialogHeader title="Rename team" description="Team names are unique within this event." />
          <DialogBody className="flex flex-col gap-4">
            {error ? <Callout tone="danger" role="alert">{error}</Callout> : null}
            <Field label="Team name" required>
              <Input value={name} maxLength={60} onChange={(event) => setName(event.target.value)} autoFocus />
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button variant="secondary" onClick={onClose} disabled={pending}>Cancel</Button>
            <Button type="submit" variant="primary" loading={pending} disabled={!name.trim() || name.trim() === team.name}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
