"use server";

import crypto from "crypto";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getMembership, isOrgAdmin } from "@/lib/permissions";
import { createOrgInviteSchema, revokeOrgInviteSchema } from "@/lib/validators";
import type { ActionResult } from "./org";
import { flattenZodErrors } from "./utils";

function randomToken(): string {
  // 32 chars of base64url-ish entropy, no padding.
  return crypto.randomBytes(24).toString("base64url");
}

export async function createOrgInvite(input: unknown): Promise<
  ActionResult<{ token: string; inviteId: string }>
> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "You must be signed in." };
  }

  const parsed = createOrgInviteSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Invalid input.",
      fieldErrors: flattenZodErrors(parsed.error),
    };
  }

  const { organisationSlug } = parsed.data;
  const org = await prisma.organisation.findUnique({
    where: { slug: organisationSlug },
  });
  if (!org) return { ok: false, error: "Organisation not found." };

  const membership = await getMembership(session.user.id, org.id);
  if (!membership || !isOrgAdmin(membership.role)) {
    return { ok: false, error: "You do not have permission to invite members." };
  }

  // Single-use link. Default expiry: 7 days.
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  // Retry on token collision (very unlikely, but unique constraint exists).
  for (let attempt = 0; attempt < 3; attempt++) {
    const token = randomToken();
    try {
      const invite = await prisma.organisationInvite.create({
        data: {
          organisationId: org.id,
          token,
          role: "MEMBER",
          createdByUserId: session.user.id,
          expiresAt,
        },
        select: { id: true, token: true },
      });
      revalidatePath(`/dashboard/${org.slug}/members`);
      return { ok: true, data: { token: invite.token, inviteId: invite.id } };
    } catch (e: unknown) {
      if (
        typeof e === "object" &&
        e !== null &&
        "code" in e &&
        (e as { code: string }).code === "P2002"
      ) {
        continue;
      }
      console.error(e);
      return { ok: false, error: "Could not create invite link." };
    }
  }

  return { ok: false, error: "Could not create invite link. Please try again." };
}

export async function revokeOrgInvite(input: unknown): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "You must be signed in." };
  }

  const parsed = revokeOrgInviteSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Invalid input.",
      fieldErrors: flattenZodErrors(parsed.error),
    };
  }

  const { organisationSlug, inviteId } = parsed.data;
  const org = await prisma.organisation.findUnique({
    where: { slug: organisationSlug },
  });
  if (!org) return { ok: false, error: "Organisation not found." };

  const membership = await getMembership(session.user.id, org.id);
  if (!membership || !isOrgAdmin(membership.role)) {
    return { ok: false, error: "You do not have permission." };
  }

  const invite = await prisma.organisationInvite.findFirst({
    where: { id: inviteId, organisationId: org.id },
    select: { id: true, usedAt: true },
  });
  if (!invite) return { ok: false, error: "Invite not found." };
  if (invite.usedAt) return { ok: false, error: "Invite is already used." };

  await prisma.organisationInvite.delete({ where: { id: invite.id } });
  revalidatePath(`/dashboard/${org.slug}/members`);
  return { ok: true };
}

