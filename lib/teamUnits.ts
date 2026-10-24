import "server-only";

import { EventPrivacyType, Prisma, RegistrationMode, RsvpStatus, TeamJoinRequestStatus } from "@prisma/client";
import { enqueueRsvpStatusNotification, enqueueTeamCreated } from "@/lib/outbox";
import { generateTeamManageToken } from "@/lib/teamToken";
import { emitWebhookEvent, type RsvpWebhookSnapshot, type WebhookEmission } from "@/lib/webhooks/emit";

/**
 * Registration-unit helpers for TEAM events (docs/TEAMS.md). Every function
 * here takes a transaction client and assumes the caller already holds the
 * Event row lock (`SELECT ... FOR UPDATE`), so unit counts cannot race.
 */

/** Confirmed units: confirmed teams plus confirmed solo RSVPs (no team). */
export async function countConfirmedUnits(tx: Prisma.TransactionClient, eventId: string): Promise<number> {
  const teams = await tx.team.count({ where: { eventId, status: RsvpStatus.CONFIRMED } });
  const solo = await tx.rSVP.count({ where: { eventId, teamId: null, status: RsvpStatus.CONFIRMED } });
  return teams + solo;
}

/**
 * The number compared with `Event.capacity`. INDIVIDUAL events keep the plain
 * confirmed-RSVP count (unchanged query); TEAM events count units.
 */
export async function countConfirmedForCapacity(
  tx: Prisma.TransactionClient,
  eventId: string,
  registrationMode: RegistrationMode | null | undefined,
): Promise<number> {
  if (registrationMode === RegistrationMode.TEAM) return countConfirmedUnits(tx, eventId);
  return tx.rSVP.count({ where: { eventId, status: RsvpStatus.CONFIRMED } });
}

/**
 * Organisation webhooks for team changes (docs/WEBHOOKS.md). Team cores
 * collect one emission per member registration whose status changed inside
 * the transaction and call `emitTeamWebhooks` only after it has committed,
 * the same commit-point rule as the individual RSVP cores.
 */
export type RegistrationStatusWebhook = Extract<WebhookEmission, { type: "registration.status_changed" }>;

export function emitTeamWebhooks(emissions: readonly WebhookEmission[]) {
  for (const emission of emissions) emitWebhookEvent(emission);
}

/** The fields a webhook needs once the registration row is gone (cancel, remove). */
export function rsvpWebhookSnapshot(rsvp: RsvpWebhookSnapshot): RsvpWebhookSnapshot {
  return {
    id: rsvp.id,
    eventId: rsvp.eventId,
    eventInstanceId: rsvp.eventInstanceId,
    userId: rsvp.userId,
    guestName: rsvp.guestName,
    createdAt: rsvp.createdAt,
    checkedInAt: rsvp.checkedInAt,
  };
}

export const rsvpWebhookSnapshotSelect = {
  id: true,
  eventId: true,
  eventInstanceId: true,
  userId: true,
  guestName: true,
  createdAt: true,
  checkedInAt: true,
} as const satisfies Prisma.RSVPSelect;

function memberEmail(member: { guestEmail: string | null; user: { email: string | null } | null }) {
  return member.user?.email?.trim() || member.guestEmail || null;
}

function memberName(member: { guestName: string | null; user: { name: string | null } | null }) {
  return member.user?.name?.trim() || member.guestName?.trim() || undefined;
}

/**
 * Move a whole team from one of `from` to `to`. The team row update is the
 * conditional guard; members follow in the same transaction so the
 * "member status = team status" invariant holds. Queues one status email per
 * member for confirmations and rejections. Returns one status webhook per
 * member whose status changed (emit after commit), or null when the team was
 * no longer in one of `from`.
 */
