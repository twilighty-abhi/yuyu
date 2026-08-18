"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { createOrganisationSchema, updateOrganisationSchema } from "@/lib/validators";
import { flattenZodErrors } from "./utils";

export type ActionResult<T = void> =
  | { ok: true; data?: T }
  | {
      ok: false;
      error: string;
      fieldErrors?: Record<string, string[]>;
      /** e.g. check-in requires staff override for this RSVP status */
      needsForce?: boolean;
    };

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

export async function updateOrganisation(input: unknown): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "You must be signed in." };
  }

  const parsed = updateOrganisationSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Invalid input.",
      fieldErrors: flattenZodErrors(parsed.error),
    };
  }

  const { organisationSlug, name, description, logoUrl } = parsed.data;
  const org = await prisma.organisation.findUnique({
    where: { slug: organisationSlug },
    select: { id: true, slug: true },
  });
  if (!org) return { ok: false, error: "Organisation not found." };

  const membership = await prisma.membership.findUnique({
    where: {
      userId_organisationId: { userId: session.user.id, organisationId: org.id },
    },
    select: { role: true },
  });

  if (!membership || (membership.role !== "OWNER" && membership.role !== "ADMIN")) {
    return { ok: false, error: "Only organisation admins can edit settings." };
  }

  try {
    await prisma.organisation.update({
      where: { id: org.id },
      data: {
        name,
        description: description ?? "",
        logoUrl: logoUrl || null,
      },
    });
    revalidatePath(`/dashboard/${org.slug}`);
    revalidatePath(`/dashboard/${org.slug}/members`);
    revalidatePath(`/${org.slug}`);
    return { ok: true };
  } catch (e: unknown) {
    console.error(e);
    return { ok: false, error: "Could not update organisation." };
  }
}

const RESERVED_SLUGS = new Set([
  "dashboard",
  "discover",
  "login",
  "search",
  "super-admin",
  "api",
  "ticket",
  "join",
  "new",
  "org",
  "event",
  "series",
  "members",
  "settings",
  "static",
  "public",
  "assets"
]);

export async function checkSlugAvailability(slug: string): Promise<boolean> {
  const sanitized = slug.toLowerCase().trim();
  
  if (!sanitized) {
    return false;
  }
  
  if (RESERVED_SLUGS.has(sanitized)) {
    return false;
  }

  const count = await prisma.organisation.count({
    where: { slug: sanitized },
  });

  return count === 0;
}

