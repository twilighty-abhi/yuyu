import { z } from "zod";

/*
 * Response DTOs for /api/mobile/v1. Every route parses its payload through
 * one of these strict schemas before responding, so an unexpected field (a
 * password hash, MFA secret, someone else's ticket token) fails loudly instead
 * of being serialized. docs/mobile-api.openapi.yaml and the fixtures in
 * docs/mobile-api-fixtures/ are tested against these schemas.
 */

const iso = z.string().datetime();
const url = z.string().url();

export const rsvpStatusSchema = z.enum(["CONFIRMED", "WAITLISTED", "PENDING_APPROVAL", "REJECTED"]);
export const eventStatusSchema = z.enum(["DRAFT", "PUBLISHED", "HIDDEN", "CANCELLED"]);
export const privacyTypeSchema = z.enum(["PUBLIC", "HIDDEN_LINK", "APPROVAL_REQUIRED", "INVITE_ONLY"]);
export const membershipRoleSchema = z.enum(["OWNER", "ADMIN", "MEMBER"]);
export const eventPermissionSchema = z.enum(["EDIT_DETAILS", "MANAGE_REGISTRATIONS", "MANAGE_INVITATIONS", "CHECK_IN", "PUBLISH_AND_SCHEDULE"]);
export const fieldTypeSchema = z.enum(["TEXT", "TEXTAREA", "EMAIL", "PHONE", "SELECT", "MULTI_SELECT", "RADIO", "CHECKBOX", "NUMBER", "DATE"]);
export const attendanceSchema = z.enum(["ANY", "CHECKED_IN", "NOT_CHECKED_IN"]);

export const errorEnvelopeSchema = z.object({
  ok: z.literal(false),
  error: z.object({
    code: z.enum(["INVALID_REQUEST", "UNAUTHENTICATED", "MFA_REQUIRED", "EMAIL_VERIFICATION_REQUIRED", "FORBIDDEN", "NOT_FOUND", "CONFLICT", "NEEDS_FORCE", "RATE_LIMITED", "TEAM_REQUIRED", "INTERNAL_ERROR"]),
    message: z.string(),
    fieldErrors: z.record(z.string(), z.array(z.string())).optional(),
  }).strict(),
}).strict();

export function successEnvelope<T extends z.ZodType>(data: T) {
  return z.object({ ok: z.literal(true), data }).strict();
}

/* ---------- Auth and account ---------- */

export const userDtoSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  email: z.string().nullable(),
  imageUrl: url.nullable(),
  emailVerified: z.boolean(),
  mfaEnabled: z.boolean(),
}).strict();

export const sessionDtoSchema = z.object({
  accessToken: z.string(),
  accessTokenExpiresAt: iso,
  refreshToken: z.string(),
  refreshTokenExpiresAt: iso,
  user: userDtoSchema,
}).strict();

export const authConfigDtoSchema = z.object({
  instanceName: z.string(),
  googleSignIn: z.object({ enabled: z.boolean(), webClientId: z.string().nullable() }).strict(),
  signupEnabled: z.boolean(),
  baseUrl: url,
}).strict();

export const orgSummarySchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  logoUrl: url.nullable(),
  role: membershipRoleSchema,
}).strict();

export const collaborationSchema = z.object({
  organisation: z.object({ slug: z.string(), name: z.string() }).strict(),
  eventId: z.string(),
  eventTitle: z.string(),
  permissions: z.array(eventPermissionSchema),
}).strict();

export const meDtoSchema = z.object({
  user: userDtoSchema,
  organisations: z.array(orgSummarySchema),
  collaborations: z.array(collaborationSchema),
}).strict();

/* ---------- Events ---------- */

export const eventSummarySchema = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  coverImageUrl: url.nullable(),
  startDateTime: iso,
  endDateTime: iso,
  timezone: z.string(),
  location: z.string(),
  mapLinkUrl: z.string().nullable(),
  isOnline: z.boolean(),
  accentColor: z.string().nullable(),
  status: eventStatusSchema,
  organisation: z.object({ slug: z.string(), name: z.string(), logoUrl: url.nullable() }).strict(),
}).strict();

export const eventListDtoSchema = z.object({
  events: z.array(eventSummarySchema),
  nextCursor: z.string().nullable(),
}).strict();

export const registrationDtoSchema = z.object({
  rsvpId: z.string(),
  status: rsvpStatusSchema,
  checkedInAt: iso.nullable(),
  registeredAt: iso,
  canCancel: z.boolean(),
  ticketToken: z.string().nullable(),
  event: eventSummarySchema,
  instanceId: z.string().nullable(),
}).strict();