export async function setTeamStatusTx(
  tx: Prisma.TransactionClient,
  params: {
    teamId: string;
    eventId: string;
    eventTitle: string;
    from: RsvpStatus[];
    to: RsvpStatus;
    notify?: boolean;
  },
): Promise<RegistrationStatusWebhook[] | null> {
  const updated = await tx.team.updateMany({
    where: { id: params.teamId, eventId: params.eventId, status: { in: params.from } },
    data: { status: params.to },
  });
  if (updated.count !== 1) return null;
  const team = await tx.team.findUnique({ where: { id: params.teamId }, select: { name: true } });
  const members = await tx.rSVP.findMany({
    where: { teamId: params.teamId, eventId: params.eventId, status: { not: params.to } },
    select: { id: true, status: true, checkInToken: true, guestEmail: true, guestName: true, user: { select: { email: true, name: true } } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  await tx.rSVP.updateMany({
    where: { teamId: params.teamId, eventId: params.eventId, status: { not: params.to } },
    data: { status: params.to },
  });
  if (params.to === RsvpStatus.REJECTED) {
    // A rejected team can no longer be joined; close its open requests.
    await tx.teamJoinRequest.updateMany({
      where: { teamId: params.teamId, status: TeamJoinRequestStatus.PENDING },
      data: { status: TeamJoinRequestStatus.CANCELLED },
    });
  }
  const webhooks: RegistrationStatusWebhook[] = members.map((member) => ({
    type: "registration.status_changed",
    rsvpId: member.id,
    status: params.to,
    previousStatus: member.status,
  }));
  if (params.notify === false) return webhooks;
  if (params.to !== RsvpStatus.CONFIRMED && params.to !== RsvpStatus.REJECTED) return webhooks;
  for (const member of members) {
    const to = memberEmail(member);
    if (!to) continue;
    await enqueueRsvpStatusNotification(tx, {
      to,
      eventTitle: params.eventTitle,
      approved: params.to === RsvpStatus.CONFIRMED,
      ...(params.to === RsvpStatus.CONFIRMED ? { checkInToken: member.checkInToken } : { recipientName: memberName(member) }),
      ...(team?.name ? { teamName: team.name } : {}),
    });
  }
  return webhooks;
}

/**
 * Auto-promotion after a unit was freed on a TEAM event: the oldest
 * waitlisted unit (team or solo RSVP) becomes confirmed, but only when the
 * event is not approval-required and a unit is actually free. `webhooks`
 * lists the promoted registrations' status changes, to emit after commit.
 */
export async function promoteOldestWaitlistedUnit(
  tx: Prisma.TransactionClient,
  event: { id: string; title: string; capacity: number | null; privacyType: EventPrivacyType },
): Promise<
  | { kind: "team"; teamId: string; webhooks: RegistrationStatusWebhook[] }
  | { kind: "rsvp"; rsvpId: string; webhooks: RegistrationStatusWebhook[] }
  | null
> {
  if (event.privacyType === EventPrivacyType.APPROVAL_REQUIRED) return null;
  if (event.capacity != null && (await countConfirmedUnits(tx, event.id)) >= event.capacity) return null;
  const team = await tx.team.findFirst({
    where: { eventId: event.id, status: RsvpStatus.WAITLISTED },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, createdAt: true },
  });
  const solo = await tx.rSVP.findFirst({
    where: { eventId: event.id, teamId: null, status: RsvpStatus.WAITLISTED },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, createdAt: true, checkInToken: true, guestEmail: true, user: { select: { email: true } } },
  });
  if (team && (!solo || team.createdAt <= solo.createdAt)) {
    const promoted = await setTeamStatusTx(tx, {
      teamId: team.id,
      eventId: event.id,
      eventTitle: event.title,
      from: [RsvpStatus.WAITLISTED],
      to: RsvpStatus.CONFIRMED,
    });
    return promoted ? { kind: "team", teamId: team.id, webhooks: promoted } : null;
  }
  if (!solo) return null;
  const promoted = await tx.rSVP.updateMany({
    where: { id: solo.id, eventId: event.id, teamId: null, status: RsvpStatus.WAITLISTED },
    data: { status: RsvpStatus.CONFIRMED },
  });
  if (promoted.count !== 1) return null;
  const to = solo.user?.email?.trim() || solo.guestEmail;
  if (to) {
    await enqueueRsvpStatusNotification(tx, {
      to,
      eventTitle: event.title,
      approved: true,
      checkInToken: solo.checkInToken,
    });
  }
  return {
    kind: "rsvp",
    rsvpId: solo.id,
    webhooks: [{ type: "registration.status_changed", rsvpId: solo.id, status: RsvpStatus.CONFIRMED, previousStatus: RsvpStatus.WAITLISTED }],
  };
}

/**
 * Make `leaderRsvpId` the team leader. The management token is rotated so a
 * previous leader's link stops working, and the new leader is emailed the
 * fresh team page link (outbox kind `team-created`).
 */
export async function assignTeamLeaderTx(
  tx: Prisma.TransactionClient,
  params: { teamId: string; leaderRsvpId: string; reason: "created" | "leader" },
): Promise<{ rawManageToken: string }> {
  const manage = generateTeamManageToken();
  await tx.team.update({
    where: { id: params.teamId },
    data: { leaderRsvpId: params.leaderRsvpId, manageTokenHash: manage.hash },
  });
  const leader = await tx.rSVP.findUnique({
    where: { id: params.leaderRsvpId },
    select: { guestEmail: true, user: { select: { email: true } } },
  });
  const to = leader?.user?.email?.trim() || leader?.guestEmail;
  if (to) {
    await enqueueTeamCreated(tx, { to, teamId: params.teamId, manageToken: manage.raw, reason: params.reason });
  }
  return { rawManageToken: manage.raw };
}

/**
 * Call after an RSVP has left `teamId` (deleted, cancelled, or moved). Passes
 * leadership to the longest-standing remaining member when the leader left,
 * or deletes the now-empty team. Returns whether a confirmed unit was freed.
 */
export async function settleTeamAfterMemberLeft(
  tx: Prisma.TransactionClient,
  params: { teamId: string; eventId: string; leftRsvpId: string },
): Promise<{ teamDeleted: boolean; freedConfirmedUnit: boolean; newLeaderRsvpId: string | null }> {
  const team = await tx.team.findFirst({
    where: { id: params.teamId, eventId: params.eventId },
    select: { id: true, status: true, leaderRsvpId: true },
  });
  if (!team) return { teamDeleted: false, freedConfirmedUnit: false, newLeaderRsvpId: null };
  const next = await tx.rSVP.findFirst({
    where: { teamId: team.id, eventId: params.eventId, id: { not: params.leftRsvpId } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true },
  });
  if (!next) {
    await tx.team.delete({ where: { id: team.id } });
    return { teamDeleted: true, freedConfirmedUnit: team.status === RsvpStatus.CONFIRMED, newLeaderRsvpId: null };
  }
  if (team.leaderRsvpId === null || team.leaderRsvpId === params.leftRsvpId) {
    await assignTeamLeaderTx(tx, { teamId: team.id, leaderRsvpId: next.id, reason: "leader" });
    return { teamDeleted: false, freedConfirmedUnit: false, newLeaderRsvpId: next.id };
  }
  return { teamDeleted: false, freedConfirmedUnit: false, newLeaderRsvpId: null };
}
