import "server-only";

import crypto from "node:crypto";
import { prisma } from "@/lib/db";

const TOKEN_PREFIX = "yuyu_v1_";
const TOKEN_PATTERN = /^yuyu_v1_([a-z0-9]+)\.([A-Za-z0-9_-]{43})$/;

export function hashApiSecret(secret: string) {
  return crypto.createHash("sha256").update(secret, "utf8").digest();
}

export function generateApiCredential(credentialId: string) {
  const secret = crypto.randomBytes(32).toString("base64url");
  return {
    token: `${TOKEN_PREFIX}${credentialId}.${secret}`,
    secretHash: hashApiSecret(secret),
  };
}

export function parseApiCredential(value: string | null) {
  const authorization = value?.trim().match(/^Bearer[ \t]+([^ \t]+)$/i);
  if (!authorization) return null;
  const match = TOKEN_PATTERN.exec(authorization[1]!);
  if (!match) return null;
  return { credentialId: match[1]!, secret: match[2]! };
}

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
