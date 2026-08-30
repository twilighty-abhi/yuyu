"use server";

import { EventStatus, RsvpStatus } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { buildRecurrenceIcs, materializeInstances } from "@/lib/recurrence";
import { canCreateEvent, canManageEvents, getMembership, isUserEmailVerified } from "@/lib/permissions";
import { slugifyTitle, withSlugSuffix } from "@/lib/slug";
import {
  createSeriesSchema,
  deleteSeriesSchema,
  updateSeriesMetaSchema,
} from "@/lib/validators";
import type { ActionResult } from "./org";
import { flattenZodErrors } from "./utils";
import { recordAuditEvent } from "@/lib/audit";
import { isActionRateLimited } from "@/lib/actionRateLimit";

function revalidateAllSeriesPaths(
  orgSlug: string,
  seriesId: string,
  instanceIds: string[],
) {
  revalidatePath(`/dashboard/${orgSlug}`);
  revalidatePath(`/dashboard/${orgSlug}/series/${seriesId}`);
  revalidatePath(`/${orgSlug}`);
  for (const id of instanceIds) {
    revalidatePath(`/${orgSlug}/i/${id}`);
  }
}

export async function createEventSeries(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "You must be signed in." };
  }
  if (!(await isUserEmailVerified(session.user.id))) {
    return { ok: false, error: "Verify your email before creating event series." };
  }
  if (await isActionRateLimited("create", session.user.id)) {
    return { ok: false, error: "Too many creation attempts. Please try again later." };
  }

  const parsed = createSeriesSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Invalid input.",
      fieldErrors: flattenZodErrors(parsed.error),
    };
  }

  const data = parsed.data;
  const org = await prisma.organisation.findUnique({
    where: { slug: data.organisationSlug },
  });
  if (!org) return { ok: false, error: "Organisation not found." };

  const membership = await getMembership(session.user.id, org.id);
  if (!canCreateEvent(membership)) {
    return {
      ok: false,
      error: "Only owners and admins can create event series.",
    };
  }

  const baseSlug = slugifyTitle(data.title);
  let slug = baseSlug;
  let attempt = 0;
  while (
    await prisma.eventSeries.findUnique({
      where: { organisationId_slug: { organisationId: org.id, slug } },
    })
  ) {
    attempt += 1;
    if (attempt > 50) {
      return { ok: false, error: "Could not generate a unique URL slug." };
    }
    slug = withSlugSuffix(baseSlug, attempt);
  }

  const durationMs =
    data.anchorEndDateTime.getTime() - data.anchorStartDateTime.getTime();
  if (durationMs <= 0) {
    return { ok: false, error: "Invalid duration." };
  }

  const ics = buildRecurrenceIcs(data.anchorStartDateTime, data.rruleLine);
  const windows = materializeInstances(ics, durationMs);
  if (windows.length === 0) {
    return {
      ok: false,
      error: "Could not expand recurrence — check the rule (include FREQ=…).",
    };
  }

  try {
    const series = await prisma.$transaction(async (tx) => {
      const s = await tx.eventSeries.create({
        data: {
          organisationId: org.id,
          title: data.title,
          slug,
          description: data.description ?? "",
          recurrenceRule: ics,
          instanceDurationMs: durationMs,
          timezone: data.timezone,
          privacyType: data.privacyType,
          capacity: data.capacity ?? null,
          status: data.status ?? EventStatus.DRAFT,
        },
      });
      await tx.eventInstance.createMany({
        data: windows.map((w) => ({
          eventSeriesId: s.id,
          startDateTime: w.startDateTime,
          endDateTime: w.endDateTime,
        })),
      });
      return s;
    });

    const instances = await prisma.eventInstance.findMany({
      where: { eventSeriesId: series.id },
      select: { id: true },
    });
    await recordAuditEvent({
      action: "EVENT_SERIES_CREATED",
      actorUserId: session.user.id,
      organisationId: org.id,
      targetType: "EventSeries",
      targetId: series.id,
      metadata: { instances: instances.length, status: series.status },
    });
    revalidateAllSeriesPaths(
      org.slug,
      series.id,
      instances.map((i) => i.id),
    );
    return { ok: true, data: { id: series.id } };
  } catch {
    console.error("[series] creation failed");
    return { ok: false, error: "Could not create event series." };
  }
}

