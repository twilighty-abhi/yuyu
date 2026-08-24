import "server-only";

import { EventStatus, RegistrationFieldType, RsvpStatus } from "@prisma/client";
import { z } from "zod";
import type { ActionResult } from "@/app/actions/org";
import { prisma } from "@/lib/db";

const submissionSchema = z.object({
  orgSlug: z.string().trim().min(1).max(120),
  eventSlug: z.string().trim().min(1).max(160),
  email: z.string().trim().email().max(320),
  answers: z.record(z.string(), z.unknown()).default({}),
});

type AnswerRow = {
  fieldId: string;
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
  for (const field of fields) {
    const raw = answers[field.key];
    const required = field.required;
    const text = typeof raw === "string" ? raw.trim() : "";
    if (field.type === "CHECKBOX") {
      const value = raw === true || raw === "on";
      if (required && !value) return { error: `${field.label} must be checked.` };
      if (raw !== undefined) rows.push({ fieldId: field.id, valueBool: value });
      continue;
    }
    if (field.type === "MULTI_SELECT") {
      const values = Array.isArray(raw) ? raw.filter((v): v is string => typeof v === "string").map((v) => v.trim()).filter(Boolean) : [];
      if (required && values.length === 0) return { error: `${field.label} is required.` };
      const options = optionsFromJson(field.options);
      if (values.some((value) => options.length > 0 && !options.includes(value))) return { error: `${field.label} contains an invalid option.` };
      rows.push(...values.map((value) => ({ fieldId: field.id, valueText: value })));
      continue;
    }
    if (field.type === "NUMBER") {
      if (!text) { if (required) return { error: `${field.label} is required.` }; continue; }
      const value = Number(text);
      if (!Number.isFinite(value)) return { error: `${field.label} must be a number.` };
      rows.push({ fieldId: field.id, valueNumber: value });
      continue;
    }
    if (field.type === "DATE") {
      if (!text) { if (required) return { error: `${field.label} is required.` }; continue; }
      const value = new Date(text);
      if (Number.isNaN(value.getTime())) return { error: `${field.label} must be a valid date.` };
      rows.push({ fieldId: field.id, valueDate: value });
      continue;
    }
    if (!text) { if (required) return { error: `${field.label} is required.` }; continue; }
    if (field.type === "EMAIL" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) return { error: `${field.label} must be a valid email.` };
    if (field.type === "PHONE" && !/^\+\d{8,15}$/.test(text.replace(/[()\s-]/g, ""))) return { error: `${field.label} must include a country code.` };
    if (field.type === "SELECT" || field.type === "RADIO") {
      const options = optionsFromJson(field.options);
      if (options.length > 0 && !options.includes(text)) return { error: `${field.label} must be one of the available options.` };
    }
    rows.push({ fieldId: field.id, valueText: field.type === "PHONE" ? text.replace(/[()\s-]/g, "") : text });
  }
  return { rows };
}

/** Submit anonymous feedback only for a confirmed RSVP matched by email. */
export async function submitFeedback(input: unknown): Promise<ActionResult<{ certificateToken: string | null }>> {
  const parsed = submissionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Enter a valid registered email and complete the form." };
  const email = parsed.data.email.trim().toLowerCase();
  const event = await prisma.event.findFirst({
    where: { organisation: { slug: parsed.data.orgSlug }, slug: parsed.data.eventSlug, status: EventStatus.PUBLISHED },
    include: { feedbackForm: { include: { fields: { orderBy: { sortOrder: "asc" } } } } },
  });
  if (!event?.feedbackForm?.isOpen) return { ok: false, error: "Feedback is not open for this event." };
  const normalized = validateAnswers(event.feedbackForm.fields, parsed.data.answers);
  if ("error" in normalized) return { ok: false, error: normalized.error };
  const rsvp = await prisma.rSVP.findFirst({
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
  if (!rsvp) return { ok: false, error: "No confirmed registration was found for that email." };
  try {
    const response = await prisma.eventFeedbackResponse.create({
      data: {
        formId: event.feedbackForm.id,
        rsvpId: rsvp.id,
        answers: { create: normalized.rows.map((row) => ({ ...row })) },
      },
      select: { certificateToken: true },
    });
    return { ok: true, data: { certificateToken: event.feedbackForm.certificateEnabled ? response.certificateToken : null } };
  } catch (error: unknown) {
    if (typeof error === "object" && error !== null && "code" in error && (error as { code: string }).code === "P2002") {
      return { ok: false, error: "Feedback has already been submitted for this registration." };
    }
    console.error("Could not submit feedback", error);
    return { ok: false, error: "Could not submit feedback. Please try again." };
  }
}
