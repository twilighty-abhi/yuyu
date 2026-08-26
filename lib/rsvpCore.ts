import {
  EventPrivacyType,
  EventStatus,
  Prisma,
  RegistrationFieldType,
  RsvpStatus,
} from "@prisma/client";
import { prisma } from "@/lib/db";
import { manualRsvpSchema, rsvpGuestSchema, rsvpLoggedInSchema } from "@/lib/validators";
import type { ActionResult } from "@/app/actions/org";
import { flattenZodErrors } from "@/app/actions/utils";
import { enqueueRsvpConfirmation } from "@/lib/outbox";

function normalizeGuestEmail(email: string) {
  return email.trim().toLowerCase();
}

function decideStatus(params: {
  capacity: number | null;
  confirmedCount: number;
  privacyType: EventPrivacyType;
}): RsvpStatus {
  const { capacity, confirmedCount, privacyType } = params;
  const full = capacity != null && confirmedCount >= capacity;

  if (full) {
    return RsvpStatus.WAITLISTED;
  }
  if (privacyType === EventPrivacyType.APPROVAL_REQUIRED) {
    return RsvpStatus.PENDING_APPROVAL;
  }
  return RsvpStatus.CONFIRMED;
}

type RsvpTarget = { eventId: string } | { eventInstanceId: string };

/**
 * Locks the event/occurrence row before counting confirmed attendees. This
 * serializes admissions for a capacity while retaining a database constraint
 * as the final duplicate-registration guard.
 */
