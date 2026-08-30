import { EventPrivacyType, EventStatus } from "@prisma/client";
import { z } from "zod";
import { isValidTimeZone } from "@/lib/timeZone";

const slugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const httpUrlSchema = z.string().url().refine((value) => {
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
    httpUrlSchema,
    z.string().regex(/^\/api\/uploads\/.+/, "Invalid uploaded image URL"),
    z.literal(""),
  ])
  .optional();

const attendeeNameSchema = z
  .string()
  .trim()
  .min(1, "Name is required")
  .max(200, "Name must be at most 200 characters")
  .refine((value) => /\p{L}/u.test(value), "Enter a valid name");

const registrationCutoffSchema = {
  registrationClosesAt: z.preprocess((value) => value === "" || value == null ? undefined : value, z.coerce.date().optional()),
  registrationLeadMinutes: z.preprocess((value) => value === "" || value == null ? undefined : Number(value), z.number().int().min(0).max(525_600).optional()),
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
  logoUrl: optionalHttpUrlSchema,
});

export const updateOrganisationSchema = z.object({
  organisationSlug: z.string().trim().min(1),
  name: z.string().trim().min(1, "Name is required").max(120),
  description: z.string().trim().max(2000).optional().default(""),
  logoUrl: optionalHttpUrlSchema,
});

export const createEventSchema = z
  .object({
    organisationSlug: z.string().trim().min(1),
    title: z.string().trim().min(1, "Title is required").max(200),
    description: z.string().trim().max(10000).optional().default(""),
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
    showRegistrationCount: z.preprocess(
      (v) => v === true || v === "true" || v === "on",
      z.boolean(),
    ).optional().default(true),
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
  })
  .superRefine((data, ctx) => {
    validateEventScheduleAndLocation(data, ctx);
    if (data.registrationClosesAt && data.registrationLeadMinutes != null) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["registrationClosesAt"], message: "Choose one registration cutoff mode." });
    if (data.registrationClosesAt && data.registrationClosesAt > data.startDateTime) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["registrationClosesAt"], message: "Registration must close on or before the event starts." });
    if (data.registrationLeadMinutes != null && data.registrationLeadMinutes * 60_000 > data.startDateTime.getTime() - Date.now()) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["registrationLeadMinutes"], message: "Registration cutoff cannot be before now." });
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
    guestEmail: z.string().trim().email("Valid email required").optional().or(z.literal("")),
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
    description: z.string().trim().max(10000).optional().default(""),
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
    showRegistrationCount: z.preprocess(
      (v) => v === true || v === "true" || v === "on",
      z.boolean(),
    ).optional().default(true),
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
    ...registrationCutoffSchema,
  })
  .superRefine((data, ctx) => {
    validateEventScheduleAndLocation(data, ctx);
    if (data.registrationClosesAt && data.registrationLeadMinutes != null) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["registrationClosesAt"], message: "Choose one registration cutoff mode." });
    if (data.registrationClosesAt && data.registrationClosesAt > data.startDateTime) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["registrationClosesAt"], message: "Registration must close on or before the event starts." });
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
    (d) =>
      Boolean(d.eventId?.length) !== Boolean(d.eventInstanceId?.length),
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

export const rsvpTransitionSchema = orgScoped.extend({
  rsvpId: z.string().trim().min(1),
  eventId: z.string().trim().optional(),
  eventInstanceId: z.string().trim().optional(),
}).refine(
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
    rruleLine: z.string().trim().min(1, "Recurrence rule is required").max(2048).refine((value) => !/[\r\n]/.test(value), "Use a single RRULE line"),
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
  })
  .refine((d) => d.anchorEndDateTime > d.anchorStartDateTime, {
    message: "End must be after start",
    path: ["anchorEndDateTime"],
  })
  .refine((d) => d.anchorEndDateTime.getTime() - d.anchorStartDateTime.getTime() <= 2_147_483_647, {
    message: "A recurring occurrence must be shorter than 24 days",
    path: ["anchorEndDateTime"],
  });

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
});

export const deleteSeriesSchema = orgScoped.extend({
  eventSeriesId: z.string().trim().min(1),
});

export const checkInByTokenSchema = z.object({
  organisationSlug: z.string().trim().min(1).max(120),
  eventId: z.string().trim().min(1).max(128),
  rawInput: z.string().trim().min(1).max(2048),
  force: z.boolean().optional(),
}).strict();

export const undoCheckInSchema = z.object({
  organisationSlug: z.string().trim().min(1).max(120),
  eventId: z.string().trim().min(1).max(128),
  rsvpId: z.string().trim().min(1).max(128),
}).strict();

export const attendeeLookupSchema = z.object({
  organisationSlug: z.string().trim().min(1).max(120),
  eventId: z.string().trim().min(1).max(128),
  query: z.string().trim().min(2).max(200),
}).strict();

export const checkInByRsvpIdSchema = z.object({
  organisationSlug: z.string().trim().min(1).max(120),
  eventId: z.string().trim().min(1).max(128),
  rsvpId: z.string().trim().min(1).max(128),
  force: z.boolean().optional(),
}).strict();

export const offlineCheckInRosterSchema = z.object({
  organisationSlug: z.string().trim().min(1).max(120),
  eventId: z.string().trim().min(1).max(128),
}).strict();

export const syncOfflineCheckInsSchema = offlineCheckInRosterSchema.extend({
  checkIns: z.array(
    z.object({
      rsvpId: z.string().trim().min(1).max(128),
      clientMutationId: z.string().trim().min(8).max(128),
      checkedInAt: z.string().datetime(),
      force: z.boolean().optional().default(false),
    }).strict(),
  ).min(1).max(500),
});
