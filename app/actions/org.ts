"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { createOrganisationSchema } from "@/lib/validators";
import { flattenZodErrors } from "./utils";

export type ActionResult<T = void> =
  | { ok: true; data?: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

export async function createOrganisation(
  input: unknown,
): Promise<ActionResult<{ slug: string }>> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "You must be signed in." };
  }

  const parsed = createOrganisationSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Invalid input.",
      fieldErrors: flattenZodErrors(parsed.error),
    };
  }

  const { name, slug, description, logoUrl } = parsed.data;

  try {
    const org = await prisma.$transaction(async (tx) => {
      const created = await tx.organisation.create({
        data: {
          name,
          slug,
          description: description ?? "",
          logoUrl: logoUrl || null,
        },
      });
      await tx.membership.create({
        data: {
          userId: session.user.id,
          organisationId: created.id,
          role: "OWNER",
        },
      });
      return created;
    });

    revalidatePath("/dashboard");
    revalidatePath(`/${org.slug}`);
    return { ok: true, data: { slug: org.slug } };
  } catch (e: unknown) {
    if (
      typeof e === "object" &&
      e !== null &&
      "code" in e &&
      (e as { code: string }).code === "P2002"
    ) {
      return {
        ok: false,
        error: "That organisation URL is already taken.",
        fieldErrors: { slug: ["Already taken"] },
      };
    }
    console.error(e);
    return { ok: false, error: "Could not create organisation." };
  }
}