export const registrationsDtoSchema = z.object({
  upcoming: z.array(registrationDtoSchema),
  past: z.array(registrationDtoSchema),
  certificates: z.array(z.object({
    eventTitle: z.string(),
    organisationName: z.string(),
    issuedAt: iso,
    certificateUrl: url,
  }).strict()),
}).strict();

export const shortLinkDtoSchema = z.object({ orgSlug: z.string(), eventSlug: z.string() }).strict();

export const registrationFieldSchema = z.object({
  id: z.string(),
  key: z.string(),
  label: z.string(),
  type: fieldTypeSchema,
  required: z.boolean(),
  helpText: z.string().nullable(),
  placeholder: z.string().nullable(),
  options: z.array(z.string()),
  settings: z.object({
    minLength: z.number().int().optional(),
    maxLength: z.number().int().optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    minDate: z.string().optional(),
    maxDate: z.string().optional(),
    maxSelections: z.number().int().optional(),
    allowOther: z.boolean().optional(),
  }).strict(),
  showIf: z.object({ fieldKey: z.string(), values: z.array(z.string()) }).strict().nullable(),
}).strict();

export const publicEventDtoSchema = z.object({
  event: eventSummarySchema.extend({
    description: z.string(),
    tags: z.array(z.string()),
    capacity: z.number().int().nullable(),
    showRegistrationCount: z.boolean(),
    confirmedCount: z.number().int().nullable(),
    privacyType: privacyTypeSchema,
    registrationOpen: z.boolean(),
    registrationFull: z.boolean(),
    registrationClosedReason: z.string().nullable(),
    onlineUrl: z.string().nullable(),
  }).strict(),
  registration: z.object({
    requiresApproval: z.boolean(),
    fields: z.array(registrationFieldSchema),
    myRsvp: z.object({ rsvpId: z.string(), status: rsvpStatusSchema, ticketToken: z.string().nullable() }).strict().nullable(),
  }).strict(),
  schedule: z.array(z.object({
    trackName: z.string().nullable(),
    sessions: z.array(z.object({
      id: z.string(),
      title: z.string(),
      startDateTime: iso,
      endDateTime: iso,
      delayMinutes: z.number().int(),
      room: z.string().nullable(),
      speakers: z.array(z.string()),
    }).strict()),
  }).strict()),
  speakers: z.array(z.object({ name: z.string(), title: z.string().nullable(), photoUrl: url.nullable() }).strict()),
  feedbackOpen: z.boolean(),
}).strict();

export const rsvpResultDtoSchema = z.object({
  rsvpId: z.string(),
  status: z.enum(["CONFIRMED", "WAITLISTED", "PENDING_APPROVAL"]),
  ticketToken: z.string().nullable(),
}).strict();

export const feedbackFormDtoSchema = z.object({
  title: z.string(),
  intro: z.string().nullable(),
  thankYouMessage: z.string(),
  open: z.literal(true),
  certificatesEnabled: z.boolean(),
  fields: z.array(registrationFieldSchema),
}).strict();

/* ---------- Organiser ---------- */

export const eventPermissionsSchema = z.object({
  checkIn: z.boolean(),
  manageRegistrations: z.boolean(),
  sendEmails: z.boolean(),
  schedule: z.boolean(),
  manageFeedback: z.boolean(),
  manageRegistrationWindow: z.boolean(),
}).strict();

export const eventCountsSchema = z.object({
  confirmed: z.number().int(),
  waitlisted: z.number().int(),
  pending: z.number().int(),
  checkedIn: z.number().int(),
  capacity: z.number().int().nullable(),
}).strict();

export const orgEventsDtoSchema = z.object({
  events: z.array(eventSummarySchema.extend({
    counts: eventCountsSchema.nullable(),
    myPermissions: eventPermissionsSchema,
  }).strict()),
}).strict();

export const orgEventDetailDtoSchema = z.object({
  event: eventSummarySchema.extend({
    privacyType: privacyTypeSchema,
    registrationOpen: z.boolean(),
    registrationClosesAt: iso.nullable(),
    registrationClosedReason: z.string().nullable(),
    registrationManuallyClosed: z.boolean(),
    feedbackOpen: z.boolean(),
    eventUrl: url,
    shortUrl: url.nullable(),
  }).strict(),
  counts: eventCountsSchema.nullable(),
  myPermissions: eventPermissionsSchema,
}).strict();

