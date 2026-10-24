import { BroadcastAttendanceFilter, EventPrivacyType, EventStatus, RegistrationMode, RsvpStatus, SoloPolicy } from "@prisma/client";
import { z } from "zod";
import { isValidTimeZone } from "@/lib/timeZone";
import { isUploadedImageUrl } from "@/lib/uploadUrl";
import { BROADCAST_DESIGN_IDS, DEFAULT_BROADCAST_DESIGN } from "@/lib/email/broadcastDesigns";
import { BROADCAST_BODY_MAX, BROADCAST_STARTER_TEMPLATES, BROADCAST_SUBJECT_MAX } from "@/lib/broadcastTemplate";

const slugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const httpUrlSchema = z
  .string()
  .url()
  .refine((value) => {
    try {
      const protocol = new URL(value).protocol;
      return protocol === "http:" || protocol === "https:";
    } catch {
      return false;
    }
  }, "Only HTTP and HTTPS URLs are allowed");
const optionalHttpUrlSchema = httpUrlSchema.optional().or(z.literal(""));
const timeZoneSchema = z
  .string()
  .trim()
  .min(1, "Timezone is required")
  .max(64)
  .refine(isValidTimeZone, "Select a valid IANA timezone");
const coverImageUrlSchema = z
  .union([
    z.string().refine(isUploadedImageUrl, "Invalid uploaded image URL"),
    z.literal(""),
  ])
  .optional();
const eventPageLogoUrlSchema = z
  .union([
    z.string().refine(isUploadedImageUrl, "Invalid uploaded image URL"),
    z.literal(""),
    z.null(),
  ])
  .optional();

export function isValidAttendeeName(value: string) {
  return (
    value.length <= 200 &&
    /\p{L}/u.test(value) &&
    !/[<>\u0000-\u001F\u007F]/.test(value)
  );
}

const attendeeNameSchema = z
  .string()
  .trim()
  .min(1, "Name is required")
  .max(200, "Name must be at most 200 characters")
  .refine(isValidAttendeeName, "Enter a valid name");

/** Upper bound for `teamMaxSize`; keeps a single unit from swallowing an event. */
export const TEAM_MAX_SIZE_LIMIT = 100;
export const TEAM_NAME_MAX_LENGTH = 60;
export const SEEKER_HEADLINE_MAX_LENGTH = 120;
export const SEEKER_MAX_SKILLS = 8;
export const SEEKER_SKILL_MAX_LENGTH = 30;

const emptyToUndefined = (value: unknown) =>
  value === "" || value === null ? undefined : value;

const optionalTeamSize = z.preprocess((value) => {
  if (value === "" || value === null || value === undefined) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : value;
}, z.number().int("Team size must be a whole number").min(1).max(TEAM_MAX_SIZE_LIMIT).optional());

/**
 * Team registration settings shared by the one-off event create and update
 * schemas. On update every field is optional: an omitted `registrationMode`
 * leaves all four settings untouched, so older forms cannot reset them.
 */
const teamSettingsFields = {
  registrationMode: z.preprocess(emptyToUndefined, z.nativeEnum(RegistrationMode).optional()),
  teamMinSize: optionalTeamSize,
  teamMaxSize: optionalTeamSize,
  soloPolicy: z.preprocess(emptyToUndefined, z.nativeEnum(SoloPolicy).optional()),
};

function validateTeamSettings(
  data: { registrationMode?: RegistrationMode; teamMinSize?: number; teamMaxSize?: number },
  ctx: z.RefinementCtx,
) {
  if (data.registrationMode !== RegistrationMode.TEAM) return;
  if (data.teamMaxSize == null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["teamMaxSize"], message: "Set a maximum team size." });
    return;
  }
  if (data.teamMaxSize < 2) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["teamMaxSize"], message: "Teams need room for at least 2 people." });
  }
  if (data.teamMinSize != null && data.teamMinSize > data.teamMaxSize) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["teamMinSize"], message: "Minimum team size cannot be above the maximum." });
  }
}

