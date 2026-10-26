import "server-only";

import crypto from "node:crypto";
import { EventStatus, Prisma, RsvpStatus } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { enqueueRsvpConfirmation } from "@/lib/outbox";
import { isOrganisationUploadUrl, isUploadedImageUrl } from "@/lib/uploadUrl";
import { rsvpWebhookSnapshot, rsvpWebhookSnapshotSelect } from "@/lib/teamUnits";
import { emitWebhookEvent } from "@/lib/webhooks/emit";

/**
 * Event crew (docs/CREW.md): the people running an event. Every member owns
 * one CONFIRMED `RSVP` with `isCrew` for their QR ticket and check-in. Crew
 * count in headcounts but never against `Event.capacity` (`takesCapacity` in
 * lib/teamUnits.ts), never join teams, and are added, edited and removed only
 * here, never through the guest flows.
 *
 * Callers authorise first: organiser functions take an `OrganiserCrewContext`
 * resolved with `MANAGE_REGISTRATIONS`; the join-link functions take the raw
 * link token, which is the capability.
 */

export const CREW_PHOTO_CATEGORY = "event-crew";
export const MAX_CREW_MEMBERS = 500;
/** Offered as suggestions; any short text is accepted. */
export const FOOD_PREFERENCE_SUGGESTIONS = ["Vegetarian", "Non-vegetarian", "Vegan", "Jain", "Eggetarian", "No preference"] as const;

export type OrganiserCrewContext = { organisationId: string; eventId: string; actorUserId: string };
export type CrewResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

const httpUrl = z
  .string()
  .trim()
  .max(500)
  .url()
  // Zod 4 still runs this refinement after `.url()` fails, so it must not throw on a malformed value.
  .refine((value) => URL.canParse(value) && /^https?:$/.test(new URL(value).protocol), "Use an HTTP(S) URL");

/** Fields a crew member or organiser can set. Names follow the attendee rules: plain text, no markup. */
export const crewProfileSchema = z
  .object({
    name: z.string().trim().min(1, "Enter a name.").max(120),
    email: z.string().trim().toLowerCase().email("Enter a valid email address.").max(254),
    foodPreference: z.string().trim().max(80).default(""),
    role: z.string().trim().max(120).default(""),
    bio: z.string().trim().max(600).default(""),
    photoUrl: z.union([z.string().refine(isUploadedImageUrl, "Invalid uploaded image URL"), z.literal(""), z.null()]).optional(),
    linkedinUrl: z.union([httpUrl, z.literal(""), z.null()]).optional(),
  })
  .strict();

export const organiserCrewSchema = crewProfileSchema.extend({ showOnPage: z.boolean().default(true) }).strict();

export type CrewProfileInput = z.infer<typeof crewProfileSchema>;

/** The single shape crew rows leave this module in for organisers. */
const organiserCrewSelect = {
  id: true,
  name: true,
  email: true,
  foodPreference: true,
  role: true,
  bio: true,
  photoUrl: true,
  linkedinUrl: true,
  showOnPage: true,
  joinedViaLink: true,
  sortOrder: true,
  createdAt: true,
  rsvp: { select: { id: true, checkedInAt: true } },
} as const satisfies Prisma.EventCrewMemberSelect;

export type OrganiserCrewMember = {
  id: string;
  name: string;
  email: string;
  foodPreference: string;
  role: string;
  bio: string;
  photoUrl: string | null;
  linkedinUrl: string | null;
  showOnPage: boolean;
  joinedViaLink: boolean;
  sortOrder: number;
  createdAt: string;
  rsvpId: string;
  checkedInAt: string | null;
};

function toOrganiserCrewMember(row: Prisma.EventCrewMemberGetPayload<{ select: typeof organiserCrewSelect }>): OrganiserCrewMember {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    foodPreference: row.foodPreference,
    role: row.role,
    bio: row.bio,
    photoUrl: row.photoUrl,
    linkedinUrl: row.linkedinUrl,
    showOnPage: row.showOnPage,
    joinedViaLink: row.joinedViaLink,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt.toISOString(),
    rsvpId: row.rsvp.id,
    checkedInAt: row.rsvp.checkedInAt?.toISOString() ?? null,
  };
}

