import { EventStatus } from "@prisma/client";
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

export const createEventSchema = z
  .object({
    organisationSlug: z.string().trim().min(1),
    title: z.string().trim().min(1, "Title is required").max(200),
    description: z.string().trim().max(10000).optional().default(""),
    coverImageUrl: z.string().url().optional().or(z.literal("")),
    startDateTime: z.coerce.date(),
    endDateTime: z.coerce.date(),
    timezone: z.string().trim().min(1, "Timezone is required").max(64),
    location: z.string().trim().max(500).optional().default(""),
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
  })
  .refine((d) => d.endDateTime > d.startDateTime, {
    message: "End must be after start",
    path: ["endDateTime"],
  });

export const rsvpGuestSchema = z.object({
  orgSlug: z.string().trim().min(1),
  eventSlug: z.string().trim().min(1),
  guestEmail: z.string().trim().email("Valid email required"),
});

export const rsvpLoggedInSchema = z.object({
  orgSlug: z.string().trim().min(1),
  eventSlug: z.string().trim().min(1),
});
