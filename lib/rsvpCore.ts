import {
  EventPrivacyType,
  EventStatus,
  Prisma,
  RegistrationFieldType,
  RegistrationMode,
  RsvpStatus,
  SoloPolicy,
} from "@prisma/client";
import { prisma } from "@/lib/db";
import { DEFAULT_MAX_LENGTH, OTHER_MAX_LENGTH, parseFieldSettings, visibleFieldKeys } from "@/lib/registrationFields";
import {
  isValidAttendeeName,
  manualRsvpSchema,
  rsvpGuestSchema,
  rsvpLoggedInSchema,
  teamNameKey,
  type TeamRegistrationIntent,
} from "@/lib/validators";
import type { ActionResult } from "@/app/actions/org";
import { flattenZodErrors } from "@/app/actions/utils";
import { enqueueRsvpConfirmation, enqueueTeamCreated } from "@/lib/outbox";
import { countConfirmedUnits } from "@/lib/teamUnits";
import { generateTeamManageToken, generateTeamToken } from "@/lib/teamToken";
import { isRegistrationClosed } from "@/lib/registrationCutoff";
import {
  isValidInternationalPhone,
  normalizeInternationalPhone,
  phoneValidationMessage,
} from "@/lib/phone";

function normalizeGuestEmail(email: string) {
  return email.trim().toLowerCase();
}

class RsvpTargetClosedError extends Error {}

function isRsvpTargetClosedError(error: unknown): error is RsvpTargetClosedError {
  return error instanceof RsvpTargetClosedError;
}

/** A team rule refused the registration; the message is safe to show. */
export class TeamRegistrationError extends Error {
  constructor(message: string, readonly code?: "TEAM_REQUIRED") {
    super(message);
  }
}

function teamRegistrationFailure(error: TeamRegistrationError): { ok: false; error: string; code?: "TEAM_REQUIRED" } {
  return error.code ? { ok: false, error: error.message, code: error.code } : { ok: false, error: error.message };
}

function isUniqueViolationOn(error: unknown, column: string) {
  if (typeof error !== "object" || error === null || (error as { code?: string }).code !== "P2002") return false;
  const target = (error as { meta?: { target?: unknown } }).meta?.target;
  return Array.isArray(target) ? target.includes(column) : typeof target === "string" && target.includes(column);
}

