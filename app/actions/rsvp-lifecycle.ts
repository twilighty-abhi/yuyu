"use server";

import { RsvpStatus } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { sendApprovalNotification } from "@/lib/email";
import { canManageEvents, getMembership } from "@/lib/permissions";
import { confirmRsvpWithinCapacity } from "@/lib/rsvpCapacity";
import { rsvpTransitionSchema } from "@/lib/validators";
import type { ActionResult } from "./org";
import { flattenZodErrors } from "./utils";

function revalidateRsvpPaths(params: {
  orgSlug: string;
  eventSlug?: string;
  eventId?: string;
  eventInstanceId?: string;
}) {
  const { orgSlug, eventSlug, eventId, eventInstanceId } = params;
  revalidatePath(`/${orgSlug}`);
  revalidatePath(`/dashboard/${orgSlug}`);
  if (eventSlug && eventId) {
    revalidatePath(`/${orgSlug}/${eventSlug}`);
    revalidatePath(`/dashboard/${orgSlug}/event/${eventId}`);
  }
  if (eventInstanceId) {
    revalidatePath(`/${orgSlug}/i/${eventInstanceId}`);
  }
}

async function loadRsvpContext(
  organisationSlug: string,
  userId: string,
  rsvpId: string,
  eventId: string | undefined,
  eventInstanceId: string | undefined,
) {
  const org = await prisma.organisation.findUnique({
    where: { slug: organisationSlug },
  });
  if (!org) return { error: "Organisation not found." as const };

  const membership = await getMembership(userId, org.id);
  if (!canManageEvents(membership)) {
    return { error: "You do not have permission to manage attendees." as const };
  }

  if (eventId) {
    const event = await prisma.event.findFirst({
      where: { id: eventId, organisationId: org.id },
    });
    if (!event) return { error: "Event not found." as const };
    const rsvp = await prisma.rSVP.findFirst({
      where: { id: rsvpId, eventId: event.id },
    });
    if (!rsvp) return { error: "RSVP not found." as const };
    return { org, event, rsvp, instance: null as null };
  }

  if (eventInstanceId) {
    const instance = await prisma.eventInstance.findFirst({
      where: {
        id: eventInstanceId,
        series: { organisationId: org.id },
      },
      include: { series: true },
    });
    if (!instance) return { error: "Instance not found." as const };
    const rsvp = await prisma.rSVP.findFirst({
      where: { id: rsvpId, eventInstanceId: instance.id },
    });
    if (!rsvp) return { error: "RSVP not found." as const };
    return { org, event: null, instance, rsvp };
  }

  return { error: "Event not found." as const };
}

function attendeeEmail(rsvp: {
  guestEmail: string | null;
  user: { email: string | null } | null;
}): string | null {
  return rsvp.user?.email?.trim() || rsvp.guestEmail;
}

export async function approveRsvp(input: unknown): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "You must be signed in." };
  }

  const parsed = rsvpTransitionSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Invalid input.",
      fieldErrors: flattenZodErrors(parsed.error),
    };
  }

  const { organisationSlug, rsvpId, eventId, eventInstanceId } = parsed.data;
  const ctx = await loadRsvpContext(
    organisationSlug,
    session.user.id,
    rsvpId,
    eventId,
    eventInstanceId,
  );
  if ("error" in ctx && ctx.error) return { ok: false, error: ctx.error };
  if (!("rsvp" in ctx)) return { ok: false, error: "Invalid state." };

  const { org, rsvp } = ctx;
  if (rsvp.status !== RsvpStatus.PENDING_APPROVAL) {
    return { ok: false, error: "Only pending requests can be approved." };
  }

  if (ctx.event) {
    const result = await confirmRsvpWithinCapacity({
      rsvpId: rsvp.id,
      eventId: ctx.event.id,
      capacity: ctx.event.capacity,
      expectedStatuses: [RsvpStatus.PENDING_APPROVAL],
    });
    if (result === "full") {
      return {
        ok: false,
        error: "Event is at capacity. Free a spot or promote from waitlist first.",
      };
    }
    if (result !== "confirmed") return { ok: false, error: "This RSVP was changed by another organiser." };
    const to = attendeeEmail(
      await prisma.rSVP.findUniqueOrThrow({
        where: { id: rsvp.id },
        include: { user: { select: { email: true } } },
      }),
    );
    if (to) {
      await sendApprovalNotification({
        to,
        eventTitle: ctx.event.title,
        approved: true,
      });
    }
    revalidateRsvpPaths({
      orgSlug: org.slug,
      eventSlug: ctx.event.slug,
      eventId: ctx.event.id,
    });
    return { ok: true };
  }

  const instance = ctx.instance!;
  const series = instance.series;
  const result = await confirmRsvpWithinCapacity({
    rsvpId: rsvp.id,
    eventInstanceId: instance.id,
    capacity: series.capacity,
    expectedStatuses: [RsvpStatus.PENDING_APPROVAL],
  });
  if (result === "full") {
    return {
      ok: false,
      error: "This occurrence is at capacity.",
    };
  }
  if (result !== "confirmed") return { ok: false, error: "This RSVP was changed by another organiser." };
  const row = await prisma.rSVP.findUniqueOrThrow({
    where: { id: rsvp.id },
    include: { user: { select: { email: true } } },
  });
  const to = attendeeEmail(row);
  if (to) {
    await sendApprovalNotification({
      to,
      eventTitle: series.title,
      approved: true,
    });
  }
  revalidateRsvpPaths({
    orgSlug: org.slug,
    eventInstanceId: instance.id,
  });
  return { ok: true };
}

