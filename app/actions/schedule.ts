"use server";

import { EventPermission } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { canAccessEvent } from "@/lib/eventAccess";
import { recordAuditEvent } from "@/lib/audit";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import type { ActionResult } from "./org";

const target = z.object({ organisationSlug: z.string().min(1), eventSeriesId: z.string().min(1) });
const itemSchema = target.extend({ itemId: z.string().min(1).optional(), title: z.string().trim().min(1).max(200), description: z.string().trim().max(4000).optional().default(""), startDateTime: z.coerce.date(), endDateTime: z.coerce.date() }).refine((v) => v.endDateTime > v.startDateTime, { path: ["endDateTime"], message: "End must be after start." });

async function context(data: z.infer<typeof target>, userId: string) {
  const org = await prisma.organisation.findUnique({ where: { slug: data.organisationSlug } });
  if (!org) return null;
  const allowed = await canAccessEvent({ userId, organisationId: org.id, eventSeriesId: data.eventSeriesId, permission: EventPermission.PUBLISH_AND_SCHEDULE });
  return allowed ? org : null;
}
function paths(orgSlug: string, data: z.infer<typeof target>) { revalidatePath(`/dashboard/${orgSlug}/series/${data.eventSeriesId}`); }

export async function saveScheduleItem(input: unknown): Promise<ActionResult> {
  const session = await auth(); const parsed = itemSchema.safeParse(input);
  if (!session?.user?.id || !parsed.success) return { ok: false, error: "Invalid schedule item." };
  if (await isActionRateLimited("action", session.user.id)) return { ok: false, error: "Too many schedule updates. Try again shortly." };
  const org = await context(parsed.data, session.user.id); if (!org) return { ok: false, error: "You do not have permission to manage the schedule." };
  const data = parsed.data;
  if (data.itemId) {
    const updated = await prisma.eventScheduleItem.updateMany({ where: { id: data.itemId, eventSeriesId: data.eventSeriesId }, data: { title: data.title, description: data.description, startDateTime: data.startDateTime, endDateTime: data.endDateTime } });
    if (!updated.count) return { ok: false, error: "Schedule item not found." };
  } else {
    const max = await prisma.eventScheduleItem.aggregate({ where: { eventSeriesId: data.eventSeriesId }, _max: { sortOrder: true } });
    await prisma.eventScheduleItem.create({ data: { eventSeriesId: data.eventSeriesId, title: data.title, description: data.description, startDateTime: data.startDateTime, endDateTime: data.endDateTime, sortOrder: (max._max?.sortOrder ?? 0) + 1 } });
  }
  await recordAuditEvent({ action: "EVENT_SCHEDULE_UPDATED", actorUserId: session.user.id, organisationId: org.id, targetType: "schedule" }); paths(org.slug, data); return { ok: true };
}

export async function setScheduleDelay(input: unknown): Promise<ActionResult> {
  const session = await auth(); const parsed = target.extend({ itemId: z.string().min(1), delayMinutes: z.number().int().min(-720).max(1440) }).safeParse(input);
  if (!session?.user?.id || !parsed.success) return { ok: false, error: "Invalid delay." };
  if (await isActionRateLimited("action", session.user.id)) return { ok: false, error: "Too many schedule updates. Try again shortly." };
  const org = await context(parsed.data, session.user.id); if (!org) return { ok: false, error: "You do not have permission to manage the schedule." };
  const item = await prisma.eventScheduleItem.updateMany({ where: { id: parsed.data.itemId, eventSeriesId: parsed.data.eventSeriesId }, data: { delayMinutes: parsed.data.delayMinutes } });
  if (!item.count) return { ok: false, error: "Schedule item not found." };
  await recordAuditEvent({ action: "EVENT_SCHEDULE_DELAY_SET", actorUserId: session.user.id, organisationId: org.id, targetType: "schedule", targetId: parsed.data.itemId, metadata: { delayMinutes: parsed.data.delayMinutes } }); paths(org.slug, parsed.data); return { ok: true };
}
