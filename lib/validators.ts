import { EventPrivacyType, EventStatus } from "@prisma/client";
import { z } from "zod";

const slugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const createOrganisationSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  slug: z
    .string()
    .trim()
    .min(2, "Slug must be at least 2 characters")
    .max(64)
    .regex(slugRegex, "Use lowercase letters, numbers, and single hyphens"),
  description: z.string().trim().max(2000).optional().default(""),
  logoUrl: z.string().url().optional().or(z.literal("")),
});

export const updateOrganisationSchema = z.object({
  organisationSlug: z.string().trim().min(1),
  name: z.string().trim().min(1, "Name is required").max(120),
  description: z.string().trim().max(2000).optional().default(""),
  logoUrl: z.string().url().optional().or(z.literal("")),
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
    coverImageUrl: z.string().url().optional().or(z.literal("")),
    showRegistrationCount: z.preprocess(
      (v) => v === true || v === "true" || v === "on",
      z.boolean(),
    ).optional().default(true),
    startDateTime: z.coerce.date(),
    endDateTime: z.coerce.date(),
    timezone: z.string().trim().min(1, "Timezone is required").max(64),
    location: z.string().trim().max(500).optional().default(""),
    mapLinkUrl: z.string().url().optional().or(z.literal("")),
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
  })
  .refine((d) => d.endDateTime > d.startDateTime, {
    message: "End must be after start",
    path: ["endDateTime"],
  });

const rsvpTargetBase = z
  .object({
    orgSlug: z.string().trim().min(1),
    eventSlug: z.string().trim().optional(),
    eventInstanceId: z.string().trim().optional(),
  })
  .refine(
    (d) =>
      (d.eventSlug != null && d.eventSlug.length > 0) ||
      (d.eventInstanceId != null && d.eventInstanceId.length > 0),
    { message: "Event or instance is required.", path: ["eventSlug"] },
  );

export const rsvpGuestSchema = rsvpTargetBase.extend({
  guestEmail: z.string().trim().email("Valid email required"),
  name: z.string().trim().min(1, "Name is required").max(200),
  answers: z.record(z.string(), z.unknown()).optional().default({}),
});

export const rsvpLoggedInSchema = rsvpTargetBase.extend({
  name: z.string().trim().max(200).optional(),
  answers: z.record(z.string(), z.unknown()).optional().default({}),
});

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
    coverImageUrl: z.string().url().optional().or(z.literal("")),
    showRegistrationCount: z.preprocess(
      (v) => v === true || v === "true" || v === "on",
      z.boolean(),
    ).optional().default(true),
    startDateTime: z.coerce.date(),
    endDateTime: z.coerce.date(),
    timezone: z.string().trim().min(1, "Timezone is required").max(64),
    location: z.string().trim().max(500).optional().default(""),
    mapLinkUrl: z.string().url().optional().or(z.literal("")),
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
  })
  .refine((d) => d.endDateTime > d.startDateTime, {
    message: "End must be after start",
    path: ["endDateTime"],
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
      (d.eventId != null && d.eventId.length > 0) ||
      (d.eventInstanceId != null && d.eventInstanceId.length > 0),
    { message: "Event or instance is required.", path: ["eventId"] },
  );

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
  (d) =>
    (d.eventId != null && d.eventId.length > 0) ||
    (d.eventInstanceId != null && d.eventInstanceId.length > 0),
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
    rruleLine: z.string().trim().min(1, "Recurrence rule is required"),
    timezone: z.string().trim().min(1, "Timezone is required").max(64),
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
  });

export const updateSeriesMetaSchema = orgScoped.extend({
  eventSeriesId: z.string().trim().min(1),
  title: z.string().trim().min(1, "Title is required").max(200),
  description: z.string().trim().max(10000).optional().default(""),
  timezone: z.string().trim().min(1, "Timezone is required").max(64),
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
  organisationSlug: z.string().trim().min(1),
  eventId: z.string().trim().min(1),
  rawInput: z.string().trim().min(1),
  force: z.boolean().optional(),
});

export const undoCheckInSchema = z.object({
  organisationSlug: z.string().trim().min(1),
  eventId: z.string().trim().min(1),
  rsvpId: z.string().trim().min(1),
});

export const attendeeLookupSchema = z.object({
  organisationSlug: z.string().trim().min(1),
  eventId: z.string().trim().min(1),
  query: z.string().trim().min(1),
});

export const checkInByRsvpIdSchema = z.object({
  organisationSlug: z.string().trim().min(1),
  eventId: z.string().trim().min(1),
  rsvpId: z.string().trim().min(1),
  force: z.boolean().optional(),
});