/**
 * The stored team settings for a validated create/update payload. INDIVIDUAL
 * events keep no sizes; `null` means "leave the settings unchanged".
 */
export function normalizedTeamSettings(data: {
  registrationMode?: RegistrationMode;
  teamMinSize?: number;
  teamMaxSize?: number;
  soloPolicy?: SoloPolicy;
}): { registrationMode: RegistrationMode; teamMinSize: number | null; teamMaxSize: number | null; soloPolicy: SoloPolicy } | null {
  if (data.registrationMode === undefined) return null;
  if (data.registrationMode === RegistrationMode.INDIVIDUAL) {
    return { registrationMode: RegistrationMode.INDIVIDUAL, teamMinSize: null, teamMaxSize: null, soloPolicy: SoloPolicy.SOLO_ALLOWED };
  }
  return {
    registrationMode: RegistrationMode.TEAM,
    teamMinSize: data.teamMinSize ?? null,
    teamMaxSize: data.teamMaxSize ?? null,
    soloPolicy: data.soloPolicy ?? SoloPolicy.SOLO_ALLOWED,
  };
}

const seriesTeamMessage = "Team registration is only available for one-off events.";
const refusedForSeries = z.preprocess(
  emptyToUndefined,
  z.undefined({ error: seriesTeamMessage }),
);

/** Recurring series stay individual: any team setting is refused, not ignored. */
const seriesTeamSettingsRefusal = {
  registrationMode: z.preprocess(
    emptyToUndefined,
    z.literal(RegistrationMode.INDIVIDUAL, { error: seriesTeamMessage }).optional(),
  ),
  teamMinSize: refusedForSeries,
  teamMaxSize: refusedForSeries,
  soloPolicy: refusedForSeries,
};

function isValidTeamName(value: string) {
  return /[\p{L}\p{N}]/u.test(value) && !/[<>\u0000-\u001F\u007F]/.test(value);
}

export const teamNameSchema = z
  .string()
  .trim()
  .min(1, "Team name is required")
  .max(TEAM_NAME_MAX_LENGTH, `Team name must be at most ${TEAM_NAME_MAX_LENGTH} characters`)
  .transform((value) => value.replace(/\s+/g, " "))
  .refine(isValidTeamName, "Enter a valid team name");

/** Case- and spacing-insensitive key behind the per-event unique team name. */
export function teamNameKey(name: string) {
  return name.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

/** Join links and management links carry 43-character base64url tokens. */
export const teamTokenSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_-]{32,128}$/, "Invalid link");

/** Shape of an RSVP check-in (ticket) token, as validated by the ticket page. */
export const ticketTokenSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_-]{8,128}$/, "Invalid ticket");

const seekerSkillsSchema = z
  .array(
    z
      .string()
      .trim()
      .min(1)
      .max(SEEKER_SKILL_MAX_LENGTH, `Each skill must be at most ${SEEKER_SKILL_MAX_LENGTH} characters`)
      .refine((value) => !/[<>\u0000-\u001F\u007F]/.test(value), "Enter a valid skill"),
  )
  .max(SEEKER_MAX_SKILLS, `Add up to ${SEEKER_MAX_SKILLS} skills`)
  .transform((skills) => {
    const seen = new Set<string>();
    return skills.filter((skill) => {
      const key = skill.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  });

/** "Looking for a team" profile fields (headline and skills). */
export const seekerProfileFieldsSchema = z
  .object({
    headline: z
      .string()
      .trim()
      .min(1, "Add a short headline")
      .max(SEEKER_HEADLINE_MAX_LENGTH, `Keep the headline under ${SEEKER_HEADLINE_MAX_LENGTH} characters`)
      .refine((value) => !/[<>\u0000-\u001F\u007F]/.test(value), "Enter a valid headline"),
    skills: seekerSkillsSchema.optional().default([]),
  })
  .strict();

/**
 * How a registration on a TEAM event is made. Parsed separately from the RSVP
 * body by the web registration route and passed to `submitRsvpCore` in its
 * options, so API clients that only send the RSVP body always register solo.
 */
export const teamRegistrationIntentSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("create"), name: teamNameSchema }).strict(),
  z.object({ mode: z.literal("join"), joinToken: teamTokenSchema }).strict(),
  z.object({ mode: z.literal("solo"), seeker: seekerProfileFieldsSchema.optional() }).strict(),
]);
export type TeamRegistrationIntent = z.infer<typeof teamRegistrationIntentSchema>;

