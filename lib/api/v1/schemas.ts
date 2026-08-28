import { EventPrivacyType, EventStatus } from "@prisma/client";
import { z } from "zod";

export const apiResourceIdSchema = z.string().trim().min(1).max(128);

export const emptyQuerySchema = z.object({}).strict();

export const collectionQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).max(1024).optional(),
}).strict();

export const participantAttendanceSchema = z.enum(["all", "checked_in", "not_checked_in"]);
export type ParticipantAttendance = z.infer<typeof participantAttendanceSchema>;

export const participantCollectionQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).max(1024).optional(),
  attendance: participantAttendanceSchema.default("all"),
  include: z.enum(["attendance"]).optional(),
}).strict();

export const eventDtoSchema = z.object({
  id: z.string(),
  title: z.string(),
  slug: z.string(),
  description: z.string(),
  tags: z.array(z.string()),
  coverImageUrl: z.string().nullable(),
  startDateTime: z.string().datetime(),
  endDateTime: z.string().datetime(),
  timezone: z.string(),
  location: z.string(),
  mapLinkUrl: z.string().nullable(),
  isOnline: z.boolean(),
  capacity: z.number().int().nullable(),
  status: z.nativeEnum(EventStatus),
  privacyType: z.nativeEnum(EventPrivacyType),
  createdAt: z.string().datetime(),
}).strict();

export const participantDtoSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  registeredAt: z.string().datetime(),
  checkedInAt: z.string().datetime().nullable().optional(),
}).strict();

export const eventResponseSchema = z.object({ data: eventDtoSchema }).strict();
export const eventsResponseSchema = z.object({
  data: z.array(eventDtoSchema),
  pagination: z.object({ nextCursor: z.string().nullable() }).strict(),
}).strict();
export const participantsResponseSchema = z.object({
  data: z.array(participantDtoSchema),
  pagination: z.object({ nextCursor: z.string().nullable() }).strict(),
}).strict();
