import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { submitRsvpCore } from "@/lib/rsvpCore";
import { withApiMonitoring } from "@/lib/apiMonitor";

export const POST = withApiMonitoring("POST /api/rsvp", async (request: Request) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON." }, { status: 400 });
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