/** Leader adds a member by name and email from the team page. */
export const addTeamMemberSchema = z
  .object({
    name: attendeeNameSchema,
    email: z.string().trim().email("Valid email required").max(320),
  })
  .strict();

/** Seeker profile edit from the ticket page (ticket token proves ownership). */
export const upsertSeekerProfileSchema = seekerProfileFieldsSchema.extend({
  visible: z.boolean().optional().default(true),
});

export const renameTeamSchema = z.object({ name: teamNameSchema }).strict();

const registrationCutoffSchema = {
  registrationClosesAt: z.preprocess(
    (value) => (value === "" || value == null ? undefined : value),
    z.coerce.date().optional(),
  ),
  registrationLeadMinutes: z.preprocess(
    (value) => (value === "" || value == null ? undefined : Number(value)),
    z.number().int().min(0).max(525_600).optional(),
  ),
};

function validateEventScheduleAndLocation(
  data: {
    startDateTime: Date;
    endDateTime: Date;
    isOnline: boolean;
    location: string;
  },
  ctx: z.RefinementCtx,
) {
  if (data.startDateTime < new Date()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["startDateTime"],
      message: "Start time must be now or in the future",
    });
  }
  if (data.endDateTime <= data.startDateTime) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["endDateTime"],
      message: "End must be after start",
    });
  }
  if (data.isOnline) {
    if (!httpUrlSchema.safeParse(data.location).success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["location"],
        message: "Enter a valid HTTP(S) online meeting URL",
      });
    }
  } else if (data.location.trim().length < 3) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["location"],
      message: "Enter a physical location of at least 3 characters",
    });
  }
}

export const createOrganisationSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  slug: z
    .string()
    .trim()
    .min(2, "Slug must be at least 2 characters")
    .max(64)
    .regex(slugRegex, "Use lowercase letters, numbers, and single hyphens"),
  description: z.string().trim().max(2000).optional().default(""),
  logoUrl: z.literal(""),
});

export const updateOrganisationSchema = z.object({
  organisationSlug: z.string().trim().min(1),
  name: z.string().trim().min(1, "Name is required").max(120),
  description: z.string().trim().max(2000).optional().default(""),
  logoUrl: z
    .string()
    .refine(isUploadedImageUrl, "Invalid uploaded image URL")
    .or(z.literal("")),
});

export const createEventSchema = z
  .object({
    organisationSlug: z.string().trim().min(1),
    title: z.string().trim().min(1, "Title is required").max(200),
    description: z.string().trim().max(10000).optional(),
    aboutHtml: z.string().max(50_000),
    tags: z
      .preprocess(
        (v) => {
          const raw = String(v ?? "");
          const parts = raw
            .split(/[,\n]/g)
            .map((s) => s.trim().toLowerCase())
            .map((s) => s.replace(/\s+/g, " "))
            .filter(Boolean)
            .slice(0, 12);
          return Array.from(new Set(parts));
        },
        z.array(z.string().min(1).max(32)).optional(),
      )
      .optional(),
    coverImageUrl: coverImageUrlSchema,
    showRegistrationCount: z
      .preprocess((v) => v === true || v === "true" || v === "on", z.boolean())
      .optional()
      .default(true),
    startDateTime: z.coerce.date(),
    endDateTime: z.coerce.date(),
    timezone: timeZoneSchema,
    location: z.string().trim().max(500).optional().default(""),
    mapLinkUrl: optionalHttpUrlSchema,
    isOnline: z.preprocess(
      (v) => v === true || v === "true" || v === "on",
      z.boolean(),
    ),
    capacity: z.preprocess((v) => {
      if (v === "" || v === null || v === undefined) return undefined;
      const n = Number(v);
      return Number.isFinite(n) ? n : undefined;
    }, z.number().int().positive().optional()),
    status: z.nativeEnum(EventStatus).optional().default(EventStatus.DRAFT),
    privacyType: z
      .nativeEnum(EventPrivacyType)
      .optional()
      .default(EventPrivacyType.PUBLIC),
    ...registrationCutoffSchema,
    ...teamSettingsFields,
  })
  .superRefine((data, ctx) => {
    validateEventScheduleAndLocation(data, ctx);
    validateTeamSettings(data, ctx);
    if (data.registrationClosesAt && data.registrationLeadMinutes != null)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["registrationClosesAt"],
        message: "Choose one registration cutoff mode.",
      });
    if (
      data.registrationClosesAt &&
      data.registrationClosesAt > data.startDateTime
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["registrationClosesAt"],
        message: "Registration must close on or before the event starts.",
      });
    if (
      data.registrationLeadMinutes != null &&
      data.registrationLeadMinutes * 60_000 >
        data.startDateTime.getTime() - Date.now()
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["registrationLeadMinutes"],
        message: "Registration cutoff cannot be before now.",
      });
  });

