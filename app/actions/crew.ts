"use server";

import { z } from "zod";
import { auth } from "@/lib/auth";
import { recordAuditEvent } from "@/lib/audit";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import { createSafeWebpDerivative } from "@/lib/imageValidation";
import { isUserEmailVerified } from "@/lib/permissions";
import { getPublicUrl, uploadFile } from "@/lib/storage";
import { revalidateEventWebsitePaths } from "@/lib/core/eventProgramme";
import { resolveOrganiserEvent, type OrganiserEventContext } from "@/lib/core/teams";
import {
  CREW_PHOTO_CATEGORY,
  addCrewMemberAsOrganiser,
  isCrewJoinTokenShape,
  joinCrewWithLink,
  loadCrewJoinPage,
  moveCrewMember,
  removeCrewMember,
  setCrewJoinLink,
  setCrewMemberVisibility,
  updateCrewMemberAsOrganiser,
  type OrganiserCrewContext,
} from "@/lib/core/crew";
import type { ActionResult } from "./org";

/*
 * Event crew (Guests → Crew, docs/CREW.md). Organiser actions need
 * MANAGE_REGISTRATIONS (the guest-list rule, via resolveOrganiserEvent) and
 * use the dashboard "action" rate-limit bucket. The crew link actions are public: the
 * link token is the capability, and both are rate limited per IP.
 */

const NO_PERMISSION = "You do not have permission to manage the crew for this event.";
const MAX_CREW_PHOTO_BYTES = 5 * 1024 * 1024;

const targetSchema = z.object({ organisationSlug: z.string().min(1).max(128), eventId: z.string().min(1).max(64) });
const memberTargetSchema = targetSchema.extend({ memberId: z.string().min(1).max(64) });

type Gate = { ok: true; event: OrganiserEventContext; crew: OrganiserCrewContext } | { ok: false; error: string };

async function gate(input: unknown, schema: z.ZodTypeAny = targetSchema): Promise<Gate & { data?: Record<string, unknown> }> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in." };
  // The dashboard editing budget: reordering or showing a whole crew is many quick calls.
  if (await isActionRateLimited("action", userId)) return { ok: false, error: "Too many crew updates. Try again shortly." };
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input." };
  const data = parsed.data as z.infer<typeof targetSchema>;
  const event = await resolveOrganiserEvent(userId, data.organisationSlug, data.eventId);
  if (!event) return { ok: false, error: NO_PERMISSION };
  return { ok: true, event, crew: { organisationId: event.organisationId, eventId: event.eventId, actorUserId: userId }, data: parsed.data as Record<string, unknown> };
}

function revalidate(event: OrganiserEventContext) {
  revalidateEventWebsitePaths(event.orgSlug, { id: event.eventId, slug: event.eventSlug });
}

async function audit(event: OrganiserEventContext, action: string, targetId: string) {
  await recordAuditEvent({ action, actorUserId: event.userId, organisationId: event.organisationId, targetType: "EventCrewMember", targetId });
}

/** Add a crew member and email them their ticket. `member` is the crew form. */
export async function addCrewMember(input: unknown): Promise<ActionResult<{ id: string }>> {
  const g = await gate(input, targetSchema.extend({ member: z.unknown() }));
  if (!g.ok) return g;
  const result = await addCrewMemberAsOrganiser(g.crew, g.data!.member);
  if (!result.ok) return result;
  await audit(g.event, "EVENT_CREW_MEMBER_ADDED", result.data.id);
  revalidate(g.event);
  return result;
}

export async function updateCrewMember(input: unknown): Promise<ActionResult> {
  const g = await gate(input, memberTargetSchema.extend({ member: z.unknown() }));
  if (!g.ok) return g;
  const memberId = g.data!.memberId as string;
  const result = await updateCrewMemberAsOrganiser(g.crew, memberId, g.data!.member);
  if (!result.ok) return result;
  await audit(g.event, "EVENT_CREW_MEMBER_UPDATED", memberId);
  revalidate(g.event);
  return { ok: true };
}

export async function setCrewMemberShown(input: unknown): Promise<ActionResult> {
  const g = await gate(input, memberTargetSchema.extend({ showOnPage: z.boolean() }));
  if (!g.ok) return g;
  const memberId = g.data!.memberId as string;
  const result = await setCrewMemberVisibility(g.crew, memberId, g.data!.showOnPage as boolean);
  if (!result.ok) return result;
  await audit(g.event, "EVENT_CREW_MEMBER_UPDATED", memberId);
  revalidate(g.event);
  return { ok: true };
}

/** Removes the member and cancels their crew ticket. */
export async function deleteCrewMember(input: unknown): Promise<ActionResult> {
  const g = await gate(input, memberTargetSchema);
  if (!g.ok) return g;
  const memberId = g.data!.memberId as string;
  const result = await removeCrewMember(g.crew, memberId);
  if (!result.ok) return result;
  await audit(g.event, "EVENT_CREW_MEMBER_REMOVED", memberId);
  revalidate(g.event);
  return { ok: true };
}

