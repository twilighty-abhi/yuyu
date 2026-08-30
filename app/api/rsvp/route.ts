import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { submitRsvpCore } from "@/lib/rsvpCore";
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

  const session = await auth();
  const userId = session?.user?.id ?? null;

  const result = await submitRsvpCore(body, { userId });

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
