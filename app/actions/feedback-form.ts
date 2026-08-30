"use server";

import { RegistrationFieldType } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "@/app/actions/org";
import { prisma } from "@/lib/db";
import { requireOrgRole } from "@/lib/permissions";
import { recordAuditEvent } from "@/lib/audit";
import { isActionRateLimited } from "@/lib/actionRateLimit";

const base = z.object({ organisationSlug: z.string().trim().min(1).max(120), eventId: z.string().trim().min(1).max(128) });

async function access(input: { organisationSlug: string; eventId: string }) {
  const { organisation, userId } = await requireOrgRole(input.organisationSlug, "ADMIN");
  if (await isActionRateLimited("feedback", userId)) return { error: "Too many feedback form changes. Try again shortly." } as const;
  const event = await prisma.event.findFirst({ where: { id: input.eventId, organisationId: organisation.id }, select: { id: true, slug: true } });
  return event ? { organisation, userId, event } : null;
}

const feedbackPath = (orgSlug: string, eventSlug: string) => `/${orgSlug}/${eventSlug}/feedback`;
const feedbackFieldType = z.enum([
  RegistrationFieldType.TEXT,
  RegistrationFieldType.TEXTAREA,
  RegistrationFieldType.SELECT,
  RegistrationFieldType.MULTI_SELECT,
  RegistrationFieldType.RADIO,
  RegistrationFieldType.CHECKBOX,
  RegistrationFieldType.NUMBER,
]);

export async function saveFeedbackSettings(input: unknown): Promise<ActionResult<{ formId: string }>> {
  const parsed = base.extend({ isOpen: z.boolean(), title: z.string().trim().min(1).max(120), thankYouMessage: z.string().trim().min(1).max(500), certificateEnabled: z.boolean() }).strict().safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check the feedback settings." };
  const context = await access(parsed.data);
  if (!context || "error" in context) return { ok: false, error: context?.error ?? "Event not found." };
  const result = await prisma.$transaction(async (tx) => {
    const existing = await tx.eventFeedbackForm.findUnique({ where: { eventId: context.event.id }, select: { id: true } });
    if (existing) await tx.$queryRaw`SELECT "id" FROM "EventFeedbackForm" WHERE "id" = ${existing.id} FOR UPDATE`;
    if (parsed.data.isOpen) {
      if (!existing) return { error: "Add at least one feedback question before opening the form." } as const;
      const fieldCount = await tx.eventFeedbackField.count({ where: { formId: existing.id } });
      if (fieldCount === 0) return { error: "Add at least one feedback question before opening the form." } as const;
    }
    const saved = await tx.eventFeedbackForm.upsert({ where: { eventId: context.event.id }, create: { eventId: context.event.id, isOpen: parsed.data.isOpen, title: parsed.data.title, thankYouMessage: parsed.data.thankYouMessage, certificateEnabled: parsed.data.certificateEnabled }, update: { isOpen: parsed.data.isOpen, title: parsed.data.title, thankYouMessage: parsed.data.thankYouMessage, certificateEnabled: parsed.data.certificateEnabled } });
    await recordAuditEvent({ action: "FEEDBACK_FORM_UPDATED", actorUserId: context.userId, organisationId: context.organisation.id, targetType: "EventFeedbackForm", targetId: saved.id, metadata: { eventId: context.event.id, isOpen: saved.isOpen, certificateEnabled: saved.certificateEnabled }, client: tx });
    return { form: saved } as const;
  });
  if ("error" in result && typeof result.error === "string") return { ok: false, error: result.error };
  revalidatePath(feedbackPath(context.organisation.slug, context.event.slug));
  return { ok: true, data: { formId: result.form.id } };
}

const fieldSchema = base.extend({
  fieldId: z.string().trim().min(1).max(128).optional(), key: z.string().trim().min(1).max(64).regex(/^[a-zA-Z0-9_]+$/),
  label: z.string().trim().min(1).max(200), type: feedbackFieldType, required: z.boolean(),
  options: z.array(z.string().trim().min(1).max(200)).max(50).transform((items) => [...new Set(items)]).default([]),
}).strict();

