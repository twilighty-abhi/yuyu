"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { gateCheckInForStatus, parseCheckInPayload } from "@/lib/checkIn";
import { prisma } from "@/lib/db";
import { getMembership, hasRoleAtLeast } from "@/lib/permissions";
import {
  attendeeLookupSchema,
  checkInByRsvpIdSchema,
  checkInByTokenSchema,
  offlineCheckInRosterSchema,
  syncOfflineCheckInsSchema,
  undoCheckInSchema,
} from "@/lib/validators";
import type { ActionResult } from "./org";
import { flattenZodErrors } from "./utils";

export type CheckInResultData = {
  rsvpId: string;
  displayName: string;
  email: string | null;
  status: string;
  alreadyCheckedIn: boolean;
  checkedInAt: string | null;
};

export type CheckInPreviewData = CheckInResultData & {
  gate: { ok: true } | { ok: false; reason: string; needsForce: boolean; blocked?: boolean };
};

function revalidateAfterCheckIn(
  orgSlug: string,
  rsvp: {
    eventId: string | null;
    event: { slug: string } | null;
    eventInstanceId: string | null;
  },
) {
  if (rsvp.eventId && rsvp.event) {
    revalidatePath(`/dashboard/${orgSlug}/event/${rsvp.eventId}`);
    revalidatePath(`/dashboard/${orgSlug}/event/${rsvp.eventId}/check-in`);
    revalidatePath(`/${orgSlug}/${rsvp.event.slug}`);
  }
  if (rsvp.eventInstanceId) {
    revalidatePath(`/${orgSlug}/i/${rsvp.eventInstanceId}`);
  }
  revalidatePath(`/${orgSlug}`);
}

async function requireOrgMemberForEvent(
  organisationSlug: string,
  eventId: string,
) {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false as const, error: "You must be signed in." };
  }
  const org = await prisma.organisation.findUnique({
    where: { slug: organisationSlug },
  });
  if (!org) return { ok: false as const, error: "Organisation not found." };

  const membership = await getMembership(session.user.id, org.id);
  if (!membership) {
    return { ok: false as const, error: "You are not a member of this organisation." };
  }
  if (!hasRoleAtLeast(membership.role, "MEMBER")) {
    return { ok: false as const, error: "You do not have access." };
  }

  const event = await prisma.event.findFirst({
    where: { id: eventId, organisationId: org.id },
  });
  if (!event) return { ok: false as const, error: "Event not found." };

  return {
    ok: true as const,
    event,
    orgSlug: org.slug,
    membership,
  };
}

function attendeeLabel(r: {
  user: { name: string | null; email: string | null } | null;
  guestName?: string | null;
  guestEmail: string | null;
}) {
  const name = r.user?.name?.trim();
  if (name) return name;
  const gn = r.guestName?.trim();
  if (gn) return gn;
  const email = r.user?.email ?? r.guestEmail;
  return email ?? "Guest";
}

async function resolveRsvpForToken(
  organisationSlug: string,
  eventId: string,
  rawInput: string,
) {
  const ctx = await requireOrgMemberForEvent(organisationSlug, eventId);
  if (!ctx.ok) return { ok: false as const, error: ctx.error };

  const token = parseCheckInPayload(rawInput);
  if (!token) {
    return { ok: false as const, error: "Could not read a ticket code from that input." };
  }

  const rsvp = await prisma.rSVP.findFirst({
    where: { checkInToken: token },
    include: {
      user: { select: { name: true, email: true } },
      event: { select: { id: true, organisationId: true, slug: true } },
      eventInstance: {
        include: { series: { select: { organisationId: true } } },
      },
    },
  });

  if (!rsvp) {
    return { ok: false as const, error: "No matching ticket found." };
  }

  const orgId = ctx.event.organisationId;
  if (rsvp.eventId && rsvp.event) {
    if (rsvp.event.organisationId !== orgId || rsvp.eventId !== ctx.event.id) {
      return { ok: false as const, error: "This ticket is not for this event." };
    }
  } else if (rsvp.eventInstanceId && rsvp.eventInstance) {
    if (rsvp.eventInstance.series.organisationId !== orgId) {
      return { ok: false as const, error: "This ticket belongs to another organisation." };
    }
  } else {
    return { ok: false as const, error: "Invalid registration." };
  }

  return { ok: true as const, ctx, rsvp };
}