/** Food preferences grouped case-insensitively, most common first; blanks are "Not given". */
export function summariseFoodPreferences(values: readonly string[]): Array<{ label: string; count: number }> {
  const groups = new Map<string, { label: string; count: number }>();
  for (const raw of values) {
    const label = raw.trim() || "Not given";
    const key = label.toLowerCase();
    const group = groups.get(key);
    if (group) group.count += 1;
    else groups.set(key, { label, count: 1 });
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

export async function listCrewForOrganiser(ctx: OrganiserCrewContext): Promise<{ members: OrganiserCrewMember[]; food: Array<{ label: string; count: number }> }> {
  const rows = await prisma.eventCrewMember.findMany({
    where: { eventId: ctx.eventId, event: { organisationId: ctx.organisationId } },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: organiserCrewSelect,
    take: MAX_CREW_MEMBERS,
  });
  const members = rows.map(toOrganiserCrewMember);
  return { members, food: summariseFoodPreferences(members.map((member) => member.foodPreference)) };
}

/** Public crew cards: never the email, food preference or ticket. */
export type PublicCrewMember = { id: string; name: string; role: string; bio: string; photoUrl: string | null; linkedinUrl: string | null };

export async function listPublicCrew(eventId: string): Promise<PublicCrewMember[]> {
  return prisma.eventCrewMember.findMany({
    where: { eventId, showOnPage: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: { id: true, name: true, role: true, bio: true, photoUrl: true, linkedinUrl: true },
    take: MAX_CREW_MEMBERS,
  });
}

type EventForCrew = { id: string; organisationId: string; title: string; status: EventStatus; endDateTime: Date };

async function lockEventForCrew(tx: Prisma.TransactionClient, eventId: string): Promise<EventForCrew | null> {
  // The same Event row lock every capacity and team change takes, so turning an
  // attendee into crew cannot interleave with a registration on this event.
  await tx.$queryRaw`SELECT "id" FROM "Event" WHERE "id" = ${eventId} FOR UPDATE`;
  return tx.event.findUnique({ where: { id: eventId }, select: { id: true, organisationId: true, title: true, status: true, endDateTime: true } });
}

function cleanProfile(profile: CrewProfileInput) {
  return {
    name: profile.name,
    email: profile.email,
    foodPreference: profile.foodPreference,
    role: profile.role,
    bio: profile.bio,
    photoUrl: profile.photoUrl || null,
    linkedinUrl: profile.linkedinUrl || null,
  };
}

function isUniqueViolation(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/** Returned instead of a reason when a link sign-up must not change anything; the caller answers as for a duplicate. */
const LINK_SIGNUP_IGNORED = "link-signup-ignored";
const ALREADY_ON_CREW = "This email is already on the crew.";

/**
 * Add one crew member and issue their ticket. When the email already has a
 * solo registration for this event, that registration becomes their crew
 * ticket (it keeps its QR code and check-in, and frees its place); a team
 * member must leave their team first. Organisers can promote the waitlist
 * into a freed place as usual. Link sign-ups never convert a registration.
 */
async function addCrewMemberTx(
  event: EventForCrew,
  profile: CrewProfileInput,
  options: { showOnPage: boolean; joinedViaLink: boolean },
): Promise<CrewResult<{ id: string; rsvpId: string; created: boolean }>> {
  const data = cleanProfile(profile);
  if (data.photoUrl && !isOrganisationUploadUrl(data.photoUrl, event.organisationId, CREW_PHOTO_CATEGORY)) return fail("Choose an uploaded crew photo.");
  try {
    return await prisma.$transaction(async (tx) => {
      const locked = await lockEventForCrew(tx, event.id);
      if (!locked) return fail("Event not found.");
      if ((await tx.eventCrewMember.count({ where: { eventId: event.id } })) >= MAX_CREW_MEMBERS) return fail(`An event can have up to ${MAX_CREW_MEMBERS} crew members.`);
      if (await tx.eventCrewMember.findUnique({ where: { eventId_email: { eventId: event.id, email: data.email } }, select: { id: true } })) {
        return fail(ALREADY_ON_CREW);
      }
      const existing = await tx.rSVP.findFirst({
        where: { eventId: event.id, OR: [{ attendeeKey: `guest:${data.email}` }, { user: { email: { equals: data.email, mode: "insensitive" } } }] },
        select: { id: true, teamId: true, checkInToken: true, isCrew: true },
      });
      // The crew link proves nothing about who owns an email, so a link
      // sign-up never turns someone's registration into a crew ticket (that
      // would bypass approval or the waitlist and take away their self-cancel);
      // organisers convert registrations from Guests → Crew. Answered like a
      // duplicate so the link reveals nothing about who is registered.
      if (existing && options.joinedViaLink) return fail(LINK_SIGNUP_IGNORED);
      if (existing?.teamId) return fail("This person is registered in a team. Remove them from their team before adding them to the crew.");
      let rsvp: { id: string; checkInToken: string };
      let created = false;
      if (existing) {
        rsvp = await tx.rSVP.update({
          where: { id: existing.id },
          data: { isCrew: true, status: RsvpStatus.CONFIRMED },
          select: { id: true, checkInToken: true },
        });
        // A former seeker listing would let teams invite a crew member.
        await tx.teamSeekerProfile.deleteMany({ where: { rsvpId: existing.id } });
      } else {
        rsvp = await tx.rSVP.create({
          data: {
            eventId: event.id,
            guestEmail: data.email,
            guestName: data.name,
            attendeeKey: `guest:${data.email}`,
            status: RsvpStatus.CONFIRMED,
            isCrew: true,
          },
          select: { id: true, checkInToken: true },
        });
        created = true;
      }
      const last = await tx.eventCrewMember.aggregate({ where: { eventId: event.id }, _max: { sortOrder: true } });
      const member = await tx.eventCrewMember.create({
        data: { eventId: event.id, rsvpId: rsvp.id, ...data, showOnPage: options.showOnPage, joinedViaLink: options.joinedViaLink, sortOrder: (last._max.sortOrder ?? -1) + 1 },
        select: { id: true },
      });
      await enqueueRsvpConfirmation(tx, { to: data.email, eventTitle: locked.title, status: RsvpStatus.CONFIRMED, checkInToken: rsvp.checkInToken });
      return { ok: true as const, data: { id: member.id, rsvpId: rsvp.id, created } };
    });
  } catch (error) {
    if (isUniqueViolation(error)) return fail(ALREADY_ON_CREW);
    throw error;
  }
}

function emitCrewTicketCreated(result: CrewResult<{ rsvpId: string; created: boolean }>) {
  if (result.ok && result.data.created) emitWebhookEvent({ type: "registration.created", rsvpId: result.data.rsvpId });
}

async function organiserEvent(ctx: OrganiserCrewContext): Promise<EventForCrew | null> {
  return prisma.event.findFirst({
    where: { id: ctx.eventId, organisationId: ctx.organisationId },
    select: { id: true, organisationId: true, title: true, status: true, endDateTime: true },
  });
}

export async function addCrewMemberAsOrganiser(ctx: OrganiserCrewContext, input: unknown): Promise<CrewResult<{ id: string }>> {
  const parsed = organiserCrewSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the crew member's details.");
  const event = await organiserEvent(ctx);
  if (!event) return fail("Event not found.");
  const { showOnPage, ...profile } = parsed.data;
  const result = await addCrewMemberTx(event, profile, { showOnPage, joinedViaLink: false });
  emitCrewTicketCreated(result);
  return result.ok ? { ok: true, data: { id: result.data.id } } : result;
}

export async function updateCrewMemberAsOrganiser(ctx: OrganiserCrewContext, memberId: string, input: unknown): Promise<CrewResult> {
  const parsed = organiserCrewSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the crew member's details.");
  const event = await organiserEvent(ctx);
  if (!event) return fail("Event not found.");
  const { showOnPage, ...profile } = parsed.data;
  const data = cleanProfile(profile);
  if (data.photoUrl && !isOrganisationUploadUrl(data.photoUrl, event.organisationId, CREW_PHOTO_CATEGORY)) {
    // A member can keep the photo they already have; anything else must be a fresh crew upload.
    const current = await prisma.eventCrewMember.findFirst({ where: { id: memberId, eventId: event.id }, select: { photoUrl: true } });
    if (current?.photoUrl !== data.photoUrl) return fail("Choose an uploaded crew photo.");
  }
  try {
    return await prisma.$transaction(async (tx) => {
      const member = await tx.eventCrewMember.findFirst({ where: { id: memberId, eventId: event.id }, select: { id: true, rsvpId: true, rsvp: { select: { userId: true } } } });
      if (!member) return fail("Crew member not found.");
      await tx.eventCrewMember.update({ where: { id: member.id }, data: { ...data, showOnPage } });
      // Keep the ticket's name and email in step. An account-linked ticket
      // takes its identity from the account, so only guest tickets change.
      if (!member.rsvp.userId) {
        await tx.rSVP.update({ where: { id: member.rsvpId }, data: { guestName: data.name, guestEmail: data.email, attendeeKey: `guest:${data.email}` } });
      }
      return { ok: true as const, data: undefined };
    });
  } catch (error) {
    if (isUniqueViolation(error)) return fail("This email is already registered for this event.");
    throw error;
  }
}

/** Quick show/hide from the crew list without reopening the form. */
export async function setCrewMemberVisibility(ctx: OrganiserCrewContext, memberId: string, showOnPage: boolean): Promise<CrewResult> {
  const updated = await prisma.eventCrewMember.updateMany({
    where: { id: memberId, eventId: ctx.eventId, event: { organisationId: ctx.organisationId } },
    data: { showOnPage },
  });
  return updated.count === 1 ? { ok: true, data: undefined } : fail("Crew member not found.");
}

/** Removing a crew member cancels their crew ticket (and its check-in) with them. */
export async function removeCrewMember(ctx: OrganiserCrewContext, memberId: string): Promise<CrewResult<{ name: string }>> {
  const member = await prisma.eventCrewMember.findFirst({
    where: { id: memberId, eventId: ctx.eventId, event: { organisationId: ctx.organisationId } },
    select: { name: true, rsvp: { select: rsvpWebhookSnapshotSelect } },
  });
  if (!member) return fail("Crew member not found.");
  // The crew row cascades from the RSVP.
  const removed = await prisma.rSVP.deleteMany({ where: { id: member.rsvp.id, eventId: ctx.eventId, isCrew: true } });
  if (removed.count === 1) {
    emitWebhookEvent({ type: "registration.status_changed", rsvpId: member.rsvp.id, status: "CANCELLED", previousStatus: RsvpStatus.CONFIRMED, snapshot: rsvpWebhookSnapshot(member.rsvp) });
  }
  return { ok: true, data: { name: member.name } };
}

export async function moveCrewMember(ctx: OrganiserCrewContext, memberId: string, direction: -1 | 1): Promise<CrewResult> {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.eventCrewMember.findMany({
      where: { eventId: ctx.eventId, event: { organisationId: ctx.organisationId } },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: { id: true },
    });
    const index = rows.findIndex((row) => row.id === memberId);
    if (index < 0) return fail("Crew member not found.");
    const swap = index + direction;
    if (swap < 0 || swap >= rows.length) return { ok: true as const, data: undefined };
    [rows[index], rows[swap]] = [rows[swap]!, rows[index]!];
    for (const [sortOrder, row] of rows.entries()) await tx.eventCrewMember.update({ where: { id: row.id }, data: { sortOrder } });
    return { ok: true as const, data: undefined };
  });
}

/* ---------------------------------------------------------------------------
 * Crew join link
 * ------------------------------------------------------------------------- */

const CREW_TOKEN_BYTES = 32;

export function generateCrewJoinToken(): string {
  return crypto.randomBytes(CREW_TOKEN_BYTES).toString("base64url");
}

/** Shape check before any lookup, so malformed values never reach the database. */
export function isCrewJoinTokenShape(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{32,128}$/.test(value);
}

export function crewJoinPath(token: string): string {
  return `/crew/${encodeURIComponent(token)}`;
}

export async function getCrewJoinLink(ctx: OrganiserCrewContext): Promise<{ token: string; createdAt: string } | null> {
  const link = await prisma.eventCrewJoinLink.findFirst({
    where: { eventId: ctx.eventId, event: { organisationId: ctx.organisationId } },
    select: { token: true, createdAt: true },
  });
  return link ? { token: link.token, createdAt: link.createdAt.toISOString() } : null;
}

/** "create" keeps an existing link; "rotate" replaces it (the old link stops working); "disable" removes it. */
export async function setCrewJoinLink(ctx: OrganiserCrewContext, action: "create" | "rotate" | "disable"): Promise<CrewResult<{ token: string } | null>> {
  const event = await organiserEvent(ctx);
  if (!event) return fail("Event not found.");
  if (action === "disable") {
    await prisma.eventCrewJoinLink.deleteMany({ where: { eventId: event.id } });
    return { ok: true, data: null };
  }
  const token = generateCrewJoinToken();
  const link = await prisma.eventCrewJoinLink.upsert({
    where: { eventId: event.id },
    create: { eventId: event.id, token },
    update: action === "rotate" ? { token, createdAt: new Date() } : {},
    select: { token: true },
  });
  return { ok: true, data: { token: link.token } };
}

export type CrewJoinPage = {
  eventId: string;
  organisationId: string;
  organisationName: string;
  organisationSlug: string;
  eventTitle: string;
  eventSlug: string;
  startDateTime: string;
  timezone: string;
  /** False once the event is cancelled or over: the page explains instead of showing the form. */
  open: boolean;
};

/** What the public join page may show for a token: only the event and organiser names. */
export async function loadCrewJoinPage(token: unknown): Promise<CrewJoinPage | null> {
  if (!isCrewJoinTokenShape(token)) return null;
  const link = await prisma.eventCrewJoinLink.findUnique({
    where: { token },
    select: {
      event: {
        select: {
          id: true,
          title: true,
          slug: true,
          status: true,
          startDateTime: true,
          endDateTime: true,
          timezone: true,
          organisation: { select: { id: true, name: true, slug: true } },
        },
      },
    },
  });
  if (!link) return null;
  const { event } = link;
  return {
    eventId: event.id,
    organisationId: event.organisation.id,
    organisationName: event.organisation.name,
    organisationSlug: event.organisation.slug,
    eventTitle: event.title,
    eventSlug: event.slug,
    startDateTime: event.startDateTime.toISOString(),
    timezone: event.timezone,
    open: isCrewJoinOpen(event),
  };
}

function isCrewJoinOpen(event: { status: EventStatus; endDateTime: Date }) {
  return event.status !== EventStatus.CANCELLED && event.endDateTime > new Date();
}

/**
 * Self sign-up through the crew link. The member starts hidden from the
 * public page until an organiser reviews them, and gets their ticket by email.
 * Callers rate limit before calling.
 */
export async function joinCrewWithLink(token: unknown, input: unknown): Promise<CrewResult<{ eventTitle: string }>> {
  const page = await loadCrewJoinPage(token);
  if (!page) return fail("This crew link is no longer valid. Ask the organisers for a new one.");
  if (!page.open) return fail("This event is no longer taking crew sign-ups.");
  const parsed = crewProfileSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check your details.");
  const event = await prisma.event.findUnique({ where: { id: page.eventId }, select: { id: true, organisationId: true, title: true, status: true, endDateTime: true } });
  if (!event) return fail("This crew link is no longer valid. Ask the organisers for a new one.");
  const result = await addCrewMemberTx(event, parsed.data, { showOnPage: false, joinedViaLink: true });
  emitCrewTicketCreated(result);
  // Generic wording: the link must not reveal whether an email is already on the crew.
  if (!result.ok) return result.error === ALREADY_ON_CREW || result.error === LINK_SIGNUP_IGNORED ? { ok: true, data: { eventTitle: event.title } } : result;
  return { ok: true, data: { eventTitle: event.title } };
}
