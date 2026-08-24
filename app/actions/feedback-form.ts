"use server";

import { RegistrationFieldType } from "@prisma/client";
import { z } from "zod";
import type { ActionResult } from "@/app/actions/org";
import { prisma } from "@/lib/db";
import { requireOrgRole } from "@/lib/permissions";
import { recordAuditEvent } from "@/lib/audit";

const base = z.object({ organisationSlug: z.string().trim().min(1), eventId: z.string().trim().min(1) });
async function access(input: { organisationSlug: string; eventId: string }) {
  const { organisation, userId } = await requireOrgRole(input.organisationSlug, "ADMIN");
  const event = await prisma.event.findFirst({ where: { id: input.eventId, organisationId: organisation.id }, select: { id: true } });
  return event ? { organisation, userId, event } : null;
}
export async function saveFeedbackSettings(input: unknown): Promise<ActionResult<{ formId: string }>> {
  const parsed = base.extend({ isOpen: z.boolean(), title: z.string().trim().min(1).max(120), thankYouMessage: z.string().trim().min(1).max(500), certificateEnabled: z.boolean() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check the feedback settings." };
  const context = await access(parsed.data); if (!context) return { ok: false, error: "Event not found." };
  const form = await prisma.eventFeedbackForm.upsert({ where: { eventId: context.event.id }, create: { eventId: context.event.id, isOpen: parsed.data.isOpen, title: parsed.data.title, thankYouMessage: parsed.data.thankYouMessage, certificateEnabled: parsed.data.certificateEnabled }, update: { isOpen: parsed.data.isOpen, title: parsed.data.title, thankYouMessage: parsed.data.thankYouMessage, certificateEnabled: parsed.data.certificateEnabled } });
  await recordAuditEvent({ action: "FEEDBACK_FORM_UPDATED", actorUserId: context.userId, organisationId: context.organisation.id, targetType: "EventFeedbackForm", targetId: form.id, metadata: { eventId: context.event.id, isOpen: form.isOpen } });
  return { ok: true, data: { formId: form.id } };
}
const fieldSchema = base.extend({ fieldId: z.string().trim().min(1).optional(), key: z.string().trim().min(1).max(64).regex(/^[a-zA-Z0-9_]+$/), label: z.string().trim().min(1).max(200), type: z.nativeEnum(RegistrationFieldType), required: z.boolean(), options: z.array(z.string().trim().min(1).max(200)).max(50).default([]) });
export async function saveFeedbackField(input: unknown): Promise<ActionResult<{ fieldId: string }>> {
  const parsed = fieldSchema.safeParse(input); if (!parsed.success) return { ok: false, error: "Check the field details." };
  const context = await access(parsed.data); if (!context) return { ok: false, error: "Event not found." };
  const needsOptions = ["SELECT", "MULTI_SELECT", "RADIO"].includes(parsed.data.type);
  if (needsOptions && parsed.data.options.length === 0) return { ok: false, error: "Add at least one option." };
  try {
    const form = await prisma.eventFeedbackForm.upsert({ where: { eventId: context.event.id }, create: { eventId: context.event.id }, update: {} });
    if (parsed.data.fieldId) {
      const existing = await prisma.eventFeedbackField.findFirst({ where: { id: parsed.data.fieldId, formId: form.id } });
      if (!existing) return { ok: false, error: "Feedback field not found." };
      await prisma.eventFeedbackField.update({ where: { id: existing.id }, data: { key: parsed.data.key, label: parsed.data.label, type: parsed.data.type, required: parsed.data.required, options: needsOptions ? parsed.data.options : [] } });
      return { ok: true, data: { fieldId: existing.id } };
    }
    const maximum = await prisma.eventFeedbackField.aggregate({ where: { formId: form.id }, _max: { sortOrder: true } });
    const field = await prisma.eventFeedbackField.create({ data: { formId: form.id, key: parsed.data.key, label: parsed.data.label, type: parsed.data.type, required: parsed.data.required, options: needsOptions ? parsed.data.options : [], sortOrder: (maximum._max.sortOrder ?? 0) + 1 } });
    return { ok: true, data: { fieldId: field.id } };
  } catch (error: unknown) { if (typeof error === "object" && error !== null && "code" in error && (error as { code: string }).code === "P2002") return { ok: false, error: "That field key is already in use." }; return { ok: false, error: "Could not save field." }; }
}
export async function deleteFeedbackField(input: unknown): Promise<ActionResult<{ deleted: true }>> {
  const parsed = base.extend({ fieldId: z.string().trim().min(1) }).safeParse(input); if (!parsed.success) return { ok: false, error: "Invalid request." };
  const context = await access(parsed.data); if (!context) return { ok: false, error: "Event not found." };
  const field = await prisma.eventFeedbackField.findFirst({ where: { id: parsed.data.fieldId, form: { eventId: context.event.id } } });
  if (!field) return { ok: false, error: "Feedback field not found." }; await prisma.eventFeedbackField.delete({ where: { id: field.id } });
  return { ok: true, data: { deleted: true } };
}