export function decideRsvpStatus(params: {
  capacity: number | null;
  confirmedCount: number;
  privacyType: EventPrivacyType;
}): RsvpStatus {
  const { capacity, confirmedCount, privacyType } = params;
  const full = capacity != null && confirmedCount >= capacity;

  if (privacyType === EventPrivacyType.APPROVAL_REQUIRED) {
    return RsvpStatus.PENDING_APPROVAL;
  }
  if (full) {
    return RsvpStatus.WAITLISTED;
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
  enforceOpen?: boolean;
  /** How to register on a TEAM event; omitted means solo. Ignored for INDIVIDUAL events except that team intents are refused. */
  team?: TeamRegistrationIntent;
  /** Organiser manual add: a solo registration is allowed even on a TEAMS_ONLY event. */
  allowSoloWithoutTeam?: boolean;
}) {
  return prisma.$transaction(async (tx) => {
    let capacity = params.capacity;
    let privacyType = params.privacyType;
    let teamEvent: { registrationMode: RegistrationMode; teamMaxSize: number | null; soloPolicy: SoloPolicy } | null = null;
    if ("eventId" in params.target) {
      await tx.$queryRaw`SELECT "id" FROM "Event" WHERE "id" = ${params.target.eventId} FOR UPDATE`;
      const current = await tx.event.findUnique({
        where: { id: params.target.eventId },
        select: { capacity: true, privacyType: true, status: true, endDateTime: true, registrationClosesAt: true, registrationLeadMinutes: true, startDateTime: true, registrationMode: true, teamMaxSize: true, soloPolicy: true, page: { select: { isPublished: true } } },
      });
      if (!current) throw new RsvpTargetClosedError();
      if (params.enforceOpen !== false && (current.status !== EventStatus.PUBLISHED || current.page?.isPublished !== true || current.endDateTime <= new Date() || isRegistrationClosed(current))) throw new RsvpTargetClosedError();
      capacity = current.capacity;
      privacyType = current.privacyType;
      if (current.registrationMode === RegistrationMode.TEAM) teamEvent = current;
    } else {
      await tx.$queryRaw`
        SELECT i."id" FROM "EventSeries" s
        INNER JOIN "EventInstance" i ON i."eventSeriesId" = s."id"
        WHERE i."id" = ${params.target.eventInstanceId}
        FOR UPDATE OF s, i
      `;
      const current = await tx.eventInstance.findUnique({ where: { id: params.target.eventInstanceId }, select: { endDateTime: true, series: { select: { capacity: true, privacyType: true, status: true } } } });
      if (!current) throw new RsvpTargetClosedError();
      if (params.enforceOpen !== false && (current.series.status !== EventStatus.PUBLISHED || current.endDateTime <= new Date())) throw new RsvpTargetClosedError();
      capacity = current.series.capacity;
      privacyType = current.series.privacyType;
    }

    const intent = params.team;
    if (!teamEvent) {
      if (intent && intent.mode !== "solo") throw new TeamRegistrationError("This event does not use team registration.");
      const confirmedCount = await tx.rSVP.count({
        where: {
          ...params.target,
          status: RsvpStatus.CONFIRMED,
        },
      });
      const status = decideRsvpStatus({
        capacity,
        confirmedCount,
        privacyType,
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
      return { ...rsvp, status, count, teamId: null as string | null };
    }

    // TEAM event (docs/TEAMS.md): capacity counts units, still under the
    // Event row lock taken above, so team creation never oversells.
    const eventId = (params.target as { eventId: string }).eventId;
    let status: RsvpStatus;
    let team: { id: string; name: string } | null = null;
    let newTeamManageToken: string | null = null;
    if (!intent || intent.mode === "solo") {
      if (teamEvent.soloPolicy === SoloPolicy.TEAMS_ONLY && !params.allowSoloWithoutTeam) {
        throw new TeamRegistrationError("This event registers teams only. Create a team or join one with a team link.", "TEAM_REQUIRED");
      }
      status = decideRsvpStatus({ capacity, confirmedCount: await countConfirmedUnits(tx, eventId), privacyType });
    } else if (intent.mode === "create") {
      const nameKey = teamNameKey(intent.name);
      const taken = await tx.team.findUnique({ where: { eventId_nameKey: { eventId, nameKey } }, select: { id: true } });
      if (taken) throw new TeamRegistrationError("That team name is already taken for this event.");
      status = decideRsvpStatus({ capacity, confirmedCount: await countConfirmedUnits(tx, eventId), privacyType });
      const manage = generateTeamManageToken();
      team = await tx.team.create({
        data: { eventId, name: intent.name, nameKey, status, joinToken: generateTeamToken(), manageTokenHash: manage.hash },
        select: { id: true, name: true },
      });
      newTeamManageToken = manage.raw;
    } else {
      const joined = await tx.team.findFirst({
        where: { joinToken: intent.joinToken, eventId },
        select: { id: true, name: true, status: true },
      });
      if (!joined) throw new TeamRegistrationError("This team link is no longer valid. Ask your team leader for a new one.");
      if (joined.status === RsvpStatus.REJECTED) throw new TeamRegistrationError("This team can no longer be joined.");
      const size = await tx.rSVP.count({ where: { teamId: joined.id } });
      if (teamEvent.teamMaxSize == null || size >= teamEvent.teamMaxSize) throw new TeamRegistrationError("This team is already full.");
      // Joining never changes capacity: the member takes the team's status.
      status = joined.status;
      team = { id: joined.id, name: joined.name };
    }
    const rsvp = await tx.rSVP.create({
      data: { ...params.data, status, teamId: team?.id ?? null },
      select: { id: true, checkInToken: true },
    });
    if (team && newTeamManageToken) {
      await tx.team.update({ where: { id: team.id }, data: { leaderRsvpId: rsvp.id } });
      await enqueueTeamCreated(tx, { to: params.notification.to, teamId: team.id, manageToken: newTeamManageToken, reason: "created" });
    }
    await enqueueRsvpConfirmation(tx, {
      to: params.notification.to,
      eventTitle: params.notification.eventTitle,
      status,
      checkInToken: rsvp.checkInToken,
      ...(team ? { teamName: team.name } : {}),
    });
    if (intent?.mode === "solo" && intent.seeker && teamEvent.soloPolicy === SoloPolicy.SOLO_WITH_MATCHING) {
      await tx.teamSeekerProfile.create({
        data: { rsvpId: rsvp.id, headline: intent.seeker.headline, skills: intent.seeker.skills, visible: true },
      });
    }
    await params.afterCreate?.(tx, rsvp.id);
    const count = await tx.rSVP.count({ where: params.target });
    return { ...rsvp, status, count, teamId: team?.id ?? null };
  });
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

export function validateAndNormalizeAnswers(params: {
  fields: Array<{
    id: string;
    key: string;
    label: string;
    type: RegistrationFieldType;
    required: boolean;
    options: unknown;
    /** FieldSettings JSON (lib/registrationFields.ts); invalid values are ignored. */
    settings?: unknown;
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

  const settingsByKey = new Map(fields.map((f) => [f.key, parseFieldSettings(f.settings)]));
  // Questions hidden by "show only if" are skipped entirely: never required, answers dropped.
  const visible = visibleFieldKeys(
    fields.map((f) => ({ key: f.key, type: f.type, settings: settingsByKey.get(f.key) })),
    answers,
  );

  for (const f of fields) {
    if (!visible.has(f.key)) continue;
    const settings = settingsByKey.get(f.key) ?? {};
    const raw = answers[f.key];
    const hasValue = raw !== undefined && raw !== null && raw !== "";

    switch (f.type) {
      case RegistrationFieldType.TEXT:
      case RegistrationFieldType.TEXTAREA: {
        const s = typeof raw === "string" ? raw.trim() : "";
        if (f.required && !s) return { error: `${f.label} is required.` };
        if (!s) break;
        const max = Math.min(settings.maxLength ?? DEFAULT_MAX_LENGTH[f.type]!, 5_000);
        if (s.length > max) return { error: `${f.label} must be at most ${max.toLocaleString("en-GB")} characters.` };
        if (settings.minLength != null && s.length < settings.minLength) return { error: `${f.label} must be at least ${settings.minLength} characters.` };
        rows.push({ fieldId: f.id, valueText: s });
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
        const s = typeof raw === "string" ? normalizeInternationalPhone(raw) : "";
        if (f.required && !s) return { error: `${f.label} is required.` };
        if (!s) break;
        if (!isValidInternationalPhone(s)) {
          return { error: phoneValidationMessage(f.label, s) };
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
          if (!settings.allowOther) return { error: `${f.label} must be one of the available options.` };
          if (s.length > OTHER_MAX_LENGTH) return { error: `${f.label}: keep "Other" under ${OTHER_MAX_LENGTH} characters.` };
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
        const unique = [...new Set(picked)];
        if (settings.maxSelections != null && unique.length > settings.maxSelections) {
          return { error: `${f.label}: choose up to ${settings.maxSelections}.` };
        }
        const others = unique.filter((s) => opts.length > 0 && !opts.includes(s));
        if (others.length > 0 && (!settings.allowOther || others.length > 1)) {
          return { error: `${f.label} contains an invalid option.` };
        }
        if (others.some((s) => s.length > OTHER_MAX_LENGTH)) return { error: `${f.label}: keep "Other" under ${OTHER_MAX_LENGTH} characters.` };
        for (const s of unique) {
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
        if (settings.min != null && n < settings.min) return { error: `${f.label} must be ${settings.min} or more.` };
        if (settings.max != null && n > settings.max) return { error: `${f.label} must be ${settings.max} or less.` };
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
        const day = d.toISOString().slice(0, 10);
        if (settings.minDate && day < settings.minDate) return { error: `${f.label} can't be before ${settings.minDate}.` };
        if (settings.maxDate && day > settings.maxDate) return { error: `${f.label} can't be after ${settings.maxDate}.` };
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

/**
 * Public registration (web form, `/api/rsvp`, and the mobile API). `opts.team`
 * says how to register on a TEAM event (create a team, join by link, or solo);
 * it is parsed by the caller with `teamRegistrationIntentSchema`. Omitting it
 * registers solo, which a TEAMS_ONLY event refuses with code TEAM_REQUIRED.
 */
export async function submitRsvpCore(
  input: unknown,
  opts: { userId: string | null; team?: TeamRegistrationIntent },
): Promise<ActionResult<{ count: number; status: RsvpStatus; ticketToken: string; teamId?: string | null }>> {
  const userId = opts.userId;
  const teamIntent = opts.team;

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
      if (teamIntent && teamIntent.mode !== "solo") return { ok: false, error: "This event does not use team registration." };
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
      include: { page: { select: { isPublished: true } } },
    });
    if (
      !event ||
      event.status !== EventStatus.PUBLISHED ||
      event.page?.isPublished !== true ||
      event.endDateTime <= new Date() ||
      isRegistrationClosed(event)
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
          settings: f.settings,
        })),
        answers: answers as Record<string, unknown>,
      });
      if ("error" in validated) return { ok: false, error: validated.error };

      const reservation = await reserveRsvp({
        target: { eventId: event.id },
        capacity: event.capacity,
        privacyType: event.privacyType,
        notification: { to: emailRes.email, eventTitle: event.title },
        team: teamIntent,
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
        data: { count: reservation.count, status: reservation.status, ticketToken: reservation.checkInToken, teamId: reservation.teamId },
      };
    } catch (e: unknown) {
      if (isRsvpTargetClosedError(e)) return { ok: false, error: "This event is not open for RSVP." };
      if (e instanceof TeamRegistrationError) return teamRegistrationFailure(e);
      if (isUniqueViolationOn(e, "nameKey")) return { ok: false, error: "That team name is already taken for this event." };
      if (
        typeof e === "object" &&
        e !== null &&
        "code" in e &&
        (e as { code: string }).code === "P2002"
      ) {
        return { ok: false, error: "You have already RSVP’d for this event." };
      }
      console.error("[rsvp] authenticated submission failed");
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
    if (teamIntent && teamIntent.mode !== "solo") return { ok: false, error: "This event does not use team registration." };
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
    include: { page: { select: { isPublished: true } } },
  });
  if (
    !event ||
    event.status !== EventStatus.PUBLISHED ||
    event.page?.isPublished !== true ||
    event.endDateTime <= new Date() ||
    isRegistrationClosed(event)
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
        settings: f.settings,
      })),
      answers: parsed.data.answers as Record<string, unknown>,
    });
    if ("error" in validated) return { ok: false, error: validated.error };

    const reservation = await reserveRsvp({
      target: { eventId: event.id },
      capacity: event.capacity,
      privacyType: event.privacyType,
      notification: { to: emailNorm, eventTitle: event.title },
      team: teamIntent,
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
      data: { count: reservation.count, status: reservation.status, ticketToken: reservation.checkInToken, teamId: reservation.teamId },
    };
  } catch (e: unknown) {
    if (isRsvpTargetClosedError(e)) return { ok: false, error: "This event is not open for RSVP." };
    if (e instanceof TeamRegistrationError) return teamRegistrationFailure(e);
    if (isUniqueViolationOn(e, "nameKey")) return { ok: false, error: "That team name is already taken for this event." };
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
    console.error("[rsvp] guest submission failed");
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
      settings: field.settings,
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
      enforceOpen: false,
      // Organisers may add a solo registrant even to a TEAMS_ONLY event.
      allowSoloWithoutTeam: true,
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
    if (error instanceof TeamRegistrationError) return teamRegistrationFailure(error);
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code: string }).code === "P2002"
    ) {
      return { ok: false, error: "This email is already registered for this event." };
    }
    console.error("[rsvp] manual submission failed");
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
    if (isRsvpTargetClosedError(e)) return { ok: false, error: "This event is not open for RSVP." };
    if (
      typeof e === "object" &&
      e !== null &&
      "code" in e &&
      (e as { code: string }).code === "P2002"
    ) {
      return { ok: false, error: "You have already RSVP’d for this event." };
    }
    console.error("[rsvp] occurrence submission failed");
    return { ok: false, error: "Could not save your RSVP." };
  }
}
