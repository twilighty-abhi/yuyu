import "server-only";

import { EventStatus, RegistrationFieldType, RsvpStatus } from "@prisma/client";
import crypto from "node:crypto";
import { z } from "zod";
import type { ActionResult } from "@/app/actions/org";
import { prisma } from "@/lib/db";

const submissionSchema = z.object({
  orgSlug: z.string().trim().min(1).max(120),
  eventSlug: z.string().trim().min(1).max(160),
  email: z.string().trim().email().max(320).optional(),
  answers: z.record(z.string().trim().min(1).max(64), z.unknown()).default({}),
}).strict().refine((value) => Object.keys(value.answers).length <= 100, { message: "Too many feedback answers." });

type AnswerRow = {
  fieldId: string;
  fieldKey: string;
  fieldLabel: string;
  fieldType: RegistrationFieldType;
  valueText?: string | null;
  valueBool?: boolean | null;
  valueNumber?: number | null;
  valueDate?: Date | null;
};

function optionsFromJson(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean)
    : [];
}

function validateAnswers(fields: Array<{ id: string; key: string; label: string; type: RegistrationFieldType; required: boolean; options: unknown }>, answers: Record<string, unknown>): { rows: AnswerRow[] } | { error: string } {
  const rows: AnswerRow[] = [];
  const fieldKeys = new Set(fields.map((field) => field.key));
  if (Object.keys(answers).some((key) => !fieldKeys.has(key))) return { error: "The feedback form has changed. Reload and try again." };
  for (const field of fields) {
    const raw = answers[field.key];
    const required = field.required;
    const text = typeof raw === "string" || typeof raw === "number" ? String(raw).trim() : "";
    if (field.type === "CHECKBOX") {
      if (raw !== undefined && raw !== true && raw !== false && raw !== "on") return { error: `${field.label} has an invalid value.` };
      const value = raw === true || raw === "on";
      if (required && !value) return { error: `${field.label} must be checked.` };
      if (raw !== undefined) rows.push({ fieldId: field.id, fieldKey: field.key, fieldLabel: field.label, fieldType: field.type, valueBool: value });
      continue;
    }
    if (field.type === "MULTI_SELECT") {
      if (raw !== undefined && !Array.isArray(raw)) return { error: `${field.label} has an invalid value.` };
      const rawValues = Array.isArray(raw) ? raw : [];
      if (rawValues.length > 50 || rawValues.some((value) => typeof value !== "string" || value.length > 200)) return { error: `${field.label} has too many or invalid options.` };
      const values = [...new Set(rawValues.map((value) => (value as string).trim()).filter(Boolean))];
      if (required && values.length === 0) return { error: `${field.label} is required.` };
      const options = optionsFromJson(field.options);
      if (values.some((value) => options.length > 0 && !options.includes(value))) return { error: `${field.label} contains an invalid option.` };
      rows.push(...values.map((value) => ({ fieldId: field.id, fieldKey: field.key, fieldLabel: field.label, fieldType: field.type, valueText: value })));
      continue;
    }
    if (raw !== undefined && (field.type === "NUMBER" ? typeof raw !== "string" && typeof raw !== "number" : typeof raw !== "string")) {
      return { error: `${field.label} has an invalid value.` };
    }
    if (field.type === "NUMBER") {
      if (!text) { if (required) return { error: `${field.label} is required.` }; continue; }
      if (text.length > 100) return { error: `${field.label} must be a number.` };
      const value = Number(text);
      if (!Number.isFinite(value) || Math.abs(value) > 1_000_000_000_000_000) return { error: `${field.label} must be a number.` };
      rows.push({ fieldId: field.id, fieldKey: field.key, fieldLabel: field.label, fieldType: field.type, valueNumber: value });
      continue;
    }
    if (field.type === "DATE") {
      if (!text) { if (required) return { error: `${field.label} is required.` }; continue; }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return { error: `${field.label} must be a valid date.` };
      const value = new Date(`${text}T00:00:00.000Z`);
      if (Number.isNaN(value.getTime()) || value.toISOString().slice(0, 10) !== text) return { error: `${field.label} must be a valid date.` };
      rows.push({ fieldId: field.id, fieldKey: field.key, fieldLabel: field.label, fieldType: field.type, valueDate: value });
      continue;
    }
    if (!text) { if (required) return { error: `${field.label} is required.` }; continue; }
    const maxTextLength = field.type === "TEXTAREA" ? 10_000 : field.type === "EMAIL" ? 320 : field.type === "PHONE" ? 40 : 500;
    if (text.length > maxTextLength) return { error: `${field.label} is too long.` };
    if (field.type === "EMAIL" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) return { error: `${field.label} must be a valid email.` };
    if (field.type === "PHONE" && !/^\+\d{8,15}$/.test(text.replace(/[()\s-]/g, ""))) return { error: `${field.label} must include a country code.` };
    if (field.type === "SELECT" || field.type === "RADIO") {
      const options = optionsFromJson(field.options);
      if (options.length > 0 && !options.includes(text)) return { error: `${field.label} must be one of the available options.` };
    }
    rows.push({ fieldId: field.id, fieldKey: field.key, fieldLabel: field.label, fieldType: field.type, valueText: field.type === "PHONE" ? text.replace(/[()\s-]/g, "") : text });
  }
  return { rows };
}

