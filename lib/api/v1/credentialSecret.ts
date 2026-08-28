import crypto from "node:crypto";

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
