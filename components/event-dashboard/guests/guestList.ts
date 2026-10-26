import type { RsvpStatus } from "@prisma/client";
import { formatDate, formatDayShort, formatRelativeTime, formatTime } from "@/lib/format/datetime";

/*
 * Pure helpers for the event dashboard's Guests · People list: status filters,
 * live counts, search, labels and relative "when" copy. No React, no I/O.
 */

export type GuestStatusFilter = "all" | "going" | "waitlist" | "approve" | "declined" | "checkedIn" | "notCheckedIn";
export type GuestKindFilter = "all" | "guests" | "users";
/** TEAM events only: registrations in a team, or on their own. */
export type GuestTeamFilter = "all" | "team" | "solo";

/** The minimum a row needs for filtering and labelling. */
export type GuestLike = {
  status: RsvpStatus;
  createdAt: string;
  checkedInAt: string | null;
  guestEmail: string | null;
  guestName?: string | null;
  user: { name: string | null; email: string | null } | null;
  /** TEAM events: the registration's team, null when solo. */
  team?: { name: string } | null;
};

export const GUEST_FILTERS: Array<{ value: GuestStatusFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "going", label: "Going" },
  { value: "waitlist", label: "Waitlist" },
  { value: "approve", label: "To approve" },
  { value: "declined", label: "Declined" },
  { value: "checkedIn", label: "Checked in" },
  { value: "notCheckedIn", label: "Not checked in" },
];

export const GUEST_STATUS_LABELS: Record<RsvpStatus, string> = {
  CONFIRMED: "Going",
  WAITLISTED: "Waitlist",
  PENDING_APPROVAL: "To approve",
  REJECTED: "Declined",
};

export function matchesGuestFilter(guest: GuestLike, filter: GuestStatusFilter) {
  switch (filter) {
    case "all":
      return true;
    case "going":
      return guest.status === "CONFIRMED";
    case "waitlist":
      return guest.status === "WAITLISTED";
    case "approve":
      return guest.status === "PENDING_APPROVAL";
    case "declined":
      return guest.status === "REJECTED";
    case "checkedIn":
      return guest.checkedInAt != null;
    case "notCheckedIn":
      return guest.status === "CONFIRMED" && guest.checkedInAt == null;
  }
}

export function countGuestFilters(guests: GuestLike[]): Record<GuestStatusFilter, number> {
  const counts = Object.fromEntries(GUEST_FILTERS.map(({ value }) => [value, 0])) as Record<GuestStatusFilter, number>;
  for (const guest of guests) {
    for (const { value } of GUEST_FILTERS) if (matchesGuestFilter(guest, value)) counts[value] += 1;
  }
  return counts;
}

export function guestEmail(guest: GuestLike) {
  return guest.user?.email ?? guest.guestEmail ?? null;
}

/** Signed-in user's name, else the guest name, else the email's local part. */
export function guestDisplayName(guest: GuestLike) {
  if (guest.user) return guest.user.name?.trim() || guest.user.email?.split("@")[0] || "Unnamed user";
  return guest.guestName?.trim() || (guest.guestEmail ? guest.guestEmail.split("@")[0]! : "") || "Guest";
}

export function matchesTeamFilter(guest: GuestLike, filter: GuestTeamFilter) {
  if (filter === "team") return guest.team != null;
  if (filter === "solo") return guest.team == null;
  return true;
}

/** Searches name and email, and the team name on TEAM events. */
export function filterGuests<T extends GuestLike>(guests: T[], options: { status?: GuestStatusFilter; kind?: GuestKindFilter; team?: GuestTeamFilter; query?: string }): T[] {
  const { status = "all", kind = "all", team = "all", query = "" } = options;
  const q = query.trim().toLowerCase();
  return guests.filter((guest) => {
    if (kind === "guests" && guest.user) return false;
    if (kind === "users" && !guest.user) return false;
    if (!matchesTeamFilter(guest, team)) return false;
    if (!matchesGuestFilter(guest, status)) return false;
    if (!q) return true;
    const name = (guest.user?.name ?? guest.guestName ?? "").toLowerCase();
    const email = (guestEmail(guest) ?? "").toLowerCase();
    const teamName = (guest.team?.name ?? "").toLowerCase();
    return name.includes(q) || email.includes(q) || teamName.includes(q);
  });
}

/** Team members change status only with their whole team, from the Teams view. */
export function isManagedByTeam(guest: GuestLike) {
  return guest.team != null;
}

const WHEN_VERB: Record<RsvpStatus, string> = {
  CONFIRMED: "registered",
  WAITLISTED: "joined waitlist",
  PENDING_APPROVAL: "asked",
  REJECTED: "asked",
};

/** "asked 2 hours ago", "registered yesterday", "joined waitlist on 13 Oct 2026". */
export function describeGuestWhen(guest: Pick<GuestLike, "status" | "createdAt">, timeZone: string, now: Date | string) {
  const relative = formatRelativeTime(guest.createdAt, timeZone, now);
  const verb = WHEN_VERB[guest.status];
  if (relative === formatDate(guest.createdAt, timeZone)) return `${verb} on ${relative}`;
  return `${verb} ${relative.charAt(0).toLowerCase()}${relative.slice(1)}`;
}

/** "Checked in 9:30 AM" (today) or "Checked in Wed 14 Oct"; "Not yet" for going guests; null otherwise. */
export function describeCheckIn(guest: Pick<GuestLike, "status" | "checkedInAt">, timeZone: string, now: Date | string) {
  if (guest.checkedInAt) {
    const sameDay = formatDayShort(guest.checkedInAt, timeZone, now) === formatDayShort(now, timeZone, now);
    return `Checked in ${sameDay ? formatTime(guest.checkedInAt, timeZone) : formatDayShort(guest.checkedInAt, timeZone, now)}`;
  }
  return guest.status === "CONFIRMED" ? "Not yet" : null;
}

/** "Showing 1–25 of 44" range for a zero-based page. */
export function pageRange(total: number, page: number, pageSize: number) {
  const lastPage = Math.max(0, Math.ceil(total / pageSize) - 1);
  const current = Math.min(Math.max(0, page), lastPage);
  const first = total === 0 ? 0 : current * pageSize + 1;
  const last = Math.min(total, (current + 1) * pageSize);
  return { first, last, page: current, lastPage };
}
