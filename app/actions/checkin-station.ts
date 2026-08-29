"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOrgRole } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { createStationPin, decryptStationPin, encryptStationPin, hashStationPin } from "@/lib/checkInStation";
import { recordAuditEvent } from "@/lib/audit";
import type { ActionResult } from "./org";
import { isActionRateLimited } from "@/lib/actionRateLimit";

const schema = z.object({ organisationSlug: z.string().trim().min(1), eventId: z.string().trim().min(1) });

async function resolve(input: unknown) {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Invalid station settings." };
  const { organisation, userId } = await requireOrgRole(parsed.data.organisationSlug, "ADMIN");
  if (await isActionRateLimited("checkin", userId)) return { ok: false as const, error: "Too many requests. Please try again shortly." };
  const event = await prisma.event.findFirst({ where: { id: parsed.data.eventId, organisationId: organisation.id }, select: { id: true, slug: true, checkInStationPinEncrypted: true } });
  if (!event) return { ok: false as const, error: "Event not found." };
  return { ok: true as const, organisation, userId, event };
}

export async function createOrRotateCheckInStation(input: unknown): Promise<ActionResult<{ pin: string }>> {
  const ctx = await resolve(input);
  if (!ctx.ok) return ctx;
  const pin = createStationPin();
  const hash = await hashStationPin(pin);
  await prisma.event.update({ where: { id: ctx.event.id }, data: { checkInStationPinHash: hash, checkInStationPinEncrypted: encryptStationPin(pin), checkInStationSecretVersion: { increment: 1 } } });
  await recordAuditEvent({ action: "CHECK_IN_STATION_PIN_ROTATED", actorUserId: ctx.userId, organisationId: ctx.organisation.id, targetType: "Event", targetId: ctx.event.id });
  revalidatePath(`/dashboard/${ctx.organisation.slug}/event/${ctx.event.id}/check-in`);
  return { ok: true, data: { pin } };
}

export async function disableCheckInStation(input: unknown): Promise<ActionResult> {
  const ctx = await resolve(input);
  if (!ctx.ok) return ctx;
  await prisma.event.update({ where: { id: ctx.event.id }, data: { checkInStationPinHash: null, checkInStationPinEncrypted: null, checkInStationSecretVersion: { increment: 1 } } });
  await recordAuditEvent({ action: "CHECK_IN_STATION_DISABLED", actorUserId: ctx.userId, organisationId: ctx.organisation.id, targetType: "Event", targetId: ctx.event.id });
  revalidatePath(`/dashboard/${ctx.organisation.slug}/event/${ctx.event.id}/check-in`);
  return { ok: true };
}

export async function revealCheckInStationPin(input: unknown): Promise<ActionResult<{ pin: string }>> {
  const ctx = await resolve(input);
  if (!ctx.ok) return ctx;
  if (!ctx.event.checkInStationPinEncrypted) return { ok: false, error: "No active venue station PIN." };
  try {
    const pin = decryptStationPin(ctx.event.checkInStationPinEncrypted);
    if (!/^\d{8}$/.test(pin)) return { ok: false, error: "The venue station PIN must be rotated." };
    await recordAuditEvent({ action: "CHECK_IN_STATION_PIN_REVEALED", actorUserId: ctx.userId, organisationId: ctx.organisation.id, targetType: "Event", targetId: ctx.event.id });
    return { ok: true, data: { pin } };
  } catch {
    return { ok: false, error: "The venue station PIN must be rotated." };
  }
}
