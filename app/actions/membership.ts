"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  canDeleteOrg,
  canManageMembers,
  getMembership,
  isOrgAdmin,
} from "@/lib/permissions";
import {
  deleteOrganisationSchema,
  removeMemberSchema,
  updateMemberRoleSchema,
} from "@/lib/validators";
import type { ActionResult } from "./org";
import { flattenZodErrors } from "./utils";

export async function updateMemberRole(
  input: unknown,
): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "You must be signed in." };
  }

  const parsed = updateMemberRoleSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Invalid input.",
      fieldErrors: flattenZodErrors(parsed.error),
    };
  }

  const { organisationSlug, targetUserId, role } = parsed.data;
  const org = await prisma.organisation.findUnique({
    where: { slug: organisationSlug },
  });
  if (!org) return { ok: false, error: "Organisation not found." };

  const actor = await getMembership(session.user.id, org.id);
  if (!canManageMembers(actor)) {
    return { ok: false, error: "Only the organisation owner can change roles." };
  }

  const target = await getMembership(targetUserId, org.id);
  if (!target) return { ok: false, error: "Member not found." };
  if (target.role === "OWNER") {
    return { ok: false, error: "The owner role cannot be changed here." };
  }

  await prisma.membership.update({
    where: { id: target.id },
    data: { role },
  });

  revalidatePath(`/dashboard/${org.slug}/members`);
  revalidatePath(`/dashboard/${org.slug}`);
  return { ok: true };
}

export async function removeMember(input: unknown): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "You must be signed in." };
  }

  const parsed = removeMemberSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Invalid input.",
      fieldErrors: flattenZodErrors(parsed.error),
    };
  }

  const { organisationSlug, targetUserId } = parsed.data;
  if (targetUserId === session.user.id) {
    return { ok: false, error: "You cannot remove yourself this way." };
  }

  const org = await prisma.organisation.findUnique({
    where: { slug: organisationSlug },
  });
  if (!org) return { ok: false, error: "Organisation not found." };

  const actor = await getMembership(session.user.id, org.id);
  if (!actor || !isOrgAdmin(actor.role)) {
    return { ok: false, error: "You do not have permission to remove members." };
  }

  const target = await getMembership(targetUserId, org.id);
  if (!target) return { ok: false, error: "Member not found." };
  if (target.role === "OWNER") {
    return { ok: false, error: "Cannot remove the organisation owner." };
  }
  if (actor.role === "ADMIN" && target.role !== "MEMBER") {
    return { ok: false, error: "Admins can only remove members." };
  }

  await prisma.membership.delete({ where: { id: target.id } });

  revalidatePath(`/dashboard/${org.slug}/members`);
  revalidatePath(`/dashboard/${org.slug}`);
  return { ok: true };
}

export async function deleteOrganisation(input: unknown): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "You must be signed in." };
  }

  const parsed = deleteOrganisationSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Invalid input.",
      fieldErrors: flattenZodErrors(parsed.error),
    };
  }

  const org = await prisma.organisation.findUnique({
    where: { slug: parsed.data.organisationSlug },
  });
  if (!org) return { ok: false, error: "Organisation not found." };

  const membership = await getMembership(session.user.id, org.id);
  if (!canDeleteOrg(membership)) {
    return { ok: false, error: "Only the organisation owner can delete it." };
  }

  const slug = org.slug;
  await prisma.organisation.delete({ where: { id: org.id } });

  revalidatePath("/dashboard");
  revalidatePath(`/${slug}`);
  return { ok: true };
}
