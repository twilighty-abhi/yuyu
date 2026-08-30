import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getClientIpFromHeaders, checkRateLimitById } from "@/lib/rateLimit";
import { CHECK_IN_STATION_COOKIE, createCheckInStationProof, hasValidCheckInStationProof, stationExpiresAt, verifyStationPin } from "@/lib/checkInStation";
import { gateCheckInForStatus, parseCheckInPayload } from "@/lib/checkIn";
import { getCheckInDetails, getRegistrationDetails } from "@/lib/checkInDetails";
import { commitCheckInProjection, commitUndoCheckInProjection } from "@/lib/checkInMutations";

const bodySchema = z.object({
  organisationSlug: z.string().trim().min(1).max(120), eventSlug: z.string().trim().min(1).max(160),
  action: z.enum(["unlock", "bootstrap", "previewToken", "previewRsvp", "checkInRsvp", "lookup", "undo"]),
  pin: z.string().trim().regex(/^\d{8}$/).optional(), rawInput: z.string().trim().min(1).max(2048).optional(),
  rsvpId: z.string().trim().min(1).max(128).optional(), query: z.string().trim().min(2).max(200).optional(), force: z.boolean().optional(),
}).strict().superRefine((value, ctx) => {
  if (value.action === "unlock" && !value.pin) ctx.addIssue({ code: "custom", path: ["pin"], message: "PIN is required." });
  if (value.action === "previewToken" && !value.rawInput) ctx.addIssue({ code: "custom", path: ["rawInput"], message: "Ticket input is required." });
  if (["previewRsvp", "checkInRsvp", "undo"].includes(value.action) && !value.rsvpId) ctx.addIssue({ code: "custom", path: ["rsvpId"], message: "RSVP is required." });
  if (value.action === "lookup" && !value.query) ctx.addIssue({ code: "custom", path: ["query"], message: "Search query is required." });
});

function failure(error = "Station access is unavailable.", status = 400) { return NextResponse.json({ ok: false, error }, { status }); }
function attendeeLabel(r: { user: { name: string | null; email: string | null } | null; guestName: string | null; guestEmail: string | null }) {
  return r.user?.name?.trim() || r.guestName?.trim() || r.user?.email || r.guestEmail || "Guest";
}
const rsvpInclude = { user: { select: { name: true, email: true } }, answers: { include: { field: { select: { key: true, label: true } } } } } as const;
type StationRsvp = Prisma.RSVPGetPayload<{ include: typeof rsvpInclude }>;
function toData(rsvp: StationRsvp, force = false) {
  return { rsvpId: rsvp.id, displayName: attendeeLabel(rsvp), email: rsvp.user?.email ?? rsvp.guestEmail, status: rsvp.status, alreadyCheckedIn: Boolean(rsvp.checkedInAt), checkedInAt: rsvp.checkedInAt?.toISOString() ?? null, checkInQrToken: rsvp.checkInToken, checkInDetails: getCheckInDetails(rsvp.answers), registrationDetails: getRegistrationDetails(rsvp.answers), gate: gateCheckInForStatus(rsvp.status, force) };
}

