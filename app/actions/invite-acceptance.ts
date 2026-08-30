"use server";

import { z } from "zod";
import { auth } from "@/lib/auth";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import { acceptEventCollaboratorInviteToken, acceptOrganisationInviteToken } from "@/lib/inviteAcceptance";
import type { ActionResult } from "./org";

const tokenSchema = z.string().trim().min(20).max(256).regex(/^[A-Za-z0-9_-]+$/);

export async function acceptOrganisationInvite(input: unknown): Promise<ActionResult<{ href: string }>> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Sign in before accepting this invite." };
  const token = tokenSchema.safeParse(input);
  if (!token.success) return { ok: false, error: "This invite is unavailable." };
  if (await isActionRateLimited("invite", session.user.id)) return { ok: false, error: "Too many attempts. Please try again later." };
  const result = await acceptOrganisationInviteToken(token.data, session.user.id);
  return result.ok ? { ok: true, data: { href: result.href } } : { ok: false, error: "This invite is unavailable." };
}

export async function acceptEventCollaboratorInvite(input: unknown): Promise<ActionResult<{ href: string }>> {
  const session = await auth();
  if (!session?.user?.id || !session.user.email) return { ok: false, error: "Sign in with the invited account." };
  const token = tokenSchema.safeParse(input);
  if (!token.success) return { ok: false, error: "This invite is unavailable." };
  if (await isActionRateLimited("invite", session.user.id)) return { ok: false, error: "Too many attempts. Please try again later." };
  const result = await acceptEventCollaboratorInviteToken(token.data, { id: session.user.id, email: session.user.email });
  if (result.ok) return { ok: true, data: { href: result.href } };
  return { ok: false, error: result.reason === "wrong-account" ? "Sign in with the invited email address." : "This invite is unavailable." };
}
