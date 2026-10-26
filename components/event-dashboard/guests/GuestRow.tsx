"use client";

import { useId, useState } from "react";
import { ArrowRightLeft, BadgeCheck, Check, ChevronDown, Copy, MoreHorizontal, Pencil, RotateCcw, Trash2, Users, UserX } from "lucide-react";
import { Button, IconButton } from "@/components/ui/button";
import { Avatar, Chip, type ChipTone } from "@/components/ui/display";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import type { AttendeeRow } from "@/components/attendees/types";
import { cn } from "@/lib/cn";
import { formatTime } from "@/lib/format/datetime";
import { ATTENDANCE_STATE_LABELS, type AttendanceState } from "@/lib/attendanceCheck";
import { GUEST_STATUS_LABELS, describeCheckIn, describeGuestWhen, guestDisplayName, guestEmail, isManagedByTeam } from "./guestList";

const CHIP_TONES: Record<AttendeeRow["status"], ChipTone> = {
  CONFIRMED: "success",
  WAITLISTED: "warning",
  PENDING_APPROVAL: "warning",
  REJECTED: "danger",
};

const AVATAR_TONES: Record<AttendeeRow["status"], "success" | "warning" | "neutral"> = {
  CONFIRMED: "success",
  WAITLISTED: "neutral",
  PENDING_APPROVAL: "warning",
  REJECTED: "neutral",
};

const ATTENDANCE_TONES: Record<AttendanceState, ChipTone> = {
  coming: "success",
  notComing: "danger",
  noReply: "warning",
  notAsked: "outline",
};

export type GuestRowActions = {
  approve: (guest: AttendeeRow) => void;
  decline: (guest: AttendeeRow) => void;
  promote: (guest: AttendeeRow) => void;
  /** Reverses a decline: confirmed when there is room, otherwise waitlisted. */
  reaccept: (guest: AttendeeRow) => void;
  copyTicket: (guest: AttendeeRow) => void;
  edit: (guest: AttendeeRow) => void;
  /** Omitted where no undo-check-in action exists for the target (series dates). */
  undoCheckIn?: (guest: AttendeeRow) => void;
  remove: (guest: AttendeeRow) => void;
  /** TEAM events: opens Guests → Teams, where a member's team is approved or declined as a whole. */
  openTeams?: () => void;
  /** TEAM events: move this registration into a team (solo) or another team. */
  moveToTeam?: (guest: AttendeeRow) => void;
};

/** `isCrew` comes with dashboard rows (lib/eventDashboard/attendees.ts); other lists omit it. */
type GuestRowGuest = AttendeeRow & { isCrew?: boolean };

