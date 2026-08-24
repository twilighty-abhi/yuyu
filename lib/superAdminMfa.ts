import "server-only";

import crypto from "crypto";

export const SUPER_ADMIN_MFA_COOKIE = "yuyu.super-admin-mfa.v1";
export const SUPER_ADMIN_MFA_MAX_AGE_SECONDS = 10 * 60;

type SuperAdminMfaPayload = {
  userId: string;
  sessionVersion: number;
  expiresAt: number;
};

function signingKey() {
  const secret = process.env.AUTH_SECRET ?? "";
  if (secret.length < 32) throw new Error("AUTH_SECRET must be configured before verifying super-admin MFA.");
  return secret;
}

function signature(payload: string) {
  return crypto.createHmac("sha256", signingKey()).update(`super-admin-mfa:${payload}`).digest("base64url");
}

export function createSuperAdminMfaProof(userId: string, sessionVersion: number, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({
    userId,
    sessionVersion,
    expiresAt: now + SUPER_ADMIN_MFA_MAX_AGE_SECONDS * 1000,
  } satisfies SuperAdminMfaPayload)).toString("base64url");
  return `${payload}.${signature(payload)}`;
}

export function hasValidSuperAdminMfaProof(
  value: string | undefined,
  userId: string,
  sessionVersion: number,
  now = Date.now(),
) {
  if (!value) return false;
  const [payload, providedSignature, ...extra] = value.split(".");
  if (!payload || !providedSignature || extra.length > 0) return false;
  const expectedSignature = signature(payload);
  const provided = Buffer.from(providedSignature);
  const expected = Buffer.from(expectedSignature);
  if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) return false;

  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as SuperAdminMfaPayload;
    return decoded.userId === userId && decoded.sessionVersion === sessionVersion && Number.isSafeInteger(decoded.expiresAt) && decoded.expiresAt > now;
  } catch {
    return false;
  }
}