export const guestSchema = z.object({
  rsvpId: z.string(),
  displayName: z.string(),
  email: z.string().nullable(),
  status: rsvpStatusSchema,
  checkedInAt: iso.nullable(),
  registeredAt: iso,
  isGuest: z.boolean(),
}).strict();

const detailSchema = z.object({ label: z.string(), value: z.string() }).strict();

export const guestListDtoSchema = z.object({ guests: z.array(guestSchema), nextCursor: z.string().nullable() }).strict();
export const guestDetailDtoSchema = guestSchema.extend({ answers: z.array(detailSchema) }).strict();
export const undoDtoSchema = z.object({ undoId: z.string() }).strict();

export const checkInResultSchema = z.object({
  rsvpId: z.string(),
  displayName: z.string(),
  email: z.string().nullable(),
  status: rsvpStatusSchema,
  alreadyCheckedIn: z.boolean(),
  checkedInAt: iso.nullable(),
  checkInDetails: z.array(detailSchema),
  registrationDetails: z.array(detailSchema),
}).strict();

export const checkInPreviewSchema = checkInResultSchema.extend({
  gate: z.union([
    z.object({ ok: z.literal(true) }).strict(),
    z.object({ ok: z.literal(false), reason: z.string(), needsForce: z.boolean(), blocked: z.boolean().optional() }).strict(),
  ]),
}).strict();

export const lookupDtoSchema = z.object({ rows: z.array(guestSchema) }).strict();

export const checkInStatsDtoSchema = z.object({
  confirmed: z.number().int(),
  checkedIn: z.number().int(),
  recent: z.array(z.object({ rsvpId: z.string(), displayName: z.string(), checkedInAt: iso }).strict()),
}).strict();

export const rosterDtoSchema = z.object({
  generatedAt: iso,
  rows: z.array(guestSchema.extend({
    ticketToken: z.string(),
    checkInDetails: z.array(detailSchema),
    registrationDetails: z.array(detailSchema),
  }).strict()),
}).strict();

export const syncDtoSchema = z.object({
  syncedIds: z.array(z.string()),
  alreadyCheckedInIds: z.array(z.string()),
  failed: z.array(z.object({ rsvpId: z.string(), error: z.string() }).strict()),
}).strict();

export const broadcastsMetaDtoSchema = z.object({
  templates: z.array(z.object({
    id: z.string(),
    group: z.string(),
    name: z.string(),
    description: z.string(),
    subject: z.string(),
    bodyHtml: z.string(),
    audience: z.object({ statuses: z.array(rsvpStatusSchema), attendance: attendanceSchema }).strict(),
  }).strict()),
  designs: z.array(z.object({ id: z.string(), label: z.string(), description: z.string() }).strict()),
  placeholders: z.array(z.string()),
  history: z.array(z.object({
    id: z.string(),
    subject: z.string(),
    design: z.string(),
    audience: z.object({ statuses: z.array(rsvpStatusSchema), attendance: attendanceSchema }).strict(),
    recipientCount: z.number().int(),
    sentAt: iso,
    bodyHtml: z.string(),
  }).strict()),
}).strict();

export const broadcastCountDtoSchema = z.object({ count: z.number().int() }).strict();
export const broadcastPreviewDtoSchema = z.object({ subject: z.string(), html: z.string(), text: z.string() }).strict();
export const broadcastTestDtoSchema = z.object({ to: z.string() }).strict();
export const broadcastSendDtoSchema = z.object({ broadcastId: z.string(), recipientCount: z.number().int() }).strict();

export const scheduleDtoSchema = z.object({
  tracks: z.array(z.object({
    id: z.string().nullable(),
    name: z.string(),
    sessions: z.array(z.object({
      id: z.string(),
      title: z.string(),
      startDateTime: iso,
      endDateTime: iso,
      delayMinutes: z.number().int(),
    }).strict()),
  }).strict()),
}).strict();

export const feedbackStateDtoSchema = z.object({ open: z.boolean() }).strict();
export const registrationStateDtoSchema = z.object({
  registrationOpen: z.boolean(),
  registrationClosesAt: iso.nullable(),
  registrationClosedReason: z.string().nullable(),
  registrationManuallyClosed: z.boolean(),
}).strict();

export type UserDto = z.infer<typeof userDtoSchema>;
export type EventSummaryDto = z.infer<typeof eventSummarySchema>;
export type GuestDto = z.infer<typeof guestSchema>;
export type EventPermissionsDto = z.infer<typeof eventPermissionsSchema>;
export type EventCountsDto = z.infer<typeof eventCountsSchema>;
export type RegistrationFieldDto = z.infer<typeof registrationFieldSchema>;