async function reserveRsvp(params: {
  target: RsvpTarget;
  capacity: number | null;
  privacyType: EventPrivacyType;
  data: Omit<Prisma.RSVPUncheckedCreateInput, "status">;
  notification: { to: string; eventTitle: string };
  afterCreate?: (tx: Prisma.TransactionClient, rsvpId: string) => Promise<void>;
}) {
  return prisma.$transaction(async (tx) => {
    if ("eventId" in params.target) {
      await tx.$queryRaw`SELECT "id" FROM "Event" WHERE "id" = ${params.target.eventId} FOR UPDATE`;
    } else {
      await tx.$queryRaw`SELECT "id" FROM "EventInstance" WHERE "id" = ${params.target.eventInstanceId} FOR UPDATE`;
    }

    const confirmedCount = await tx.rSVP.count({
      where: {
        ...params.target,
        status: RsvpStatus.CONFIRMED,
      },
    });
    const status = decideStatus({
      capacity: params.capacity,
      confirmedCount,
      privacyType: params.privacyType,
    });
    const rsvp = await tx.rSVP.create({
      data: { ...params.data, status },
      select: { id: true, checkInToken: true },
    });
    await enqueueRsvpConfirmation(tx, {
      to: params.notification.to,
      eventTitle: params.notification.eventTitle,
      status,
      checkInToken: rsvp.checkInToken,
    });
    await params.afterCreate?.(tx, rsvp.id);
    const count = await tx.rSVP.count({ where: params.target });
    return { ...rsvp, status, count };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

async function resolveAttendeeEmail(
  userId: string | null,
  guestEmail: string | undefined,
): Promise<{ email: string } | { error: string }> {
  if (userId) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    if (!user?.email?.trim()) {
      return {
        error:
          "Your account needs an email address to RSVP to this event. Update your profile or use the guest form.",
      };
    }
    return { email: normalizeGuestEmail(user.email) };
  }
  if (guestEmail) {
    return { email: normalizeGuestEmail(guestEmail) };
  }
  return { error: "Email is required." };
}

function optionsFromJson(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is string => typeof x === "string")
    .map((s) => s.trim())
    .filter(Boolean);
}

function normalizeEmailBasic(v: string) {
  return v.trim().toLowerCase();
}

function isBasicEmail(v: string) {
  // Simple sanity check; not RFC-perfect by design.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

function normalizePhoneBasic(v: string) {
  // Keep leading +, strip spaces/dashes/parentheses.
  const s = v.trim().replace(/[()\s-]+/g, "");
  return s;
}

function isBasicE164(v: string) {
  // Basic: + then 8-15 digits (E.164 max 15 digits).
  return /^\+\d{8,15}$/.test(v);
}

function isValidAttendeeName(v: string) {
  return v.length <= 200 && /\p{L}/u.test(v);
}

function coerceFiniteNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function coerceDate(v: unknown): Date | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return null;
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function validateAndNormalizeAnswers(params: {
  fields: Array<{
    id: string;
    key: string;
    label: string;
    type: RegistrationFieldType;
    required: boolean;
    options: unknown;
  }>;
  answers: Record<string, unknown>;
}): { rows: Array<{
  fieldId: string;
  valueText?: string | null;
  valueBool?: boolean | null;
  valueNumber?: number | null;
  valueDate?: Date | null;
}> } | { error: string } {
  const { fields, answers } = params;

  const rows: Array<{
    fieldId: string;
    valueText?: string | null;
    valueBool?: boolean | null;
    valueNumber?: number | null;
    valueDate?: Date | null;
  }> = [];

  for (const f of fields) {
    const raw = answers[f.key];
    const hasValue = raw !== undefined && raw !== null;

    switch (f.type) {
      case RegistrationFieldType.TEXT: {
        const s = typeof raw === "string" ? raw.trim() : "";
        if (f.required && !s) return { error: `${f.label} is required.` };
        if (s.length > 200) return { error: `${f.label} must be at most 200 characters.` };
        if (s) rows.push({ fieldId: f.id, valueText: s });
        break;
      }
      case RegistrationFieldType.TEXTAREA: {
        const s = typeof raw === "string" ? raw.trim() : "";
        if (f.required && !s) return { error: `${f.label} is required.` };
        if (s.length > 5_000) return { error: `${f.label} must be at most 5,000 characters.` };
        if (s) rows.push({ fieldId: f.id, valueText: s });
        break;
      }
      case RegistrationFieldType.EMAIL: {
        const s = typeof raw === "string" ? normalizeEmailBasic(raw) : "";
        if (f.required && !s) return { error: `${f.label} is required.` };
        if (!s) break;
        if (!isBasicEmail(s)) return { error: `${f.label} must be a valid email.` };
        rows.push({ fieldId: f.id, valueText: s });
        break;
      }
      case RegistrationFieldType.PHONE: {
        const s = typeof raw === "string" ? normalizePhoneBasic(raw) : "";
        if (f.required && !s) return { error: `${f.label} is required.` };
        if (!s) break;
        if (!isBasicE164(s)) {
          return { error: `${f.label} must be a valid phone number (include country code).` };
        }
        rows.push({ fieldId: f.id, valueText: s });
        break;
      }
      case RegistrationFieldType.SELECT:
      case RegistrationFieldType.RADIO: {
        const opts = optionsFromJson(f.options);
        const s = typeof raw === "string" ? raw.trim() : "";
        if (f.required && !s) return { error: `${f.label} is required.` };
        if (!s) break;
        if (opts.length > 0 && !opts.includes(s)) {
          return { error: `${f.label} must be one of the available options.` };
        }
        rows.push({ fieldId: f.id, valueText: s });
        break;
      }
      case RegistrationFieldType.MULTI_SELECT: {
        const opts = optionsFromJson(f.options);
        const arr =
          Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : [];
        const picked = arr.map((s) => s.trim()).filter(Boolean);
        if (f.required && picked.length === 0) {
          return { error: `${f.label} is required.` };
        }
        for (const s of picked) {
          if (opts.length > 0 && !opts.includes(s)) {
            return { error: `${f.label} contains an invalid option.` };
          }
          rows.push({ fieldId: f.id, valueText: s });
        }
        break;
      }
      case RegistrationFieldType.CHECKBOX: {
        const b = typeof raw === "boolean" ? raw : raw === "on" ? true : false;
        if (f.required && !b) return { error: `${f.label} must be checked.` };
        if (hasValue) rows.push({ fieldId: f.id, valueBool: b });
        break;
      }
      case RegistrationFieldType.NUMBER: {
        if (!hasValue) {
          if (f.required) return { error: `${f.label} is required.` };
          break;
        }
        const n = coerceFiniteNumber(raw);
        if (n === null) return { error: `${f.label} must be a number.` };
        rows.push({ fieldId: f.id, valueNumber: n });
        break;
      }
      case RegistrationFieldType.DATE: {
        if (!hasValue) {
          if (f.required) return { error: `${f.label} is required.` };
          break;
        }
        const d = coerceDate(raw);
        if (!d) return { error: `${f.label} must be a valid date.` };
        rows.push({ fieldId: f.id, valueDate: d });
        break;
      }
      default: {
        return { error: "Unsupported field type." };
      }
    }
  }

  return { rows };
}

export async function submitRsvpCore(
  input: unknown,
  opts: { userId: string | null },
): Promise<ActionResult<{ count: number; status: RsvpStatus; ticketToken: string }>> {
  const userId = opts.userId;

  if (userId) {
    const parsed = rsvpLoggedInSchema.safeParse(input);
    if (!parsed.success) {
      return {
        ok: false,
        error: "Invalid input.",
        fieldErrors: flattenZodErrors(parsed.error),
      };
    }
    const { orgSlug, eventSlug, eventInstanceId } = parsed.data;

    const org = await prisma.organisation.findUnique({
      where: { slug: orgSlug },
    });
    if (!org) return { ok: false, error: "Event not found." };

    if (eventInstanceId) {
      return submitInstanceRsvp({
        org,
        eventInstanceId,
        userId,
        guestEmail: null,
        name: parsed.data.name ?? null,
      });
    }

    if (!eventSlug) {
      return { ok: false, error: "Event not found." };
    }

    const event = await prisma.event.findUnique({
      where: {
        organisationId_slug: { organisationId: org.id, slug: eventSlug },
      },
    });
    if (
      !event ||
      event.status !== EventStatus.PUBLISHED ||
      event.endDateTime <= new Date()
    ) {
      return { ok: false, error: "This event is not open for RSVP." };
    }

    const emailRes = await resolveAttendeeEmail(userId, undefined);
    if ("error" in emailRes) return { ok: false, error: emailRes.error };

    if (event.privacyType === EventPrivacyType.INVITE_ONLY) {
      const ok = await prisma.eventInvite.findUnique({
        where: {
          eventId_email: { eventId: event.id, email: emailRes.email },
        },
      });
      if (!ok) {
        return {
          ok: false,
          error: "This event is invite-only. Use the email you were invited with.",
        };
      }
    }

    const attendeeKey = `user:${userId}`;

    try {
      const form = await prisma.eventRegistrationForm.findUnique({
        where: { eventId: event.id },
        include: { fields: { orderBy: { sortOrder: "asc" } } },
      });
      const fields = form?.fields ?? [];

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { name: true },
      });
      const existingName = user?.name?.trim() ?? "";
      const submittedName =
        typeof parsed.data.name === "string" ? parsed.data.name.trim() : "";
      if (!existingName && !submittedName) {
        return { ok: false, error: "Name is required." };
      }
      if (!isValidAttendeeName(submittedName || existingName)) {
        return { ok: false, error: "Enter a valid name." };
      }

      const answers = parsed.data.answers ?? {};
      const validated = validateAndNormalizeAnswers({
        fields: fields.map((f) => ({
          id: f.id,
          key: f.key,
          label: f.label,
          type: f.type,
          required: f.required,
          options: f.options,
        })),
        answers: answers as Record<string, unknown>,
      });
      if ("error" in validated) return { ok: false, error: validated.error };

      const reservation = await reserveRsvp({
        target: { eventId: event.id },
        capacity: event.capacity,
        privacyType: event.privacyType,
        notification: { to: emailRes.email, eventTitle: event.title },
        data: {
            eventId: event.id,
            userId,
            guestEmail: null,
            attendeeKey,
          },
        afterCreate: async (tx, rsvpId) => {
          if (!existingName && submittedName) {
            await tx.user.update({
            where: { id: userId },
            data: { name: submittedName },
          });
          }
          if (validated.rows.length > 0) {
            await tx.rsvpAnswer.createMany({
            data: validated.rows.map((row) => ({
              rsvpId,
              fieldId: row.fieldId,
              valueText: row.valueText ?? null,
              valueBool: row.valueBool ?? null,
              valueNumber: row.valueNumber ?? null,
              valueDate: row.valueDate ?? null,
            })),
          });
          }
        },
      });

      return {
        ok: true,
        data: { count: reservation.count, status: reservation.status, ticketToken: reservation.checkInToken },
      };
    } catch (e: unknown) {
      if (
        typeof e === "object" &&
        e !== null &&
        "code" in e &&
        (e as { code: string }).code === "P2002"
      ) {
        return { ok: false, error: "You have already RSVP’d for this event." };
      }
      console.error(e);
      return { ok: false, error: "Could not save your RSVP." };
    }
  }

  const parsed = rsvpGuestSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Invalid input.",
      fieldErrors: flattenZodErrors(parsed.error),
    };
  }

  const { orgSlug, eventSlug, eventInstanceId, guestEmail } = parsed.data;
  const emailNorm = normalizeGuestEmail(guestEmail);

  const org = await prisma.organisation.findUnique({
    where: { slug: orgSlug },
  });
  if (!org) return { ok: false, error: "Event not found." };

  if (eventInstanceId) {
    return submitInstanceRsvp({
      org,
      eventInstanceId,
      userId: null,
      guestEmail: emailNorm,
      guestName: parsed.data.name,
    });
  }

  if (!eventSlug) {
    return { ok: false, error: "Event not found." };
  }

  const event = await prisma.event.findUnique({
    where: {
      organisationId_slug: { organisationId: org.id, slug: eventSlug },
    },
  });
  if (
    !event ||
    event.status !== EventStatus.PUBLISHED ||
    event.endDateTime <= new Date()
  ) {
    return { ok: false, error: "This event is not open for RSVP." };
  }

  if (event.privacyType === EventPrivacyType.INVITE_ONLY) {
    // A guest can assert any email address. Invite-only registration therefore
    // requires an authenticated account; do not issue bearer ticket tokens
    // solely because an entered address appears on an invite list.
    return { ok: false, error: "This event is invite-only. Sign in with the invited account to register." };
  }

  const attendeeKey = `guest:${emailNorm}`;

  try {
    const form = await prisma.eventRegistrationForm.findUnique({
      where: { eventId: event.id },
      include: { fields: { orderBy: { sortOrder: "asc" } } },
    });
    const fields = form?.fields ?? [];

    const validated = validateAndNormalizeAnswers({
      fields: fields.map((f) => ({
        id: f.id,
        key: f.key,
        label: f.label,
        type: f.type,
        required: f.required,
        options: f.options,
      })),
      answers: parsed.data.answers as Record<string, unknown>,
    });
    if ("error" in validated) return { ok: false, error: validated.error };

    const reservation = await reserveRsvp({
      target: { eventId: event.id },
      capacity: event.capacity,
      privacyType: event.privacyType,
      notification: { to: emailNorm, eventTitle: event.title },
      data: {
          eventId: event.id,
          userId: null,
          guestEmail: emailNorm,
          guestName: parsed.data.name.trim(),
          attendeeKey,
        },
      afterCreate: async (tx, rsvpId) => {
        if (validated.rows.length > 0) {
          await tx.rsvpAnswer.createMany({
          data: validated.rows.map((row) => ({
            rsvpId,
            fieldId: row.fieldId,
            valueText: row.valueText ?? null,
            valueBool: row.valueBool ?? null,
            valueNumber: row.valueNumber ?? null,
            valueDate: row.valueDate ?? null,
          })),
        });
        }
      },
    });

    return {
      ok: true,
      data: { count: reservation.count, status: reservation.status, ticketToken: reservation.checkInToken },
    };
  } catch (e: unknown) {
    if (
      typeof e === "object" &&
      e !== null &&
      "code" in e &&
      (e as { code: string }).code === "P2002"
    ) {
      return {
        ok: false,
        error: "This email is already registered for this event.",
      };
    }
    console.error(e);
    return { ok: false, error: "Could not save your RSVP." };
  }
}