const rsvpTargetBase = z
  .object({
    orgSlug: z.string().trim().min(1),
    eventSlug: z.string().trim().optional(),
    eventInstanceId: z.string().trim().optional(),
  })
  .refine(
    (d) => Boolean(d.eventSlug?.length) !== Boolean(d.eventInstanceId?.length),
    { message: "Event or instance is required.", path: ["eventSlug"] },
  );

export const rsvpGuestSchema = rsvpTargetBase.extend({
  guestEmail: z.string().trim().email("Valid email required"),
  name: attendeeNameSchema,
  answers: z.record(z.string(), z.unknown()).optional().default({}),
});

export const rsvpLoggedInSchema = rsvpTargetBase.extend({
  name: attendeeNameSchema.optional().or(z.literal("")),
  answers: z.record(z.string(), z.unknown()).optional().default({}),
});

/** An organisation admin adding a guest RSVP from the attendee dashboard. */
export const manualRsvpSchema = z.object({
  organisationSlug: z.string().trim().min(1),
  eventId: z.string().trim().min(1),
  guestEmail: z.string().trim().email("Valid email required"),
  name: attendeeNameSchema,
  answers: z.record(z.string(), z.unknown()).optional().default({}),
});

/** An organisation admin editing an existing RSVP registration. */
export const updateRsvpRegistrationSchema = z
  .object({
    organisationSlug: z.string().trim().min(1),
    eventId: z.string().trim().optional(),
    eventInstanceId: z.string().trim().optional(),
    rsvpId: z.string().trim().min(1),
    name: attendeeNameSchema.optional().or(z.literal("")),
    guestEmail: z
      .string()
      .trim()
      .email("Valid email required")
      .optional()
      .or(z.literal("")),
    answers: z.record(z.string(), z.unknown()).optional().default({}),
  })
  .refine(
    (d) => Boolean(d.eventId?.length) !== Boolean(d.eventInstanceId?.length),
    { message: "Event or instance is required.", path: ["eventId"] },
  );

