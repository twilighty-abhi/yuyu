import type { EventPermission } from "@prisma/client";

/* Pure helpers for the event dashboard Settings tab (unit tested). */

/** Canonical order, short chip label and a longer description for each co-organiser permission. */
export const PERMISSION_OPTIONS: ReadonlyArray<{ value: EventPermission; label: string; description: string }> = [
  { value: "EDIT_DETAILS", label: "Edit details", description: "Edit event details" },
  { value: "MANAGE_REGISTRATIONS", label: "Registrations", description: "Manage registrations" },
  { value: "MANAGE_INVITATIONS", label: "Attendee invites", description: "Manage attendee invites" },
  { value: "CHECK_IN", label: "Check-in", description: "Operate check-in" },
  { value: "PUBLISH_AND_SCHEDULE", label: "Publish and schedule", description: "Publish and manage schedule" },
  { value: "JUDGE", label: "Judge", description: "Score hackathon submissions (judging workspace only)" },
];

/** Chip labels in canonical order; duplicates and unknown values are dropped. */
export function permissionChipLabels(permissions: readonly string[]) {
  const granted = new Set(permissions);
  return PERMISSION_OPTIONS.filter((option) => granted.has(option.value)).map((option) => option.label);
}

/** Adds or removes one permission, keeping the canonical order. */
export function togglePermission(selected: readonly EventPermission[], permission: EventPermission): EventPermission[] {
  const next = new Set(selected);
  if (next.has(permission)) next.delete(permission);
  else next.add(permission);
  return PERMISSION_OPTIONS.map((option) => option.value).filter((value) => next.has(value));
}

const DAY = 86_400_000;

/** "Invite expires today" / "Invite expires tomorrow" / "Invite expires in 6 days". */
export function inviteExpiryLabel(expiresAt: Date | string, now: Date | string = new Date()) {
  const remaining = new Date(expiresAt).getTime() - new Date(now).getTime();
  if (!Number.isFinite(remaining) || remaining <= 0) return "Invite expired";
  const days = Math.floor(remaining / DAY);
  if (days === 0) return "Invite expires today";
  if (days === 1) return "Invite expires tomorrow";
  return `Invite expires in ${days} days`;
}
