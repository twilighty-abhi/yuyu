import type { Membership, MembershipRole } from "@prisma/client";
import { notFound, redirect } from "next/navigation";
import { cookies } from "next/headers";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { hasValidSuperAdminMfaProof, SUPER_ADMIN_MFA_COOKIE } from "@/lib/superAdminMfa";
import type { Session } from "next-auth";

const roleRank: Record<MembershipRole, number> = {
  MEMBER: 0,
  ADMIN: 1,
  OWNER: 2,
};

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

export function hasRoleAtLeast(
  role: MembershipRole,
  min: MembershipRole,
): boolean {
  return roleRank[role] >= roleRank[min];
}

export function isOrgAdmin(role: MembershipRole): boolean {
  return role === "OWNER" || role === "ADMIN";
}

/** Create, edit, delete events and manage attendees — OWNER or ADMIN. */
export function canManageEvents(m: Membership | null): boolean {
  return m != null && isOrgAdmin(m.role);
}

/** @deprecated Use canManageEvents — kept name for gradual migration */
export function canCreateEvent(m: Membership | null): m is Membership {
  return canManageEvents(m);
}

/** Publish, set PUBLISHED/HIDDEN on create or update — OWNER/ADMIN. */
export function canPublishEvents(m: Membership | null): boolean {
  return canManageEvents(m);
}

export function canManageMembers(m: Membership | null): boolean {
  return m?.role === "OWNER";
}

export function canDeleteOrg(m: Membership | null): boolean {
  return m?.role === "OWNER";
}

export async function requireAuth(): Promise<Session & { user: { id: string } }> {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  return session as Session & { user: { id: string } };
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Instance-wide super-admin gate.
 *
 * Access is granted only when `process.env.SUPER_ADMIN_EMAIL` is set and matches
 * the current signed-in user's email (case-insensitive).
 *
 * We return `notFound()` on mismatch to avoid leaking panel existence.
 */
export async function requireSuperAdmin(): Promise<
  Session & { user: { id: string; email: string } }
> {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const configured = process.env.SUPER_ADMIN_EMAIL;
  const userEmail = session.user.email;
  if (!configured || !userEmail) notFound();

  if (normalizeEmail(userEmail) !== normalizeEmail(configured)) notFound();

  return session as Session & { user: { id: string; email: string } };
}

/**
 * Require a fresh, separate TOTP challenge for the instance-wide admin panel.
 * The proof is a short-lived, signed HttpOnly cookie bound to the current user
 * and session version, so account/session revocation invalidates it immediately.
 */
export async function requireSuperAdminMfa() {
  const session = await requireSuperAdmin();
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { mfaEnabledAt: true, sessionVersion: true },
  });
  const proof = (await cookies()).get(SUPER_ADMIN_MFA_COOKIE)?.value;
  if (!user?.mfaEnabledAt || !hasValidSuperAdminMfaProof(proof, session.user.id, user.sessionVersion)) {
    redirect("/super-admin-mfa");
  }
  return session;
}

export type OrgAccessContext = {
  organisation: { id: string; slug: string; name: string };
  membership: Membership;
  userId: string;
};

export async function requireOrgRole(
  orgSlug: string,
  minRole: MembershipRole,
): Promise<OrgAccessContext> {
  const session = await requireAuth();
  const org = await prisma.organisation.findUnique({
    where: { slug: orgSlug },
  });
  if (!org) redirect("/dashboard");

  const membership = await getMembership(session.user.id, org.id);
  if (!membership) redirect("/dashboard");
  if (!hasRoleAtLeast(membership.role, minRole)) {
    redirect(`/dashboard/${orgSlug}`);
  }

  return {
    organisation: { id: org.id, slug: org.slug, name: org.name },
    membership,
    userId: session.user.id,
  };
}

export async function requireOrgMembership(
  orgSlug: string,
): Promise<OrgAccessContext> {
  return requireOrgRole(orgSlug, "MEMBER");
}