export async function saveFeedbackField(input: unknown): Promise<ActionResult<{ fieldId: string }>> {
  const parsed = fieldSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check the field details." };
  const context = await access(parsed.data);
  if (!context || "error" in context) return { ok: false, error: context?.error ?? "Event not found." };
  const needsOptions = new Set<RegistrationFieldType>([RegistrationFieldType.SELECT, RegistrationFieldType.MULTI_SELECT, RegistrationFieldType.RADIO]).has(parsed.data.type);
  const nextOptions = needsOptions ? parsed.data.options : [];
  if (needsOptions && parsed.data.options.length === 0) return { ok: false, error: "Add at least one option." };
  try {
    const result = await prisma.$transaction(async (tx) => {
      const form = await tx.eventFeedbackForm.upsert({ where: { eventId: context.event.id }, create: { eventId: context.event.id }, update: {} });
      await tx.$queryRaw`SELECT "id" FROM "EventFeedbackForm" WHERE "id" = ${form.id} FOR UPDATE`;
      if (parsed.data.fieldId) {
        const existing = await tx.eventFeedbackField.findFirst({ where: { id: parsed.data.fieldId, formId: form.id }, include: { _count: { select: { answers: true } } } });
        if (!existing) return { error: "Feedback field not found." } as const;
        const oldOptions = Array.isArray(existing.options) ? existing.options.filter((value): value is string => typeof value === "string") : [];
        const semanticChange = existing.key !== parsed.data.key || existing.type !== parsed.data.type || JSON.stringify(oldOptions) !== JSON.stringify(nextOptions);
        if (existing._count.answers > 0 && semanticChange) return { error: "Answered feedback fields cannot change key, type, or options." } as const;
        const updated = await tx.eventFeedbackField.update({ where: { id: existing.id }, data: { key: parsed.data.key, label: parsed.data.label, type: parsed.data.type, required: parsed.data.required, options: nextOptions } });
        await recordAuditEvent({ action: "FEEDBACK_FIELD_UPDATED", actorUserId: context.userId, organisationId: context.organisation.id, targetType: "EventFeedbackField", targetId: updated.id, client: tx });
        return { fieldId: updated.id } as const;
      }
      const count = await tx.eventFeedbackField.count({ where: { formId: form.id } });
      if (count >= 100) return { error: "A feedback form can contain at most 100 fields." } as const;
      const maximum = await tx.eventFeedbackField.aggregate({ where: { formId: form.id }, _max: { sortOrder: true } });
      const field = await tx.eventFeedbackField.create({ data: { formId: form.id, key: parsed.data.key, label: parsed.data.label, type: parsed.data.type, required: parsed.data.required, options: nextOptions, sortOrder: (maximum._max.sortOrder ?? 0) + 1 } });
      await recordAuditEvent({ action: "FEEDBACK_FIELD_CREATED", actorUserId: context.userId, organisationId: context.organisation.id, targetType: "EventFeedbackField", targetId: field.id, client: tx });
      return { fieldId: field.id } as const;
    });
    if ("error" in result && typeof result.error === "string") return { ok: false, error: result.error };
    revalidatePath(feedbackPath(context.organisation.slug, context.event.slug));
    return { ok: true, data: result };
  } catch (error: unknown) {
    if (typeof error === "object" && error !== null && "code" in error && (error as { code: string }).code === "P2002") return { ok: false, error: "That field key is already in use." };
    return { ok: false, error: "Could not save field." };
  }
}

export async function deleteFeedbackField(input: unknown): Promise<ActionResult<{ deleted: true }>> {
  const parsed = base.extend({ fieldId: z.string().trim().min(1).max(128) }).strict().safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request." };
  const context = await access(parsed.data);
  if (!context || "error" in context) return { ok: false, error: context?.error ?? "Event not found." };
  const result = await prisma.$transaction(async (tx) => {
    const form = await tx.eventFeedbackForm.findUnique({ where: { eventId: context.event.id }, select: { id: true, isOpen: true } });
    if (!form) return { error: "Feedback field not found." } as const;
    await tx.$queryRaw`SELECT "id" FROM "EventFeedbackForm" WHERE "id" = ${form.id} FOR UPDATE`;
    const field = await tx.eventFeedbackField.findFirst({ where: { id: parsed.data.fieldId, formId: form.id }, include: { _count: { select: { answers: true } } } });
    if (!field) return { error: "Feedback field not found." } as const;
    if (field._count.answers > 0) return { error: "Answered feedback fields cannot be deleted." } as const;
    if (form.isOpen && await tx.eventFeedbackField.count({ where: { formId: form.id } }) <= 1) return { error: "Close the feedback form before deleting its last question." } as const;
    await tx.eventFeedbackField.delete({ where: { id: field.id } });
    await recordAuditEvent({ action: "FEEDBACK_FIELD_DELETED", actorUserId: context.userId, organisationId: context.organisation.id, targetType: "EventFeedbackField", targetId: field.id, client: tx });
    return { deleted: true } as const;
  });
  if ("error" in result && typeof result.error === "string") return { ok: false, error: result.error };
  revalidatePath(feedbackPath(context.organisation.slug, context.event.slug));
  return { ok: true, data: result };
}