export function GuestRow({ guest, timeZone, now, busy, disabled, actions }: { guest: GuestRowGuest; timeZone: string; now: string; busy: boolean; disabled: boolean; actions: GuestRowActions }) {
  const [answersOpen, setAnswersOpen] = useState(false);
  const answersId = useId();
  const name = guestDisplayName(guest);
  const email = guestEmail(guest);
  const when = describeGuestWhen(guest, timeZone, now);
  const checkIn = describeCheckIn(guest, timeZone, now);
  const answers = guest.answers ?? [];
  // Team members are approved, declined and promoted only with their whole team.
  const teamManaged = isManagedByTeam(guest);
  // Crew tickets are edited and removed only in Guests → Crew (the server refuses it here too).
  const crew = guest.isCrew === true;
  const attendanceState = guest.attendance?.state ?? null;
  const attendanceNote = guest.attendance?.note ?? null;

  return (
    <li className="flex min-w-0 flex-wrap items-center gap-x-3.5 gap-y-2.5 rounded-xl border border-line bg-canvas px-4 py-3">
      <Avatar name={name} size="md" tone={guest.checkedInAt ? "success" : AVATAR_TONES[guest.status]} />
      <div className="flex min-w-0 flex-[1_1_200px] flex-col">
        <span className="truncate font-bold text-ink">{name}</span>
        <span className="truncate text-caption text-ink-muted">
          {email ? `${email} · ` : ""}
          {when}
        </span>
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
        <Chip size="sm" tone={CHIP_TONES[guest.status]}>{GUEST_STATUS_LABELS[guest.status]}</Chip>
        {crew ? (
          <Chip size="sm" tone="accent" icon={<BadgeCheck />}>
            Crew
          </Chip>
        ) : null}
        {attendanceState ? (
          <Chip size="sm" tone={ATTENDANCE_TONES[attendanceState]}>
            <span className="sr-only">Attendance confirmation: </span>
            {ATTENDANCE_STATE_LABELS[attendanceState]}
          </Chip>
        ) : null}
        {guest.team ? (
          <Chip size="sm" tone="neutral" icon={<Users />} className="max-w-[200px]">
            <span className="sr-only">Team: </span>
            {guest.team.name}
            {guest.team.isLeader ? " · leader" : ""}
          </Chip>
        ) : null}
        <span className={cn("text-caption sm:w-[150px]", guest.checkedInAt ? "font-semibold text-success-fg" : "text-ink-muted")}>
          {checkIn ?? <span aria-label="Not applicable">—</span>}
        </span>
      </div>
      <div className="ml-auto flex flex-wrap items-center justify-end gap-1.5">
        {answers.length > 0 ? (
          <Button
            size="sm"
            variant="quiet"
            aria-expanded={answersOpen}
            aria-controls={answersId}
            onClick={() => setAnswersOpen((open) => !open)}
            endIcon={<ChevronDown className={cn("transition-transform", answersOpen && "rotate-180")} />}
          >
            Answers <span className="text-ink-muted">{answers.length}</span>
          </Button>
        ) : null}
        {teamManaged && (guest.status === "PENDING_APPROVAL" || guest.status === "WAITLISTED") ? (
          actions.openTeams ? (
            <Button size="sm" variant="quiet" disabled={disabled} onClick={actions.openTeams} aria-label={`Manage ${name}'s team in Teams`}>
              Manage in Teams
            </Button>
          ) : (
            <span className="text-caption text-ink-muted">Managed with their team</span>
          )
        ) : null}
        {!teamManaged && guest.status === "PENDING_APPROVAL" ? (
          <>
            <Button size="sm" variant="secondary" disabled={disabled} loading={busy} onClick={() => actions.approve(guest)} aria-label={`Approve ${name}`}>
              Approve
            </Button>
            <Button size="sm" variant="dangerQuiet" disabled={disabled} onClick={() => actions.decline(guest)} aria-label={`Decline ${name}`}>
              Decline
            </Button>
          </>
        ) : null}
        {!teamManaged && guest.status === "WAITLISTED" ? (
          <Button size="sm" variant="secondary" disabled={disabled} loading={busy} onClick={() => actions.promote(guest)} aria-label={`Give ${name} a spot`}>
            Give a spot
          </Button>
        ) : null}
        {!teamManaged && guest.status === "REJECTED" ? (
          <Button size="sm" variant="secondary" disabled={disabled} loading={busy} onClick={() => actions.reaccept(guest)} aria-label={`Re-accept ${name}`}>
            Re-accept
          </Button>
        ) : null}
        <Menu>
          <MenuTrigger asChild>
            <IconButton size="sm" variant="secondary" label={`More actions for ${name}`} disabled={disabled}>
              <MoreHorizontal />
            </IconButton>
          </MenuTrigger>
          <MenuContent>
            <MenuItem icon={<Copy />} onSelect={() => actions.copyTicket(guest)}>
              Copy ticket link
            </MenuItem>
            {!crew ? (
              <MenuItem icon={<Pencil />} onSelect={() => actions.edit(guest)}>
                {guest.user ? "View registration" : "Edit registration or transfer ticket"}
              </MenuItem>
            ) : null}
            {actions.moveToTeam && !crew ? (
              <MenuItem icon={<ArrowRightLeft />} onSelect={() => actions.moveToTeam?.(guest)}>
                {guest.team ? "Move to another team" : "Add to a team"}
              </MenuItem>
            ) : null}
            {guest.checkedInAt && actions.undoCheckIn ? (
              <MenuItem icon={<RotateCcw />} onSelect={() => actions.undoCheckIn?.(guest)}>
                Undo check-in
              </MenuItem>
            ) : null}
            {!teamManaged && guest.status === "WAITLISTED" ? (
              <MenuItem danger icon={<UserX />} onSelect={() => actions.decline(guest)}>
                Decline
              </MenuItem>
            ) : null}
            {!crew ? (
              <>
                <MenuSeparator />
                <MenuItem danger icon={<Trash2 />} onSelect={() => actions.remove(guest)}>
                  Remove RSVP
                </MenuItem>
              </>
            ) : null}
          </MenuContent>
        </Menu>
      </div>
      {guest.listCheckIns && guest.listCheckIns.length > 0 ? (
        <ul aria-label={`Check-in lists for ${name}`} className="flex basis-full flex-wrap gap-1.5">
          {guest.listCheckIns.map((entry) => (
            <li key={entry.listName}>
              <Chip size="sm" tone="success" icon={<Check />}>
                {entry.listName} · {formatTime(entry.checkedInAt, timeZone)}
              </Chip>
            </li>
          ))}
        </ul>
      ) : null}
      {attendanceNote ? (
        <p className="basis-full whitespace-pre-wrap break-words text-caption text-ink-secondary">
          <span className="font-semibold text-ink">Attendance note: </span>
          {attendanceNote}
        </p>
      ) : null}
      {answers.length > 0 ? (
        <div id={answersId} hidden={!answersOpen} className="basis-full">
          <dl className="grid gap-3 rounded-lg bg-subtle px-4 py-3 sm:grid-cols-2">
            {answers.map((answer) => (
              <div key={answer.label} className="min-w-0">
                <dt className="text-caption text-ink-muted">{answer.label}</dt>
                <dd className="whitespace-pre-wrap break-words text-body-ui text-ink">{answer.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}
    </li>
  );
}