/**
 * Creates a guest RSVP on behalf of an authorised event administrator. Unlike
 * the public flow, this can register someone for a draft, ended, or invite-only
 * event; capacity, waitlist, approval, duplicate, form-answer, and ticket
 * rules remain owned by the same RSVP service.
 */
export async function submitManualGuestRsvpCore(
  input: unknown,
  opts: { organisationId: string },
): Promise<ActionResult<{ count: number; status: RsvpStatus; rsvpId: string }>> {
  const parsed = manualRsvpSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Invalid input.",
      fieldErrors: flattenZodErrors(parsed.error),
    };
  }

  const event = await prisma.event.findFirst({
    where: { id: parsed.data.eventId, organisationId: opts.organisationId },
  });
  if (!event) return { ok: false, error: "Event not found." };

  const email = normalizeGuestEmail(parsed.data.guestEmail);
  const form = await prisma.eventRegistrationForm.findUnique({
    where: { eventId: event.id },
    include: { fields: { orderBy: { sortOrder: "asc" } } },
  });
  const validated = validateAndNormalizeAnswers({
    fields: (form?.fields ?? []).map((field) => ({
      id: field.id,
      key: field.key,
      label: field.label,
      type: field.type,
      required: field.required,
      options: field.options,
    })),
    answers: parsed.data.answers as Record<string, unknown>,
  });
  if ("error" in validated) return { ok: false, error: validated.error };

  try {
    const reservation = await reserveRsvp({
      target: { eventId: event.id },
      capacity: event.capacity,
      privacyType: event.privacyType,
      notification: { to: email, eventTitle: event.title },
      data: {
        eventId: event.id,
        userId: null,
        guestEmail: email,
        guestName: parsed.data.name.trim(),
        attendeeKey: `guest:${email}`,
      },
      afterCreate: async (tx, rsvpId) => {
        if (validated.rows.length === 0) return;
        await tx.rsvpAnswer.createMany({
          data: validated.rows.map((row) => ({
            rsvpId,
            fieldId: row.fieldId,
            valueText: row.valueText ?? null,
            valueBool: row.valueBool ?? null,
            valueNumber: row.valueNumber ?? null,
            valueDate: row.valueDate ?? null,
          })),
        });
      },
    });
    return {
      ok: true,
      data: {
        count: reservation.count,
        status: reservation.status,
        rsvpId: reservation.id,
      },
    };
  } catch (error: unknown) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code: string }).code === "P2002"
    ) {
      return { ok: false, error: "This email is already registered for this event." };
    }
    console.error(error);
    return { ok: false, error: "Could not save the attendee RSVP." };
  }
}

