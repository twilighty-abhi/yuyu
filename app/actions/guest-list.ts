"use server";

import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import { canManageRegistrationsFor } from "@/lib/eventAccess";
import { getRequestOrigin } from "@/lib/publicUrl";
import { ATTENDEE_KIND_FILTERS, ATTENDEE_STATUS_FILTERS, ATTENDEE_TEAM_FILTERS, type AttendeeScope } from "@/lib/attendeeListQuery";
import { listAttendeesPage, type AttendeesPage } from "@/lib/eventDashboard/attendees";
import type { ActionResult } from "./org";

/*
 * Read-only paging for Guests · People (the event dashboard and a series
 * occurrence). The same check as every RSVP lifecycle action:
 * `canManageRegistrationsFor` (organisation OWNER/ADMIN, or the exact
 * MANAGE_REGISTRATIONS grant on the event or the occurrence's series), on the
 * search rate-limit bucket. Filters and search run on the server.
 */

const NO_PERMISSION = "You do not have permission to manage attendees.";

const id = z.string().trim().min(1).max(128);

const attendeesPageInputSchema = z
  .object({
    organisationSlug: z.string().trim().min(1).max(200),
    eventId: id.optional(),
    eventInstanceId: id.optional(),
    query: z.string().max(100).optional(),
    status: z.enum(ATTENDEE_STATUS_FILTERS).optional(),
    kind: z.enum(ATTENDEE_KIND_FILTERS).optional(),
    team: z.enum(ATTENDEE_TEAM_FILTERS).optional(),
    cursor: z.string().max(160).nullable().optional(),
  })
  .strict()
  .refine((value) => Boolean(value.eventId) !== Boolean(value.eventInstanceId), { message: "Choose one event or occurrence." });

export async function loadAttendeesPage(input: unknown): Promise<ActionResult<AttendeesPage>> {
  const parsed = attendeesPageInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input." };
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in." };
  if (await isActionRateLimited("search", userId)) return { ok: false, error: "Too many searches. Try again shortly." };

  const { organisationSlug, eventId, eventInstanceId, query, status, kind, team, cursor } = parsed.data;
  const org = await prisma.organisation.findUnique({ where: { slug: organisationSlug }, select: { id: true } });
  if (!org) return { ok: false, error: NO_PERMISSION };
  if (!(await canManageRegistrationsFor({ userId, organisationId: org.id, eventId, eventInstanceId }))) return { ok: false, error: NO_PERMISSION };

  let scope: AttendeeScope;
  let teamMode = false;
  if (eventId) {
    const event = await prisma.event.findFirst({ where: { id: eventId, organisationId: org.id }, select: { id: true, registrationMode: true } });
    if (!event) return { ok: false, error: NO_PERMISSION };
    scope = { kind: "event", eventId: event.id, organisationId: org.id };
    teamMode = event.registrationMode === "TEAM";
  } else {
    scope = { kind: "instance", eventInstanceId: eventInstanceId!, organisationId: org.id };
  }
  const page = await listAttendeesPage(scope, { query, status, kind, team, cursor: cursor ?? null }, { origin: await getRequestOrigin(), teamMode });
  return { ok: true, data: page };
}