export async function previewCheckInByToken(
  input: unknown,
): Promise<ActionResult<CheckInPreviewData>> {
  const parsed = checkInByTokenSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Invalid input.",
      fieldErrors: flattenZodErrors(parsed.error),
    };
  }

  const { organisationSlug, eventId, rawInput, force } = parsed.data;
  const resolved = await resolveRsvpForToken(organisationSlug, eventId, rawInput);
  if (!resolved.ok) return { ok: false, error: resolved.error };

  const { rsvp } = resolved;
  const gate = gateCheckInForStatus(rsvp.status, Boolean(force));

  return {
    ok: true,
    data: {
      rsvpId: rsvp.id,
      displayName: attendeeLabel(rsvp),
      email: rsvp.user?.email ?? rsvp.guestEmail,
      status: rsvp.status,
      alreadyCheckedIn: Boolean(rsvp.checkedInAt),
      checkedInAt: rsvp.checkedInAt?.toISOString() ?? null,
      gate,
    },
  };
}

export async function checkInByToken(
  input: unknown,
): Promise<ActionResult<CheckInResultData>> {
  const parsed = checkInByTokenSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Invalid input.",
      fieldErrors: flattenZodErrors(parsed.error),
    };
  }

  const { organisationSlug, eventId, rawInput, force } = parsed.data;
  const resolved = await resolveRsvpForToken(organisationSlug, eventId, rawInput);
  if (!resolved.ok) return { ok: false, error: resolved.error };
  const { ctx, rsvp } = resolved;

  const gate = gateCheckInForStatus(rsvp.status, Boolean(force));
  if (!gate.ok) {
    if (gate.blocked) {
      return {
        ok: false,
        error: gate.reason,
      };
    }
    return {
      ok: false,
      error: gate.reason,
      needsForce: true,
    };
  }

  if (rsvp.checkedInAt) {
    return {
      ok: true,
      data: {
        rsvpId: rsvp.id,
        displayName: attendeeLabel(rsvp),
        email: rsvp.user?.email ?? rsvp.guestEmail,
        status: rsvp.status,
        alreadyCheckedIn: true,
        checkedInAt: rsvp.checkedInAt.toISOString(),
      },
    };
  }

  const now = new Date();
  await prisma.rSVP.update({
    where: { id: rsvp.id },
    data: { checkedInAt: now },
  });

  revalidateAfterCheckIn(ctx.orgSlug, {
    eventId: rsvp.eventId,
    event: rsvp.event,
    eventInstanceId: rsvp.eventInstanceId,
  });

  return {
    ok: true,
    data: {
      rsvpId: rsvp.id,
      displayName: attendeeLabel(rsvp),
      email: rsvp.user?.email ?? rsvp.guestEmail,
      status: rsvp.status,
      alreadyCheckedIn: false,
      checkedInAt: now.toISOString(),
    },
  };
}

