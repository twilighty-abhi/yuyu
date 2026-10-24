"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowRightLeft, Crown, MoreHorizontal, Pencil, Trash2, UserMinus, UserX } from "lucide-react";
import { approveTeam, deleteTeam, promoteTeam, rejectTeam, renameTeamAsOrganiser } from "@/app/actions/team-admin";
import { deleteRsvp, restoreRsvp } from "@/app/actions/rsvp-admin";
import { ConfirmationDialog } from "@/components/feedback/ConfirmationDialog";
import { useToast } from "@/components/feedback/ToastProvider";
import { Button, IconButton } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Avatar, Callout, Chip, EmptyState, type ChipTone } from "@/components/ui/display";
import { Field, Input, SearchInput } from "@/components/ui/field";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { cn } from "@/lib/cn";
import type { DashboardTeam } from "@/lib/eventDashboard/teams";
import { GUEST_STATUS_LABELS } from "@/components/event-dashboard/guests/guestList";
import { MoveToTeamDialog } from "@/components/event-dashboard/guests/MoveToTeamDialog";
import {
  TEAM_FILTERS,
  countTeamFilters,
  filterTeams,
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
 */
export function GuestsTeams({
  organisationSlug,
  eventId,
  teams,
  approvalRequired,
}: {
  organisationSlug: string;
  eventId: string;
  teams: DashboardTeam[];
  approvalRequired: boolean;
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [status, setStatus] = useState<TeamStatusFilter>("all");
  const [query, setQuery] = useState("");
  const [declining, setDeclining] = useState<DashboardTeam | null>(null);
  const [deleting, setDeleting] = useState<DashboardTeam | null>(null);
  const [renaming, setRenaming] = useState<DashboardTeam | null>(null);
  const [moving, setMoving] = useState<{ member: Member; team: DashboardTeam } | null>(null);
  const [removing, setRemoving] = useState<{ member: Member; team: DashboardTeam } | null>(null);

  const counts = useMemo(() => countTeamFilters(teams), [teams]);
  const visible = useMemo(() => filterTeams(teams, { status, query }), [teams, status, query]);
  const scope = { organisationSlug, eventId };

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

  if (teams.length === 0) {
    return (
      <EmptyState mood="sleepy" title="No teams yet.">
        Teams appear here when someone signs up and creates one.
      </EmptyState>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-h4 text-ink">Teams</h2>
        <p className="text-caption text-ink-muted">Each team counts as one place.{approvalRequired ? " Approve or decline a whole team at once." : null}</p>
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

      {visible.length === 0 ? (
        <EmptyState>{query.trim() ? "No teams match that search." : "No teams in this view."}</EmptyState>
      ) : (
        <ul aria-label="Teams" className="flex flex-col gap-2.5">
          {visible.map((team) => {
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
                          disabled={pending || team.incomplete}
                          loading={busy}
                          title={team.incomplete ? "This team is below the minimum size, so it can't be approved yet." : undefined}
                          onClick={() => run(team.id, () => approveTeam({ ...scope, teamId: team.id }), `${team.name} approved`)}
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
                  <p className="text-caption text-ink-muted">Needs at least {team.minSize} people before it can be approved.</p>
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
          teams={teams}
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