export async function updateEventSeriesMeta(
  input: unknown,
): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "You must be signed in." };
  }
  if (await isActionRateLimited("action", session.user.id)) return { ok: false, error: "Too many updates. Please try again later." };

  const parsed = updateSeriesMetaSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Invalid input.",
      fieldErrors: flattenZodErrors(parsed.error),
    };
  }

  const data = parsed.data;
  const org = await prisma.organisation.findUnique({
    where: { slug: data.organisationSlug },
  });
  if (!org) return { ok: false, error: "Organisation not found." };

  const membership = await getMembership(session.user.id, org.id);
  if (!canManageEvents(membership)) {
    return { ok: false, error: "You do not have permission to edit this series." };
  }

  const series = await prisma.eventSeries.findFirst({
    where: { id: data.eventSeriesId, organisationId: org.id },
  });
  if (!series) return { ok: false, error: "Series not found." };

  const saved = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "EventSeries" WHERE "id" = ${series.id} FOR UPDATE`;
    if (data.capacity != null) {
      const counts = await tx.rSVP.groupBy({
        by: ["eventInstanceId"],
        where: { eventInstance: { eventSeriesId: series.id }, status: RsvpStatus.CONFIRMED },
        _count: { _all: true },
      });
      if (counts.some((row) => row._count._all > data.capacity!)) return false;
    }
    await tx.eventSeries.update({
      where: { id: series.id },
      data: {
        title: data.title,
        description: data.description ?? "",
        timezone: data.timezone,
        capacity: data.capacity ?? null,
        status: data.status,
        privacyType: data.privacyType,
      },
    });
    return true;
  });
  if (!saved) return { ok: false, error: "Capacity cannot be lower than confirmed attendance for an occurrence." };

  await recordAuditEvent({
    action: "EVENT_SERIES_UPDATED",
    actorUserId: session.user.id,
    organisationId: org.id,
    targetType: "EventSeries",
    targetId: series.id,
    metadata: { status: data.status },
  });

  const instances = await prisma.eventInstance.findMany({
    where: { eventSeriesId: series.id },
    select: { id: true },
  });
  revalidateAllSeriesPaths(
    org.slug,
    series.id,
    instances.map((i) => i.id),
  );
  return { ok: true };
}

export async function deleteEventSeries(input: unknown): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "You must be signed in." };
  }
  if (await isActionRateLimited("action", session.user.id)) return { ok: false, error: "Too many updates. Please try again later." };

  const parsed = deleteSeriesSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Invalid input.",
      fieldErrors: flattenZodErrors(parsed.error),
    };
  }

  const { organisationSlug, eventSeriesId } = parsed.data;
  const org = await prisma.organisation.findUnique({
    where: { slug: organisationSlug },
  });
  if (!org) return { ok: false, error: "Organisation not found." };

  const membership = await getMembership(session.user.id, org.id);
  if (!canManageEvents(membership)) {
    return { ok: false, error: "You do not have permission to delete this series." };
  }

  const series = await prisma.eventSeries.findFirst({
    where: { id: eventSeriesId, organisationId: org.id },
  });
  if (!series) return { ok: false, error: "Series not found." };

  const instances = await prisma.eventInstance.findMany({
    where: { eventSeriesId: series.id },
    select: { id: true },
  });

  await prisma.eventSeries.delete({ where: { id: series.id } });

  await recordAuditEvent({
    action: "EVENT_SERIES_DELETED",
    actorUserId: session.user.id,
    organisationId: org.id,
    targetType: "EventSeries",
    targetId: series.id,
  });

  revalidatePath(`/dashboard/${org.slug}`);
  revalidatePath(`/${org.slug}`);
  for (const i of instances) {
    revalidatePath(`/${org.slug}/i/${i.id}`);
  }
  return { ok: true };
}