export async function undoCheckIn(input: unknown): Promise<ActionResult> {
  const parsed = undoCheckInSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Invalid input.",
      fieldErrors: flattenZodErrors(parsed.error),
    };
  }

  const { organisationSlug, eventId, rsvpId } = parsed.data;
  const ctx = await requireOrgMemberForEvent(organisationSlug, eventId);
  if (!ctx.ok) return { ok: false, error: ctx.error };

  const rsvp = await prisma.rSVP.findFirst({
    where: { id: rsvpId },
    include: {
      event: { select: { slug: true, organisationId: true } },
      eventInstance: {
        include: { series: { select: { organisationId: true } } },
      },
    },
  });
  if (!rsvp) return { ok: false, error: "RSVP not found." };

  const orgId = ctx.event.organisationId;
  if (rsvp.eventId) {
    if (rsvp.eventId !== ctx.event.id || rsvp.event?.organisationId !== orgId) {
      return { ok: false, error: "RSVP not found." };
    }
  } else if (rsvp.eventInstanceId) {
    if (rsvp.eventInstance?.series.organisationId !== orgId) {
      return { ok: false, error: "RSVP not found." };
    }
  } else {
    return { ok: false, error: "RSVP not found." };
  }

  await prisma.rSVP.update({
    where: { id: rsvp.id },
    data: { checkedInAt: null },
  });

  revalidateAfterCheckIn(ctx.orgSlug, {
    eventId: rsvp.eventId,
    event: rsvp.event ? { slug: rsvp.event.slug } : null,
    eventInstanceId: rsvp.eventInstanceId,
  });
  return { ok: true };
}

export type LookupRow = {
  rsvpId: string;
  displayName: string;
  email: string | null;
  status: string;
  checkedInAt: string | null;
};

export type OfflineCheckInRosterRow = LookupRow & {
  ticketToken: string;
};

export async function downloadOfflineCheckInRoster(
  input: unknown,
): Promise<ActionResult<{ generatedAt: string; rows: OfflineCheckInRosterRow[] }>> {
  const parsed = offlineCheckInRosterSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Invalid offline roster request." };
  }

  const { organisationSlug, eventId } = parsed.data;
  const ctx = await requireOrgMemberForEvent(organisationSlug, eventId);
  if (!ctx.ok) return { ok: false, error: ctx.error };

  const rsvps = await prisma.rSVP.findMany({
    where: { eventId: ctx.event.id },
    include: { user: { select: { name: true, email: true } } },
    orderBy: { createdAt: "desc" },
  });

  return {
    ok: true,
    data: {
      generatedAt: new Date().toISOString(),
      rows: rsvps.map((r) => ({
        rsvpId: r.id,
        ticketToken: r.checkInToken,
        displayName: attendeeLabel(r),
        email: r.user?.email ?? r.guestEmail,
        status: r.status,
        checkedInAt: r.checkedInAt?.toISOString() ?? null,
      })),
    },
  };
}

export async function syncOfflineCheckIns(
  input: unknown,
): Promise<ActionResult<{ syncedIds: string[]; alreadyCheckedInIds: string[]; failed: { rsvpId: string; error: string }[] }>> {
  const parsed = syncOfflineCheckInsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Invalid offline check-in queue." };
  }

  const { organisationSlug, eventId, checkIns } = parsed.data;
  const ctx = await requireOrgMemberForEvent(organisationSlug, eventId);
  if (!ctx.ok) return { ok: false, error: ctx.error };

  const rsvps = await prisma.rSVP.findMany({
    where: { eventId: ctx.event.id, id: { in: checkIns.map((checkIn) => checkIn.rsvpId) } },
    select: { id: true, status: true, checkedInAt: true },
  });
  const rsvpById = new Map(rsvps.map((rsvp) => [rsvp.id, rsvp]));
  const syncedIds: string[] = [];
  const alreadyCheckedInIds: string[] = [];
  const failed: { rsvpId: string; error: string }[] = [];

  for (const checkIn of checkIns) {
    const rsvp = rsvpById.get(checkIn.rsvpId);
    if (!rsvp) {
      failed.push({ rsvpId: checkIn.rsvpId, error: "RSVP not found for this event." });
      continue;
    }
    const gate = gateCheckInForStatus(rsvp.status, checkIn.force);
    if (!gate.ok) {
      failed.push({ rsvpId: checkIn.rsvpId, error: gate.reason });
      continue;
    }
    if (rsvp.checkedInAt) {
      alreadyCheckedInIds.push(rsvp.id);
      continue;
    }
    await prisma.rSVP.update({
      where: { id: rsvp.id },
      data: { checkedInAt: new Date(checkIn.checkedInAt) },
    });
    syncedIds.push(rsvp.id);
  }

  if (syncedIds.length > 0) {
    revalidatePath(`/dashboard/${ctx.orgSlug}/event/${ctx.event.id}`);
    revalidatePath(`/dashboard/${ctx.orgSlug}/event/${ctx.event.id}/check-in`);
  }

  return { ok: true, data: { syncedIds, alreadyCheckedInIds, failed } };
}

