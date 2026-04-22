"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { submitRsvpCore } from "@/lib/rsvpCore";
import type { ActionResult } from "./org";

export async function submitRsvp(
  input: unknown,
): Promise<ActionResult<{ count: number }>> {
  const session = await auth();
  const userId = session?.user?.id ?? null;
  const result = await submitRsvpCore(input, { userId });

  if (result.ok) {
    const orgSlug =
      typeof input === "object" &&
      input !== null &&
      "orgSlug" in input &&
      typeof (input as { orgSlug: unknown }).orgSlug === "string"
        ? (input as { orgSlug: string }).orgSlug
        : null;
    const eventSlug =
      typeof input === "object" &&
      input !== null &&
      "eventSlug" in input &&
      typeof (input as { eventSlug: unknown }).eventSlug === "string"
        ? (input as { eventSlug: string }).eventSlug
        : null;
    if (orgSlug && eventSlug) {
      revalidatePath(`/${orgSlug}/${eventSlug}`);
      revalidatePath(`/${orgSlug}`);
    }
  }

  return result;
}
