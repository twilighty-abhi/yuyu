import type { Membership, MembershipRole } from "@prisma/client";
import { prisma } from "@/lib/db";

export async function getMembership(
  userId: string,
  organisationId: string,
): Promise<Membership | null> {
  return prisma.membership.findUnique({
    where: {
      userId_organisationId: { userId, organisationId },
    },
  });
}

export function isOrgAdmin(role: MembershipRole): boolean {
  return role === "OWNER" || role === "ADMIN";
}

/** Any organisation member may create events (Phase 1 plan). */
export function canCreateEvent(m: Membership | null): m is Membership {
  return m != null;
}

/** Publish or set PUBLISHED on create — OWNER/ADMIN only. */
export function canPublishEvents(m: Membership | null): boolean {
  return m != null && isOrgAdmin(m.role);
}