export const updateEventSchema = z
  .object({
    organisationSlug: z.string().trim().min(1),
    eventId: z.string().trim().min(1),
    title: z.string().trim().min(1, "Title is required").max(200),
    description: z.string().trim().max(10000).optional(),
    tags: z
      .preprocess(
        (v) => {
          const raw = String(v ?? "");
          const parts = raw
            .split(/[,\n]/g)
            .map((s) => s.trim().toLowerCase())
            .map((s) => s.replace(/\s+/g, " "))
            .filter(Boolean)
            .slice(0, 12);
          return Array.from(new Set(parts));
        },
        z.array(z.string().min(1).max(32)).optional(),
      )
      .optional(),
    coverImageUrl: coverImageUrlSchema,
    showRegistrationCount: z
      .preprocess((v) => v === true || v === "true" || v === "on", z.boolean())
      .optional()
      .default(true),
    startDateTime: z.coerce.date(),
    endDateTime: z.coerce.date(),
    timezone: timeZoneSchema,
    location: z.string().trim().max(500).optional().default(""),
    mapLinkUrl: optionalHttpUrlSchema,
    isOnline: z.preprocess(
      (v) => v === true || v === "true" || v === "on",
      z.boolean(),
    ),
    capacity: z.preprocess((v) => {
      if (v === "" || v === null || v === undefined) return undefined;
      const n = Number(v);
      return Number.isFinite(n) ? n : undefined;
    }, z.number().int().positive().optional()),
    status: z.nativeEnum(EventStatus),
    privacyType: z.nativeEnum(EventPrivacyType),
    /** Only meaningful with APPROVAL_REQUIRED: list the event publicly while approving each sign-up. */
    listedPublicly: z
      .preprocess((v) => v === true || v === "true" || v === "on", z.boolean())
      .optional()
      .default(false),
    pageTagline: z.string().trim().max(240).optional(),
    pageLogoUrl: eventPageLogoUrlSchema,
    pageAboutHtml: z.string().max(50_000).optional(),
    ...registrationCutoffSchema,
    ...teamSettingsFields,
  })
  .superRefine((data, ctx) => {
    validateEventScheduleAndLocation(data, ctx);
    validateTeamSettings(data, ctx);
    if (data.registrationClosesAt && data.registrationLeadMinutes != null)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["registrationClosesAt"],
        message: "Choose one registration cutoff mode.",
      });
    if (
      data.registrationClosesAt &&
      data.registrationClosesAt > data.startDateTime
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["registrationClosesAt"],
        message: "Registration must close on or before the event starts.",
      });
  });

export const deleteEventSchema = z.object({
  organisationSlug: z.string().trim().min(1),
  eventId: z.string().trim().min(1),
});

export const updateEventSlugSchema = z.object({
  organisationSlug: z.string().trim().min(1),
  eventId: z.string().trim().min(1),
  slug: z
    .string()
    .trim()
    .min(2, "Slug must be at least 2 characters")
    .max(64)
    .regex(slugRegex, "Use lowercase letters, numbers, and single hyphens"),
});

export const cloneEventSchema = z.object({
  organisationSlug: z.string().trim().min(1),
  eventId: z.string().trim().min(1),
});

export const updateMemberRoleSchema = z.object({
  organisationSlug: z.string().trim().min(1),
  targetUserId: z.string().trim().min(1),
  role: z.enum(["ADMIN", "MEMBER"]),
});

export const removeMemberSchema = z.object({
  organisationSlug: z.string().trim().min(1),
  targetUserId: z.string().trim().min(1),
});

export const createOrgInviteSchema = z.object({
  organisationSlug: z.string().trim().min(1),
});

export const revokeOrgInviteSchema = z.object({
  organisationSlug: z.string().trim().min(1),
  inviteId: z.string().trim().min(1),
});

export const deleteRsvpSchema = z
  .object({
    organisationSlug: z.string().trim().min(1),
    eventId: z.string().trim().optional(),
    eventInstanceId: z.string().trim().optional(),
    rsvpId: z.string().trim().min(1),
  })
  .refine(
    (d) => Boolean(d.eventId?.length) !== Boolean(d.eventInstanceId?.length),
    { message: "Event or instance is required.", path: ["eventId"] },
  );

export const restoreRsvpSchema = z.object({
  organisationSlug: z.string().trim().min(1),
  undoId: z.string().trim().min(1),
});

export const deleteOrganisationSchema = z.object({
  organisationSlug: z.string().trim().min(1),
});

const orgScoped = z.object({
  organisationSlug: z.string().trim().min(1),
});

export const rsvpTransitionSchema = orgScoped
  .extend({
    rsvpId: z.string().trim().min(1),
    eventId: z.string().trim().optional(),
    eventInstanceId: z.string().trim().optional(),
  })
  .refine(
    (d) => Boolean(d.eventId?.length) !== Boolean(d.eventInstanceId?.length),
    { message: "Event or instance is required.", path: ["eventId"] },
  );

export const addEventInviteSchema = orgScoped.extend({
  eventId: z.string().trim().min(1),
  email: z.string().trim().email("Valid email required"),
});

