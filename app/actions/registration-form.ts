"use server";

import { z } from "zod";
import { RegistrationFieldType } from "@prisma/client";
import type { ActionResult } from "@/app/actions/org";
import { flattenZodErrors } from "@/app/actions/utils";
import { prisma } from "@/lib/db";
import { requireOrgRole } from "@/lib/permissions";
import { recordAuditEvent } from "@/lib/audit";

const upsertFieldSchema = z.object({
  organisationSlug: z.string().trim().min(1),
  eventId: z.string().trim().min(1),
  fieldId: z.string().trim().min(1).optional(),
  key: z
    .string()
    .trim()
    .min(1, "Key is required")
    .max(64)
    .regex(/^[a-zA-Z0-9_]+$/, "Use letters, numbers, and underscores only"),
  label: z.string().trim().min(1, "Label is required").max(200),
  type: z.nativeEnum(RegistrationFieldType),
  required: z.preprocess(
    (v) => v === true || v === "true" || v === "on",
    z.boolean(),
  ),
  options: z.preprocess((v) => {
    if (Array.isArray(v)) return v;
    if (typeof v === "string") {
      return v
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    }
    return [];
  }, z.array(z.string().trim().min(1).max(200))).optional().default([]),
});

export async function upsertEventRegistrationField(
  input: unknown,
): Promise<ActionResult<{ fieldId: string }>> {
  const parsed = upsertFieldSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Invalid input.",
      fieldErrors: flattenZodErrors(parsed.error),
    };
  }

  const { organisationSlug, eventId, fieldId, key, label, type, required } =
    parsed.data;
  const options = parsed.data.options ?? [];

  const { organisation, userId } = await requireOrgRole(organisationSlug, "ADMIN");
  const event = await prisma.event.findFirst({
    where: { id: eventId, organisationId: organisation.id },
    select: { id: true },
  });
  if (!event) return { ok: false, error: "Event not found." };

  const needsOptions =
    type === RegistrationFieldType.SELECT ||
    type === RegistrationFieldType.MULTI_SELECT ||
    type === RegistrationFieldType.RADIO;
  if (needsOptions && options.length === 0) {
    return { ok: false, error: "Options are required for this field type." };
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const form = await tx.eventRegistrationForm.upsert({
        where: { eventId: event.id },
        create: { eventId: event.id },
        update: {},
        select: { id: true },
      });

      if (fieldId) {
        const updated = await tx.eventRegistrationField.update({
          where: { id: fieldId },
          data: {
            key,
            label,
            type,
            required,
            options: needsOptions ? options : [],
          },
          select: { id: true, formId: true },
        });
        if (updated.formId !== form.id) {
          throw new Error("Field does not belong to this event.");
        }
        return updated;
      }

      const max = await tx.eventRegistrationField.aggregate({
        where: { formId: form.id },
        _max: { sortOrder: true },
      });
      const sortOrder = (max._max.sortOrder ?? 0) + 1;

      return await tx.eventRegistrationField.create({
        data: {
          formId: form.id,
          key,
          label,
          type,
          required,
          sortOrder,
          options: needsOptions ? options : [],
        },
        select: { id: true, formId: true },
      });
    });

    await recordAuditEvent({
      action: fieldId ? "REGISTRATION_FIELD_UPDATED" : "REGISTRATION_FIELD_CREATED",
      actorUserId: userId,
      organisationId: organisation.id,
      targetType: "EventRegistrationField",
      targetId: result.id,
      metadata: { eventId },
    });

    return { ok: true, data: { fieldId: result.id } };
  } catch (e: unknown) {
    if (
      typeof e === "object" &&
      e !== null &&
      "code" in e &&
      (e as { code: string }).code === "P2002"
    ) {
      return { ok: false, error: "That field key is already in use." };
    }
    console.error(e);
    return { ok: false, error: "Could not save field." };
  }
}

const deleteFieldSchema = z.object({
  organisationSlug: z.string().trim().min(1),
  eventId: z.string().trim().min(1),
  fieldId: z.string().trim().min(1),
});

export async function deleteEventRegistrationField(
  input: unknown,
): Promise<ActionResult<{ ok: true }>> {
  const parsed = deleteFieldSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Invalid input.",
      fieldErrors: flattenZodErrors(parsed.error),
    };
  }

  const { organisationSlug, eventId, fieldId } = parsed.data;
  const { organisation, userId } = await requireOrgRole(organisationSlug, "ADMIN");

  const event = await prisma.event.findFirst({
    where: { id: eventId, organisationId: organisation.id },
    select: { id: true },
  });
  if (!event) return { ok: false, error: "Event not found." };

  const form = await prisma.eventRegistrationForm.findUnique({
    where: { eventId: event.id },
    select: { id: true },
  });
  if (!form) return { ok: false, error: "Registration form not found." };

  const field = await prisma.eventRegistrationField.findUnique({
    where: { id: fieldId },
    select: { id: true, formId: true },
  });
  if (!field || field.formId !== form.id) {
    return { ok: false, error: "Field not found." };
  }

  await prisma.eventRegistrationField.delete({ where: { id: fieldId } });
  await recordAuditEvent({ action: "REGISTRATION_FIELD_DELETED", actorUserId: userId, organisationId: organisation.id, targetType: "EventRegistrationField", targetId: fieldId, metadata: { eventId } });
  return { ok: true, data: { ok: true } };
}

const reorderSchema = z.object({
  organisationSlug: z.string().trim().min(1),
  eventId: z.string().trim().min(1),
  fieldIds: z.array(z.string().trim().min(1)).min(1),
});

export async function reorderEventRegistrationFields(
  input: unknown,
): Promise<ActionResult<{ ok: true }>> {
  const parsed = reorderSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Invalid input.",
      fieldErrors: flattenZodErrors(parsed.error),
    };
  }

  const { organisationSlug, eventId, fieldIds } = parsed.data;
  const { organisation, userId } = await requireOrgRole(organisationSlug, "ADMIN");

  const event = await prisma.event.findFirst({
    where: { id: eventId, organisationId: organisation.id },
    select: { id: true },
  });
  if (!event) return { ok: false, error: "Event not found." };

  const form = await prisma.eventRegistrationForm.findUnique({
    where: { eventId: event.id },
    select: { id: true },
  });
  if (!form) return { ok: false, error: "Registration form not found." };

  const existing = await prisma.eventRegistrationField.findMany({
    where: { formId: form.id },
    select: { id: true },
  });
  const existingSet = new Set(existing.map((f) => f.id));
  for (const id of fieldIds) {
    if (!existingSet.has(id)) {
      return { ok: false, error: "Invalid field list." };
    }
  }

  await prisma.$transaction(
    fieldIds.map((id, idx) =>
      prisma.eventRegistrationField.update({
        where: { id },
        data: { sortOrder: idx + 1 },
      }),
    ),
  );

  await recordAuditEvent({ action: "REGISTRATION_FIELDS_REORDERED", actorUserId: userId, organisationId: organisation.id, targetType: "Event", targetId: eventId, metadata: { fields: fieldIds.length } });

  return { ok: true, data: { ok: true } };
}
