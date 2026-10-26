import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { submitRsvpCore } from "@/lib/rsvpCore";
import { teamRegistrationIntentSchema, type TeamRegistrationIntent } from "@/lib/validators";
import { flattenZodErrors } from "@/app/actions/utils";
import { withApiMonitoring } from "@/lib/apiMonitor";
import crypto from "node:crypto";
import { checkRateLimitById, getClientIpFromHeaders } from "@/lib/rateLimit";

export const POST = withApiMonitoring("POST /api/rsvp", async (request: Request) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON." }, { status: 400 });
  }

  const guestEmail = typeof body === "object" && body !== null && "guestEmail" in body && typeof (body as { guestEmail?: unknown }).guestEmail === "string"
    ? (body as { guestEmail: string }).guestEmail.trim().toLowerCase()
    : null;
  const subjects = [`ip:${getClientIpFromHeaders(request.headers)}`];
  if (guestEmail) subjects.push(`subject:${crypto.createHash("sha256").update(guestEmail).digest("hex").slice(0, 32)}`);
  const limits = await Promise.all(subjects.map((subject) => checkRateLimitById("rsvp", subject)));
  if (limits.some((allowed) => !allowed)) {
    return NextResponse.json({ ok: false, error: "Too many registration attempts. Please try again shortly." }, { status: 429, headers: { "Retry-After": "60", "Cache-Control": "no-store" } });
  }

  // Team events (docs/TEAMS.md): `team` says whether to create a team, join
  // one with a join-link token, or register solo. It is optional; without it
  // the registration is solo, which a teams-only event refuses.
  let team: TeamRegistrationIntent | undefined;
  const rawTeam = typeof body === "object" && body !== null && "team" in body ? (body as { team?: unknown }).team : undefined;
  if (rawTeam !== undefined && rawTeam !== null) {
    const parsedTeam = teamRegistrationIntentSchema.safeParse(rawTeam);
    if (!parsedTeam.success) {
      const fieldErrors = flattenZodErrors(parsedTeam.error);
      const first = Object.entries(fieldErrors).find(([key]) => key !== "_root" && key !== "mode")?.[1][0];
      return NextResponse.json(
        { ok: false, error: first ?? "Check the team details and try again.", fieldErrors: Object.fromEntries(Object.entries(fieldErrors).map(([key, value]) => [`team.${key}`, value])) },
        { status: 400 },
      );
    }
    team = parsedTeam.data;
  }

  const session = await auth();
  const userId = session?.user?.id ?? null;

  const result = await submitRsvpCore(body, { userId, team });

  if (result.ok && result.data) {
    const orgSlug =
      typeof body === "object" &&
      body !== null &&
      "orgSlug" in body &&
      typeof (body as { orgSlug: unknown }).orgSlug === "string"
        ? (body as { orgSlug: string }).orgSlug
        : null;
    const eventSlug =
      typeof body === "object" &&
      body !== null &&
      "eventSlug" in body &&
      typeof (body as { eventSlug: unknown }).eventSlug === "string"
        ? (body as { eventSlug: string }).eventSlug
        : null;
    const eventInstanceId =
      typeof body === "object" &&
      body !== null &&
      "eventInstanceId" in body &&
      typeof (body as { eventInstanceId: unknown }).eventInstanceId === "string"
        ? (body as { eventInstanceId: string }).eventInstanceId
        : null;
    if (orgSlug) {
      if (eventSlug) {
        revalidatePath(`/${orgSlug}/${eventSlug}`);
      }
      if (eventInstanceId) {
        revalidatePath(`/${orgSlug}/i/${eventInstanceId}`);
      }
      revalidatePath(`/${orgSlug}`);
    }
  }

  if (!result.ok) {
    return NextResponse.json(result, { status: 400 });
  }

  return NextResponse.json(result);
});