export const removeEventInviteSchema = orgScoped.extend({
  inviteId: z.string().trim().min(1),
  eventId: z.string().trim().min(1),
});

export const addSeriesInviteSchema = orgScoped.extend({
  eventSeriesId: z.string().trim().min(1),
  email: z.string().trim().email("Valid email required"),
});

export const removeSeriesInviteSchema = orgScoped.extend({
  inviteId: z.string().trim().min(1),
  eventSeriesId: z.string().trim().min(1),
});

export const createSeriesSchema = z
  .object({
    organisationSlug: z.string().trim().min(1),
    title: z.string().trim().min(1, "Title is required").max(200),
    description: z.string().trim().max(10000).optional().default(""),
    anchorStartDateTime: z.coerce.date(),
    anchorEndDateTime: z.coerce.date(),
    rruleLine: z
      .string()
      .trim()
      .min(1, "Recurrence rule is required")
      .max(2048)
      .refine((value) => !/[\r\n]/.test(value), "Use a single RRULE line"),
    timezone: timeZoneSchema,
    capacity: z.preprocess((v) => {
      if (v === "" || v === null || v === undefined) return undefined;
      const n = Number(v);
      return Number.isFinite(n) ? n : undefined;
    }, z.number().int().positive().optional()),
    status: z.nativeEnum(EventStatus).optional().default(EventStatus.DRAFT),
    privacyType: z
      .nativeEnum(EventPrivacyType)
      .optional()
      .default(EventPrivacyType.PUBLIC),
    ...seriesTeamSettingsRefusal,
  })
  .refine((d) => d.anchorEndDateTime > d.anchorStartDateTime, {
    message: "End must be after start",
    path: ["anchorEndDateTime"],
  })
  .refine(
    (d) =>
      d.anchorEndDateTime.getTime() - d.anchorStartDateTime.getTime() <=
      2_147_483_647,
    {
      message: "A recurring occurrence must be shorter than 24 days",
      path: ["anchorEndDateTime"],
    },
  );

export const updateSeriesMetaSchema = orgScoped.extend({
  eventSeriesId: z.string().trim().min(1),
  title: z.string().trim().min(1, "Title is required").max(200),
  description: z.string().trim().max(10000).optional().default(""),
  timezone: timeZoneSchema,
  capacity: z.preprocess((v) => {
    if (v === "" || v === null || v === undefined) return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }, z.number().int().positive().optional()),
  status: z.nativeEnum(EventStatus),
  privacyType: z.nativeEnum(EventPrivacyType),
  ...seriesTeamSettingsRefusal,
});

export const deleteSeriesSchema = orgScoped.extend({
  eventSeriesId: z.string().trim().min(1),
});

export const checkInByTokenSchema = z
  .object({
    organisationSlug: z.string().trim().min(1).max(120),
    eventId: z.string().trim().min(1).max(128),
    rawInput: z.string().trim().min(1).max(2048),
    force: z.boolean().optional(),
  })
  .strict();

export const undoCheckInSchema = z
  .object({
    organisationSlug: z.string().trim().min(1).max(120),
    eventId: z.string().trim().min(1).max(128),
    rsvpId: z.string().trim().min(1).max(128),
  })
  .strict();

export const attendeeLookupSchema = z
  .object({
    organisationSlug: z.string().trim().min(1).max(120),
    eventId: z.string().trim().min(1).max(128),
    query: z.string().trim().min(2).max(200),
  })
  .strict();

export const checkInByRsvpIdSchema = z
  .object({
    organisationSlug: z.string().trim().min(1).max(120),
    eventId: z.string().trim().min(1).max(128),
    rsvpId: z.string().trim().min(1).max(128),
    force: z.boolean().optional(),
  })
  .strict();

export const offlineCheckInRosterSchema = z
  .object({
    organisationSlug: z.string().trim().min(1).max(120),
    eventId: z.string().trim().min(1).max(128),
  })
  .strict();