export async function reorderCrewMember(input: unknown): Promise<ActionResult> {
  const g = await gate(input, memberTargetSchema.extend({ direction: z.union([z.literal(-1), z.literal(1)]) }));
  if (!g.ok) return g;
  const result = await moveCrewMember(g.crew, g.data!.memberId as string, g.data!.direction as -1 | 1);
  if (!result.ok) return result;
  revalidate(g.event);
  return { ok: true };
}

/** Create, replace or turn off the crew sign-up link. Returns the token (null once off). */
export async function manageCrewJoinLink(input: unknown): Promise<ActionResult<{ token: string } | null>> {
  const g = await gate(input, targetSchema.extend({ action: z.enum(["create", "rotate", "disable"]) }));
  if (!g.ok) return g;
  const action = g.data!.action as "create" | "rotate" | "disable";
  const result = await setCrewJoinLink(g.crew, action);
  if (!result.ok) return result;
  await recordAuditEvent({
    action: action === "disable" ? "EVENT_CREW_LINK_DISABLED" : action === "rotate" ? "EVENT_CREW_LINK_ROTATED" : "EVENT_CREW_LINK_CREATED",
    actorUserId: g.event.userId,
    organisationId: g.event.organisationId,
    targetType: "Event",
    targetId: g.event.eventId,
  });
  return result;
}

async function storeCrewPhoto(file: File, organisationId: string): Promise<ActionResult<{ url: string }>> {
  if (file.size === 0 || file.size > MAX_CREW_PHOTO_BYTES) return { ok: false, error: "Crew photos must be 5 MB or smaller." };
  try {
    const derivative = await createSafeWebpDerivative(file, { width: 1200, height: 1200, fit: "cover", position: "attention" });
    if ("error" in derivative) return { ok: false, error: derivative.error };
    const key = `organisations/${organisationId}/${CREW_PHOTO_CATEGORY}/${crypto.randomUUID()}.webp`;
    await uploadFile({ key, body: derivative.body, contentType: "image/webp", organisationId });
    return { ok: true, data: { url: getPublicUrl(key) } };
  } catch {
    return { ok: false, error: "Could not upload the photo." };
  }
}

/** Organiser photo upload: FormData with organisationSlug, eventId and file. */
export async function uploadCrewPhoto(formData: FormData): Promise<ActionResult<{ url: string }>> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in." };
  if (!(await isUserEmailVerified(userId))) return { ok: false, error: "Verify your email before uploading crew photos." };
  if (await isActionRateLimited("upload", userId)) return { ok: false, error: "Too many uploads. Please try again later." };
  const parsed = targetSchema.safeParse({ organisationSlug: formData.get("organisationSlug"), eventId: formData.get("eventId") });
  const file = formData.get("file");
  if (!parsed.success || !(file instanceof File)) return { ok: false, error: "Choose a photo to upload." };
  const event = await resolveOrganiserEvent(userId, parsed.data.organisationSlug, parsed.data.eventId);
  if (!event) return { ok: false, error: NO_PERMISSION };
  const stored = await storeCrewPhoto(file, event.organisationId);
  if (stored.ok) await recordAuditEvent({ action: "EVENT_CREW_PHOTO_UPLOADED", actorUserId: userId, organisationId: event.organisationId, targetType: "Event", targetId: event.eventId });
  return stored;
}

/** Crew-link photo upload: FormData with token and file. Rate limited per IP and token. */
export async function uploadCrewPhotoWithLink(formData: FormData): Promise<ActionResult<{ url: string }>> {
  const token = formData.get("token");
  const file = formData.get("file");
  if (!isCrewJoinTokenShape(token) || !(file instanceof File)) return { ok: false, error: "Choose a photo to upload." };
  if (await isActionRateLimited("upload", token)) return { ok: false, error: "Too many uploads. Please try again later." };
  const page = await loadCrewJoinPage(token);
  if (!page?.open) return { ok: false, error: "This crew link is no longer valid. Ask the organisers for a new one." };
  return storeCrewPhoto(file, page.organisationId);
}

/** Self sign-up from /crew/[token]. `member` is the crew profile form. */
export async function joinCrew(input: unknown): Promise<ActionResult<{ eventTitle: string }>> {
  const parsed = z.object({ token: z.string().max(256), member: z.unknown() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input." };
  const email = typeof parsed.data.member === "object" && parsed.data.member && "email" in parsed.data.member ? String((parsed.data.member as { email: unknown }).email) : undefined;
  if (await isActionRateLimited("rsvp", email)) return { ok: false, error: "Too many sign-up attempts. Please try again shortly." };
  const result = await joinCrewWithLink(parsed.data.token, parsed.data.member);
  if (!result.ok) return result;
  const page = await loadCrewJoinPage(parsed.data.token);
  if (page) {
    await recordAuditEvent({ action: "EVENT_CREW_JOINED_WITH_LINK", organisationId: page.organisationId, targetType: "Event", targetId: page.eventId });
    revalidateEventWebsitePaths(page.organisationSlug, { id: page.eventId, slug: page.eventSlug });
  }
  return result;
}
