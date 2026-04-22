"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { canManageEvents, getMembership } from "@/lib/permissions";
import {
  addEventInviteSchema,
  addSeriesInviteSchema,
  removeEventInviteSchema,
  removeSeriesInviteSchema,
} from "@/lib/validators";
import type { ActionResult } from "./org";
import { flattenZodErrors } from "./utils";

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export async function addEventInvite(input: unknown): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "You must be signed in." };
  }

  const parsed = addEventInviteSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Invalid input.",
      fieldErrors: flattenZodErrors(parsed.error),
    };
  }

  const { organisationSlug, eventId, email } = parsed.data;
  const org = await prisma.organisation.findUnique({
    where: { slug: organisationSlug },
  });
  if (!org) return { ok: false, error: "Organisation not found." };

  const membership = await getMembership(session.user.id, org.id);
  if (!canManageEvents(membership)) {
    return { ok: false, error: "You do not have permission to manage invites." };
  }

  const event = await prisma.event.findFirst({
    where: { id: eventId, organisationId: org.id },
  });
  if (!event) return { ok: false, error: "Event not found." };

  try {
    await prisma.eventInvite.create({
      data: {
        eventId: event.id,
        email: normalizeEmail(email),
      },
    });
    revalidatePath(`/dashboard/${org.slug}/event/${event.id}`);
    return { ok: true };
  } catch (e: unknown) {
    if (
      typeof e === "object" &&
      e !== null &&
      "code" in e &&
      (e as { code: string }).code === "P2002"
    ) {
      return { ok: false, error: "That email is already invited." };
    }
    console.error(e);
    return { ok: false, error: "Could not add invite." };
  }
}

export async function removeEventInvite(input: unknown): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "You must be signed in." };
  }

  const parsed = removeEventInviteSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Invalid input.",
      fieldErrors: flattenZodErrors(parsed.error),
    };
  }

  const { organisationSlug, inviteId, eventId } = parsed.data;
  const org = await prisma.organisation.findUnique({
    where: { slug: organisationSlug },
  });
  if (!org) return { ok: false, error: "Organisation not found." };

  const membership = await getMembership(session.user.id, org.id);
  if (!canManageEvents(membership)) {
    return { ok: false, error: "You do not have permission." };
  }

  const event = await prisma.event.findFirst({
    where: { id: eventId, organisationId: org.id },
  });
  if (!event) return { ok: false, error: "Event not found." };

  const invite = await prisma.eventInvite.findFirst({
    where: { id: inviteId, eventId: event.id },
  });
  if (!invite) return { ok: false, error: "Invite not found." };

  await prisma.eventInvite.delete({ where: { id: invite.id } });
  revalidatePath(`/dashboard/${org.slug}/event/${event.id}`);
  return { ok: true };
}

export async function addSeriesInvite(input: unknown): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "You must be signed in." };
  }

  const parsed = addSeriesInviteSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Invalid input.",
      fieldErrors: flattenZodErrors(parsed.error),
    };
  }

  const { organisationSlug, eventSeriesId, email } = parsed.data;
  const org = await prisma.organisation.findUnique({
    where: { slug: organisationSlug },
  });
  if (!org) return { ok: false, error: "Organisation not found." };

  const membership = await getMembership(session.user.id, org.id);
  if (!canManageEvents(membership)) {
    return { ok: false, error: "You do not have permission to manage invites." };
  }

  const series = await prisma.eventSeries.findFirst({
    where: { id: eventSeriesId, organisationId: org.id },
  });
  if (!series) return { ok: false, error: "Series not found." };

  try {
    await prisma.seriesInvite.create({
      data: {
        eventSeriesId: series.id,
        email: normalizeEmail(email),
      },
    });
    revalidatePath(`/dashboard/${org.slug}/series/${series.id}`);
    return { ok: true };
  } catch (e: unknown) {
    if (
      typeof e === "object" &&
      e !== null &&
      "code" in e &&
      (e as { code: string }).code === "P2002"
    ) {
      return { ok: false, error: "That email is already invited." };
    }
    console.error(e);
    return { ok: false, error: "Could not add invite." };
  }
}

export async function removeSeriesInvite(input: unknown): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "You must be signed in." };
  }

  const parsed = removeSeriesInviteSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Invalid input.",
      fieldErrors: flattenZodErrors(parsed.error),
    };
  }

  const { organisationSlug, inviteId, eventSeriesId } = parsed.data;
  const org = await prisma.organisation.findUnique({
    where: { slug: organisationSlug },
  });
  if (!org) return { ok: false, error: "Organisation not found." };

  const membership = await getMembership(session.user.id, org.id);
  if (!canManageEvents(membership)) {
    return { ok: false, error: "You do not have permission." };
  }

  const series = await prisma.eventSeries.findFirst({
    where: { id: eventSeriesId, organisationId: org.id },
  });
  if (!series) return { ok: false, error: "Series not found." };

  const invite = await prisma.seriesInvite.findFirst({
    where: { id: inviteId, eventSeriesId: series.id },
  });
  if (!invite) return { ok: false, error: "Invite not found." };

  await prisma.seriesInvite.delete({ where: { id: invite.id } });
  revalidatePath(`/dashboard/${org.slug}/series/${series.id}`);
  return { ok: true };
}