export async function rejectRsvp(input: unknown): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "You must be signed in." };
  }

  const parsed = rsvpTransitionSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Invalid input.",
      fieldErrors: flattenZodErrors(parsed.error),
    };
  }

  const { organisationSlug, rsvpId, eventId, eventInstanceId } = parsed.data;
  const ctx = await loadRsvpContext(
    organisationSlug,
    session.user.id,
    rsvpId,
    eventId,
    eventInstanceId,
  );
  if ("error" in ctx && ctx.error) return { ok: false, error: ctx.error };
  if (!("rsvp" in ctx)) return { ok: false, error: "Invalid state." };

  const { org, rsvp } = ctx;
  if (
    rsvp.status !== RsvpStatus.PENDING_APPROVAL &&
    rsvp.status !== RsvpStatus.WAITLISTED
  ) {
    return { ok: false, error: "This RSVP cannot be rejected." };
  }

  const rejected = await prisma.rSVP.updateMany({
    where: { id: rsvp.id, status: { in: [RsvpStatus.PENDING_APPROVAL, RsvpStatus.WAITLISTED] } },
    data: { status: RsvpStatus.REJECTED },
  });
  if (rejected.count !== 1) return { ok: false, error: "This RSVP was changed by another organiser." };

  if (ctx.event) {
    const to = attendeeEmail(
      await prisma.rSVP.findUniqueOrThrow({
        where: { id: rsvp.id },
        include: { user: { select: { email: true } } },
      }),
    );
    if (to) {
      await sendApprovalNotification({
        to,
        eventTitle: ctx.event.title,
        approved: false,
      });
    }
    revalidateRsvpPaths({
      orgSlug: org.slug,
      eventSlug: ctx.event.slug,
      eventId: ctx.event.id,
    });
    return { ok: true };
  }

  const instance = ctx.instance!;
  const to = attendeeEmail(
    await prisma.rSVP.findUniqueOrThrow({
      where: { id: rsvp.id },
      include: { user: { select: { email: true } } },
    }),
  );
  if (to) {
    await sendApprovalNotification({
      to,
      eventTitle: instance.series.title,
      approved: false,
    });
  }
  revalidateRsvpPaths({
    orgSlug: org.slug,
    eventInstanceId: instance.id,
  });
  return { ok: true };
}

export async function promoteFromWaitlist(input: unknown): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "You must be signed in." };
  }

  const parsed = rsvpTransitionSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Invalid input.",
      fieldErrors: flattenZodErrors(parsed.error),
    };
  }

  const { organisationSlug, rsvpId, eventId, eventInstanceId } = parsed.data;
  const ctx = await loadRsvpContext(
    organisationSlug,
    session.user.id,
    rsvpId,
    eventId,
    eventInstanceId,
  );
  if ("error" in ctx && ctx.error) return { ok: false, error: ctx.error };
  if (!("rsvp" in ctx)) return { ok: false, error: "Invalid state." };

  const { org, rsvp } = ctx;
  if (rsvp.status !== RsvpStatus.WAITLISTED) {
    return { ok: false, error: "Only waitlisted attendees can be promoted." };
  }

  if (ctx.event) {
    const result = await confirmRsvpWithinCapacity({
      rsvpId: rsvp.id,
      eventId: ctx.event.id,
      capacity: ctx.event.capacity,
      expectedStatuses: [RsvpStatus.WAITLISTED],
    });
    if (result === "full") {
      return { ok: false, error: "Event is still at capacity." };
    }
    if (result !== "confirmed") return { ok: false, error: "This RSVP was changed by another organiser." };
    revalidateRsvpPaths({
      orgSlug: org.slug,
      eventSlug: ctx.event.slug,
      eventId: ctx.event.id,
    });
    return { ok: true };
  }

  const instance = ctx.instance!;
  const series = instance.series;
  const result = await confirmRsvpWithinCapacity({
    rsvpId: rsvp.id,
    eventInstanceId: instance.id,
    capacity: series.capacity,
    expectedStatuses: [RsvpStatus.WAITLISTED],
  });
  if (result === "full") {
    return { ok: false, error: "This occurrence is still at capacity." };
  }
  if (result !== "confirmed") return { ok: false, error: "This RSVP was changed by another organiser." };
  revalidateRsvpPaths({
    orgSlug: org.slug,
    eventInstanceId: instance.id,
  });
  return { ok: true };
}