export const syncOfflineCheckInsSchema = offlineCheckInRosterSchema.extend({
  checkIns: z
    .array(
      z
        .object({
          rsvpId: z.string().trim().min(1).max(128),
          clientMutationId: z.string().trim().min(8).max(128),
          checkedInAt: z.string().datetime(),
          force: z.boolean().optional().default(false),
        })
        .strict(),
    )
    .min(1)
    .max(500),
});

const broadcastAudienceFields = {
  eventId: z.string().trim().min(1),
  statuses: z.array(z.nativeEnum(RsvpStatus)).min(1, "Choose at least one registration status").max(4),
  attendance: z.nativeEnum(BroadcastAttendanceFilter).default(BroadcastAttendanceFilter.ANY),
};

const BROADCAST_SUBJECT_TOO_LONG = `Keep the subject under ${BROADCAST_SUBJECT_MAX} characters`;
const BROADCAST_BODY_TOO_LONG = `Keep the message under ${BROADCAST_BODY_MAX.toLocaleString("en")} characters`;
const broadcastSubjectSchema = z.string().trim().min(1, "Subject is required").max(BROADCAST_SUBJECT_MAX, BROADCAST_SUBJECT_TOO_LONG);
const broadcastDesignSchema = z.enum(BROADCAST_DESIGN_IDS).default(DEFAULT_BROADCAST_DESIGN);
const broadcastBodySchema = z.string().trim().min(1, "Message is required").max(BROADCAST_BODY_MAX, BROADCAST_BODY_TOO_LONG);
const broadcastTemplateIds = new Set(BROADCAST_STARTER_TEMPLATES.map((template) => template.id));

export const broadcastAudienceSchema = orgScoped.extend(broadcastAudienceFields);

export const sendEventBroadcastSchema = orgScoped.extend({
  ...broadcastAudienceFields,
  subject: broadcastSubjectSchema,
  body: broadcastBodySchema,
  design: broadcastDesignSchema,
});

export const sendEventBroadcastTestSchema = orgScoped.extend({
  eventId: z.string().trim().min(1),
  subject: broadcastSubjectSchema,
  body: broadcastBodySchema,
  design: broadcastDesignSchema,
});

export const previewEventBroadcastSchema = sendEventBroadcastTestSchema;

/** Organiser action on a whole team (approve, reject, promote, delete). */
export const organiserTeamActionSchema = orgScoped
  .extend({
    eventId: z.string().trim().min(1).max(128),
    teamId: z.string().trim().min(1).max(128),
  })
  .strict();

export const organiserRenameTeamSchema = organiserTeamActionSchema.extend({
  name: teamNameSchema,
});

/** Move one registration into another team of the same event. */
export const organiserMoveTeamMemberSchema = orgScoped
  .extend({
    eventId: z.string().trim().min(1).max(128),
    rsvpId: z.string().trim().min(1).max(128),
    targetTeamId: z.string().trim().min(1).max(128),
  })
  .strict();
/** Identifies the signed-in organiser's own draft for one event. */
export const eventBroadcastDraftRefSchema = orgScoped.extend({
  eventId: z.string().trim().min(1).max(128),
});

/**
 * A draft is work in progress, so the subject, message, and audience may be
 * empty, but the length limits are exactly the send schema's. A template id
 * the server no longer knows is dropped rather than rejected.
 */
export const saveEventBroadcastDraftSchema = eventBroadcastDraftRefSchema.extend({
  subject: z.string().max(BROADCAST_SUBJECT_MAX, BROADCAST_SUBJECT_TOO_LONG),
  body: z.string().max(BROADCAST_BODY_MAX, BROADCAST_BODY_TOO_LONG),
  design: broadcastDesignSchema,
  statuses: z.array(z.nativeEnum(RsvpStatus)).max(4).transform((statuses) => [...new Set(statuses)]),
  attendance: z.nativeEnum(BroadcastAttendanceFilter).default(BroadcastAttendanceFilter.ANY),
  templateId: z
    .string()
    .max(64)
    .nullable()
    .default(null)
    .transform((id) => (id && broadcastTemplateIds.has(id) ? id : null)),
}).strict();