export async function POST(request: Request) {
  let input: z.infer<typeof bodySchema>;
  try { input = bodySchema.parse(await request.json()); } catch { return failure("Invalid request."); }
  const event = await prisma.event.findFirst({ where: { slug: input.eventSlug, organisation: { slug: input.organisationSlug } }, select: { id: true, title: true, slug: true, organisationId: true, startDateTime: true, endDateTime: true, checkInStationPinHash: true, checkInStationSecretVersion: true, organisation: { select: { slug: true, name: true, logoUrl: true } } } });
  if (!event || !event.checkInStationPinHash) return failure();
  if (input.action === "unlock") {
    const allowed = await checkRateLimitById("checkinStationPin", `ip:${getClientIpFromHeaders(request.headers)}:event:${event.id}`);
    if (!allowed) return failure("Too many attempts. Please try again shortly.", 429);
    if (!input.pin || !(await verifyStationPin(input.pin, event.checkInStationPinHash))) return failure("Unable to open this check-in station.", 401);
    const proof = createCheckInStationProof(event.id, event.checkInStationSecretVersion, event.startDateTime, event.endDateTime);
    if (!proof) return failure("This check-in station has closed.", 401);
    const response = NextResponse.json({ ok: true });
    // The station UI calls /api/check-in/station, so this must be available to
    // both the public page and its protected API. The signed proof itself is
    // still bound to one event and its current secret version.
    response.cookies.set(CHECK_IN_STATION_COOKIE, proof, { httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production", path: "/", expires: stationExpiresAt(event.endDateTime), priority: "high" });
    return response;
  }
  // Match the same cookie-selection behavior used by the server-rendered
  // station page rather than manually parsing a duplicate-cookie header.
  const proof = (await cookies()).get(CHECK_IN_STATION_COOKIE)?.value;
  if (!hasValidCheckInStationProof(proof, event.id, event.checkInStationSecretVersion, event.startDateTime, event.endDateTime)) return failure("Station access has expired.", 401);
  if (!(await checkRateLimitById("checkin", `station:${event.id}:${getClientIpFromHeaders(request.headers)}`))) return failure("Too many check-in requests. Please try again shortly.", 429);
  if (input.action === "bootstrap") {
    const [confirmed, checkedIn, recentRsvps, form] = await Promise.all([
      prisma.rSVP.count({ where: { eventId: event.id, status: "CONFIRMED" } }), prisma.rSVP.count({ where: { eventId: event.id, checkedInAt: { not: null } } }),
      prisma.rSVP.findMany({ where: { eventId: event.id, checkedInAt: { not: null } }, orderBy: { checkedInAt: "desc" }, take: 200, include: { user: { select: { name: true, email: true } } } }),
      prisma.eventRegistrationForm.findUnique({ where: { eventId: event.id }, select: { fields: { select: { key: true, label: true }, orderBy: { sortOrder: "asc" } } } }),
    ]);
    return NextResponse.json({ ok: true, data: { organisationName: event.organisation.name, organisationLogoUrl: event.organisation.logoUrl, eventId: event.id, eventTitle: event.title, registrationFields: form?.fields ?? [], stats: { confirmed, checkedIn }, recent: recentRsvps.map((r) => ({ rsvpId: r.id, displayName: attendeeLabel({ ...r, guestName: null }), email: r.user?.email ?? r.guestEmail, checkedInAt: r.checkedInAt!.toISOString() })) } });
  }
  let rsvp: StationRsvp | null = null;
  if (input.action === "previewToken") {
    const token = input.rawInput ? parseCheckInPayload(input.rawInput) : null;
    if (!token) return failure("Could not read a ticket code from that input.");
    rsvp = await prisma.rSVP.findFirst({ where: { eventId: event.id, checkInToken: token }, include: rsvpInclude });
  } else if (["previewRsvp", "checkInRsvp", "undo"].includes(input.action)) {
    rsvp = await prisma.rSVP.findFirst({ where: { id: input.rsvpId, eventId: event.id }, include: rsvpInclude });
  }
  if (input.action === "lookup") {
    const rows = await prisma.rSVP.findMany({ where: { eventId: event.id, OR: [{ guestName: { contains: input.query!, mode: "insensitive" } }, { guestEmail: { contains: input.query!, mode: "insensitive" } }, { user: { name: { contains: input.query!, mode: "insensitive" } } }, { user: { email: { contains: input.query!, mode: "insensitive" } } }] }, take: 12, orderBy: { createdAt: "desc" }, include: { user: { select: { name: true, email: true } } } });
    return NextResponse.json({ ok: true, data: { rows: rows.map((r) => ({ rsvpId: r.id, displayName: attendeeLabel({ ...r, guestName: r.guestName }), email: r.user?.email ?? r.guestEmail, status: r.status, checkedInAt: r.checkedInAt?.toISOString() ?? null })) } });
  }
  if (!rsvp) return failure("RSVP not found.");
  if (input.action === "undo") {
    const undone = await commitUndoCheckInProjection({ rsvpId: rsvp.id, actorUserId: null, source: "venue-station" });
    if (!undone) return failure("This attendee is not currently checked in.", 409);
    revalidatePath(`/${event.organisation.slug}/${event.slug}/check-in`);
    return NextResponse.json({ ok: true });
  }
  const data = toData(rsvp, Boolean(input.force));
  if (input.action.startsWith("preview")) return NextResponse.json({ ok: true, data });
  const gate = data.gate;
  if (!gate.ok) return NextResponse.json({ ok: false, error: gate.reason, needsForce: !gate.blocked });
  if (!rsvp.checkedInAt) {
    const now = new Date();
    const updated = await commitCheckInProjection({ rsvpId: rsvp.id, actorUserId: null, source: "venue-station", checkedInAt: now, force: Boolean(input.force) });
    if (updated.state === "checked-in") { data.checkedInAt = updated.checkedInAt.toISOString(); data.alreadyCheckedIn = false; }
    else {
      if (updated.state === "missing") return failure("RSVP not found.", 404);
      if (updated.state === "ineligible") {
        const currentGate = gateCheckInForStatus(updated.status, Boolean(input.force));
        return failure(currentGate.ok ? "Check-in could not be completed." : currentGate.reason, 409);
      }
      data.checkedInAt = updated.checkedInAt.toISOString(); data.alreadyCheckedIn = true;
    }
  }
  revalidatePath(`/${event.organisation.slug}/${event.slug}/check-in`);
  return NextResponse.json({ ok: true, data: { ...data, gate: undefined } });
}