export async function lookupAttendeesForCheckIn(
  input: unknown,
): Promise<ActionResult<{ rows: LookupRow[] }>> {
  const parsed = attendeeLookupSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Invalid input.",
      fieldErrors: flattenZodErrors(parsed.error),
    };
  }

  const { organisationSlug, eventId, query } = parsed.data;
  const ctx = await requireOrgMemberForEvent(organisationSlug, eventId);
  if (!ctx.ok) return { ok: false, error: ctx.error };

  const q = query.trim().toLowerCase();
  if (q.length < 2) {
    return { ok: true, data: { rows: [] } };
  }

  const rsvps = await prisma.rSVP.findMany({
    where: {
      eventId: ctx.event.id,
      OR: [
        { guestEmail: { contains: q, mode: "insensitive" } },
        { guestName: { contains: q, mode: "insensitive" } },
        { user: { email: { contains: q, mode: "insensitive" } } },
        { user: { name: { contains: q, mode: "insensitive" } } },
      ],
    },
    take: 12,
    include: { user: { select: { name: true, email: true } } },
    orderBy: { createdAt: "desc" },
  });

  const rows: LookupRow[] = rsvps.map((r) => ({
    rsvpId: r.id,
    displayName: attendeeLabel(r),
    email: r.user?.email ?? r.guestEmail,
    status: r.status,
    checkedInAt: r.checkedInAt?.toISOString() ?? null,
  }));

  return { ok: true, data: { rows } };
}

export async function checkInByRsvpId(
  input: unknown,
): Promise<ActionResult<CheckInResultData>> {
  const parsed = checkInByRsvpIdSchema.safeParse(input);

  if (!parsed.success) {
    return {
      ok: false,
      error: "Invalid input.",
      fieldErrors: flattenZodErrors(parsed.error),
    };
  }

  const { organisationSlug, eventId, rsvpId, force } = parsed.data;
  const ctx = await requireOrgMemberForEvent(organisationSlug, eventId);
  if (!ctx.ok) return { ok: false, error: ctx.error };

  const rsvp = await prisma.rSVP.findFirst({
    where: { id: rsvpId, eventId: ctx.event.id },
    include: {
      user: { select: { name: true, email: true } },
      event: { select: { slug: true } },
      eventInstance: { select: { id: true } },
    },
  });
  if (!rsvp) return { ok: false, error: "RSVP not found." };

  const gate = gateCheckInForStatus(rsvp.status, Boolean(force));
  if (!gate.ok) {
    if (gate.blocked) {
      return { ok: false, error: gate.reason };
    }
    return {
      ok: false,
      error: gate.reason,
      needsForce: true,
    };
  }

  if (rsvp.checkedInAt) {
    return {
      ok: true,
      data: {
        rsvpId: rsvp.id,
        displayName: attendeeLabel(rsvp),
        email: rsvp.user?.email ?? rsvp.guestEmail,
        status: rsvp.status,
        alreadyCheckedIn: true,
        checkedInAt: rsvp.checkedInAt.toISOString(),
      },
    };
  }

  const now = new Date();
  await prisma.rSVP.update({
    where: { id: rsvp.id },
    data: { checkedInAt: now },
  });

  revalidateAfterCheckIn(ctx.orgSlug, {
    eventId: rsvp.eventId,
    event: rsvp.event,
    eventInstanceId: rsvp.eventInstanceId,
  });

  return {
    ok: true,
    data: {
      rsvpId: rsvp.id,
      displayName: attendeeLabel(rsvp),
      email: rsvp.user?.email ?? rsvp.guestEmail,
      status: rsvp.status,
      alreadyCheckedIn: false,
      checkedInAt: now.toISOString(),
    },
  };
}
