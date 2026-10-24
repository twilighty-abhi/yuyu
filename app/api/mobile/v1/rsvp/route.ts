import crypto from "node:crypto";
import { RsvpStatus } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { submitRsvpCore } from "@/lib/rsvpCore";
import { mobileActionError, mobileError, mobileOk, readJsonBody } from "@/lib/mobile/http";
import { mobileRoute } from "@/lib/mobile/route";
import { rsvpResultDtoSchema } from "@/lib/mobile/schemas";
import { checkRateLimitById, getClientIpFromHeaders } from "@/lib/rateLimit";

function stringField(body: unknown, key: string) {
  return typeof body === "object" && body !== null && key in body && typeof (body as Record<string, unknown>)[key] === "string"
    ? (body as Record<string, string>)[key]!
    : null;
}

/**
 * Same body, service and limits as POST /api/rsvp. A valid bearer identifies
 * the attendee (the signed-in RSVP flow); otherwise the guest flow applies.
 */
export const POST = mobileRoute("POST /api/mobile/v1/rsvp", async (request, _params, { auth }) => {
  const body = await readJsonBody(request, 128 * 1024);
  if ("response" in body) return body.response;

  const guestEmail = stringField(body.value, "guestEmail")?.trim().toLowerCase() ?? null;
  const subjects = [`ip:${getClientIpFromHeaders(request.headers)}`];
  if (guestEmail) subjects.push(`subject:${crypto.createHash("sha256").update(guestEmail).digest("hex").slice(0, 32)}`);
  const limits = await Promise.all(subjects.map((subject) => checkRateLimitById("rsvp", subject)));
  if (limits.some((allowed) => !allowed)) return mobileError("RATE_LIMITED", "Too many registration attempts. Please try again shortly.");

  // No team intent: the app always registers solo (docs/TEAMS.md). A team
  // event that registers teams only fails with code TEAM_REQUIRED, which
  // mobileActionError maps to the TEAM_REQUIRED error code.
  const result = await submitRsvpCore(body.value, { userId: auth?.userId ?? null });
  if (!result.ok) return mobileActionError(result);
  if (!result.data) return mobileError("INTERNAL_ERROR");

  const orgSlug = stringField(body.value, "orgSlug");
  const eventSlug = stringField(body.value, "eventSlug");
  const eventInstanceId = stringField(body.value, "eventInstanceId");
  if (orgSlug) {
    if (eventSlug) revalidatePath(`/${orgSlug}/${eventSlug}`);
    if (eventInstanceId) revalidatePath(`/${orgSlug}/i/${eventInstanceId}`);
    revalidatePath(`/${orgSlug}`);
  }

  const rsvp = await prisma.rSVP.findUnique({ where: { checkInToken: result.data.ticketToken }, select: { id: true } });
  if (!rsvp) return mobileError("INTERNAL_ERROR");
  const status = result.data.status;
  if (status === RsvpStatus.REJECTED) return mobileError("CONFLICT");
  return mobileOk(rsvpResultDtoSchema.parse({
    rsvpId: rsvp.id,
    status,
    ticketToken: status === RsvpStatus.CONFIRMED ? result.data.ticketToken : null,
  }));
}, { optionalAuth: true });
