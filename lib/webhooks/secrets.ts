import "server-only";

import crypto from "node:crypto";

/** A stored signing secret that the current MFA_ENCRYPTION_KEY cannot decrypt. */
export class WebhookSecretUnreadableError extends Error {
  override name = "WebhookSecretUnreadableError";
  code = "ESECRETUNREADABLE";

  constructor() {
    super("The webhook signing secret cannot be decrypted with this MFA_ENCRYPTION_KEY; rotate the endpoint secret.");
  }
}

function encryptionKey() {
  const raw = process.env.MFA_ENCRYPTION_KEY ?? "";
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32 || key.toString("base64").replace(/=+$/, "") !== raw.replace(/=+$/, "")) {
    throw new Error("MFA_ENCRYPTION_KEY must be valid base64 for a 32-byte key.");
  }
  // Its own HKDF label keeps webhook-secret ciphertext from being
  // interchangeable with MFA seeds or instance settings secrets.
  return Buffer.from(crypto.hkdfSync("sha256", key, Buffer.alloc(0), "yuyu-org-webhook-signing-secret-v1", 32));
}

export function encryptWebhookSecret(value: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}

export function decryptWebhookSecret(value: string) {
  const [version, iv, tag, encrypted] = value.split(".");
  if (version !== "v1" || !iv || !tag || !encrypted) throw new WebhookSecretUnreadableError();
  const key = encryptionKey();
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    throw new WebhookSecretUnreadableError();
  }
}
