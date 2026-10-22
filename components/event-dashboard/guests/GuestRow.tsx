"use client";

import { useId, useState } from "react";
import { Check, ChevronDown, Copy, MoreHorizontal, Pencil, RotateCcw, Trash2, UserX } from "lucide-react";
import { Button, IconButton } from "@/components/ui/button";
import { Avatar, Chip, type ChipTone } from "@/components/ui/display";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import type { AttendeeRow } from "@/components/attendees/types";
import { cn } from "@/lib/cn";
import { formatTime } from "@/lib/format/datetime";
import { GUEST_STATUS_LABELS, describeCheckIn, describeGuestWhen, guestDisplayName, guestEmail } from "./guestList";

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
};

export function GuestRow({ guest, timeZone, now, busy, disabled, actions }: { guest: AttendeeRow; timeZone: string; now: string; busy: boolean; disabled: boolean; actions: GuestRowActions }) {
  const [answersOpen, setAnswersOpen] = useState(false);
  const answersId = useId();
  const name = guestDisplayName(guest);
  const email = guestEmail(guest);
  const when = describeGuestWhen(guest, timeZone, now);
  const checkIn = describeCheckIn(guest, timeZone, now);
  const answers = guest.answers ?? [];

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
        {guest.status === "PENDING_APPROVAL" ? (
          <>
            <Button size="sm" variant="secondary" disabled={disabled} loading={busy} onClick={() => actions.approve(guest)} aria-label={`Approve ${name}`}>
              Approve
            </Button>
            <Button size="sm" variant="dangerQuiet" disabled={disabled} onClick={() => actions.decline(guest)} aria-label={`Decline ${name}`}>
              Decline
            </Button>
          </>
        ) : null}
        {guest.status === "WAITLISTED" ? (
          <Button size="sm" variant="secondary" disabled={disabled} loading={busy} onClick={() => actions.promote(guest)} aria-label={`Give ${name} a spot`}>
            Give a spot
          </Button>
        ) : null}
        {guest.status === "REJECTED" ? (
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
            <MenuItem icon={<Pencil />} onSelect={() => actions.edit(guest)}>
              {guest.user ? "View registration" : "Edit registration or transfer ticket"}
            </MenuItem>
            {guest.checkedInAt && actions.undoCheckIn ? (
              <MenuItem icon={<RotateCcw />} onSelect={() => actions.undoCheckIn?.(guest)}>
                Undo check-in
              </MenuItem>
            ) : null}
            {guest.status === "WAITLISTED" ? (
              <MenuItem danger icon={<UserX />} onSelect={() => actions.decline(guest)}>
                Decline
              </MenuItem>
            ) : null}
            <MenuSeparator />
            <MenuItem danger icon={<Trash2 />} onSelect={() => actions.remove(guest)}>
              Remove RSVP
            </MenuItem>
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
