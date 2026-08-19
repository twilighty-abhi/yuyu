import "server-only";

import { auth } from "@/lib/auth";

const SENSITIVE_ACTION_MAX_AGE_MS = 10 * 60_000;

/**
 * JWT sessions carry the instant at which the user last completed sign-in.
 * Sensitive changes require a fresh sign-in, including through OAuth, rather
 * than trusting an indefinitely old browser session.
 */
export async function hasRecentAuthentication() {
  const session = await auth();
  const authenticatedAt = (session as (typeof session & { authenticatedAt?: number }) | null)?.authenticatedAt;
  return typeof authenticatedAt === "number" && Date.now() - authenticatedAt <= SENSITIVE_ACTION_MAX_AGE_MS;
}