/** Submit repeatable anonymous feedback, optionally verifying an attendee for a certificate. */
export async function submitFeedback(input: unknown): Promise<ActionResult<{ certificateToken: string | null }>> {
  const parsed = submissionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Complete the feedback form and try again." };
  const event = await prisma.event.findFirst({
    where: { organisation: { slug: parsed.data.orgSlug }, slug: parsed.data.eventSlug, status: EventStatus.PUBLISHED },
    select: { id: true, feedbackForm: { select: { id: true } } },
  });
  if (!event?.feedbackForm) return { ok: false, error: "Feedback is not open for this event." };
  const formId = event.feedbackForm.id;
  try {
    return await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Event" WHERE "id" = ${event.id} FOR UPDATE`;
      await tx.$queryRaw`SELECT "id" FROM "EventFeedbackForm" WHERE "id" = ${formId} FOR UPDATE`;
      const currentEvent = await tx.event.findUnique({ where: { id: event.id }, select: { status: true } });
      const form = await tx.eventFeedbackForm.findUnique({
        where: { id: formId },
        include: { fields: { orderBy: { sortOrder: "asc" } } },
      });
      if (currentEvent?.status !== EventStatus.PUBLISHED || !form?.isOpen) return { ok: false, error: "Feedback is not open for this event." };
      const normalized = validateAnswers(form.fields, parsed.data.answers);
      if ("error" in normalized) return { ok: false, error: normalized.error };
      let rsvpId: string | null = null;
      if (form.certificateEnabled) {
        const email = parsed.data.email?.trim().toLowerCase();
        if (!email) return { ok: false, error: "Enter the email used for your confirmed registration." };
        const rsvp = await tx.rSVP.findFirst({
          where: {
            eventId: event.id,
            status: RsvpStatus.CONFIRMED,
            OR: [
              { guestEmail: { equals: email, mode: "insensitive" } },
              { user: { is: { email: { equals: email, mode: "insensitive" } } } },
            ],
          },
          select: { id: true },
        });
        if (!rsvp) return { ok: false, error: "Certificate verification failed." };
        rsvpId = rsvp.id;
      }
      const certificateToken = form.certificateEnabled ? crypto.randomBytes(32).toString("hex") : null;
      await tx.eventFeedbackResponse.create({
        data: {
          formId: form.id,
          rsvpId,
          certificateToken,
          answers: { create: normalized.rows },
        },
        select: { id: true },
      });
      return { ok: true, data: { certificateToken } };
    });
  } catch {
    console.error("[feedback] submission failed");
    return { ok: false, error: "Could not submit feedback. Please try again." };
  }
}