async function submitInstanceRsvp(params: {
  org: { id: string; slug: string };
  eventInstanceId: string;
  userId: string | null;
  guestEmail: string | null;
  guestName?: string | null;
  name?: string | null;
}): Promise<ActionResult<{ count: number; status: RsvpStatus; ticketToken: string }>> {
  const { org, eventInstanceId, userId } = params;

  const instance = await prisma.eventInstance.findFirst({
    where: { id: eventInstanceId },
    include: {
      series: true,
    },
  });
  if (!instance || instance.series.organisationId !== org.id) {
    return { ok: false, error: "Event not found." };
  }

  if (
    instance.series.status !== EventStatus.PUBLISHED ||
    instance.endDateTime <= new Date()
  ) {
    return { ok: false, error: "This event is not open for RSVP." };
  }

  const series = instance.series;
  const emailRes = userId
    ? await resolveAttendeeEmail(userId, undefined)
    : { email: params.guestEmail! };

  if ("error" in emailRes) return { ok: false, error: emailRes.error };

  if (series.privacyType === EventPrivacyType.INVITE_ONLY) {
    if (!userId) {
      return { ok: false, error: "This event is invite-only. Sign in with the invited account to register." };
    }
    const ok = await prisma.seriesInvite.findUnique({
      where: {
        eventSeriesId_email: {
          eventSeriesId: series.id,
          email: emailRes.email,
        },
      },
    });
    if (!ok) {
      return {
        ok: false,
        error: "This event is invite-only. Use the email you were invited with.",
      };
    }
  }

  const attendeeKey = userId
    ? `user:${userId}`
    : `guest:${emailRes.email}`;

  try {
    let reservation: Awaited<ReturnType<typeof reserveRsvp>>;
    if (userId) {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { name: true },
      });
      const existingName = user?.name?.trim() ?? "";
      const submittedName = params.name?.trim() ?? "";
      if (!existingName && !submittedName) {
        return { ok: false, error: "Name is required." };
      }
      if (!isValidAttendeeName(submittedName || existingName)) {
        return { ok: false, error: "Enter a valid name." };
      }

      reservation = await reserveRsvp({
        target: { eventInstanceId: instance.id },
        capacity: series.capacity,
        privacyType: series.privacyType,
        notification: { to: emailRes.email, eventTitle: series.title },
        data: {
            eventInstanceId: instance.id,
            userId,
            guestEmail: null,
            attendeeKey,
          },
        afterCreate: async (tx) => {
          if (!existingName && submittedName) {
            await tx.user.update({
            where: { id: userId },
            data: { name: submittedName },
          });
          }
        },
      });
    } else {
      const guestName = params.guestName?.trim() ?? "";
      if (!guestName) return { ok: false, error: "Name is required." };
      if (!isValidAttendeeName(guestName)) {
        return { ok: false, error: "Enter a valid name." };
      }
      reservation = await reserveRsvp({
        target: { eventInstanceId: instance.id },
        capacity: series.capacity,
        privacyType: series.privacyType,
        notification: { to: emailRes.email, eventTitle: series.title },
        data: {
          eventInstanceId: instance.id,
          userId: null,
          guestEmail: emailRes.email,
          guestName,
          attendeeKey,
        },
      });
    }

    return {
      ok: true,
      data: { count: reservation.count, status: reservation.status, ticketToken: reservation.checkInToken },
    };
  } catch (e: unknown) {
    if (
      typeof e === "object" &&
      e !== null &&
      "code" in e &&
      (e as { code: string }).code === "P2002"
    ) {
      return { ok: false, error: "You have already RSVP’d for this event." };
    }
    console.error(e);
    return { ok: false, error: "Could not save your RSVP." };
  }
}
