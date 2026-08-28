import "server-only";

import crypto from "node:crypto";
import { prisma } from "@/lib/db";
import { hashApiSecret, parseApiCredential } from "@/lib/api/v1/credentialSecret";

export { generateApiCredential, hashApiSecret, parseApiCredential } from "@/lib/api/v1/credentialSecret";

export type ApiAuthContext = {
  apiClientId: string;
  credentialId: string;
  organisationId: string;
  scopes: ReadonlySet<string>;
  lastUsedAt: Date | null;
};

export async function authenticateApiCredential(
  authorization: string | null,
): Promise<ApiAuthContext | null> {
  const parsed = parseApiCredential(authorization);
  if (!parsed) return null;

  const presentedHash = hashApiSecret(parsed.secret);
  const credential = await prisma.apiCredential.findUnique({
    where: { id: parsed.credentialId },
    select: {
      id: true,
      secretHash: true,
      revokedAt: true,
      expiresAt: true,
      lastUsedAt: true,
      apiClient: {
        select: {
          id: true,
          organisationId: true,
          status: true,
          scopes: { select: { scope: true } },
        },
      },
    },
  });

  if (!credential || credential.secretHash.length !== presentedHash.length) return null;
  if (!crypto.timingSafeEqual(credential.secretHash, presentedHash)) return null;
  const now = new Date();
  if (credential.revokedAt || (credential.expiresAt && credential.expiresAt <= now)) return null;
  if (credential.apiClient.status !== "ACTIVE") return null;

  return {
    apiClientId: credential.apiClient.id,
    credentialId: credential.id,
    organisationId: credential.apiClient.organisationId,
    scopes: new Set(credential.apiClient.scopes.map(({ scope }) => scope)),
    lastUsedAt: credential.lastUsedAt,
  };
}

export async function touchApiCredential(credentialId: string, previous: Date | null) {
  const staleBefore = new Date(Date.now() - 60 * 60_000);
  if (previous && previous > staleBefore) return;
  await prisma.apiCredential.updateMany({
    where: {
      id: credentialId,
      revokedAt: null,
      OR: [{ lastUsedAt: null }, { lastUsedAt: { lt: staleBefore } }],
    },
    data: { lastUsedAt: new Date() },
  });
}
