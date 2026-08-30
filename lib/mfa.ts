import "server-only";

import crypto from "crypto";
import * as OTPAuth from "otpauth";
import { prisma } from "@/lib/db";

const ISSUER = "Yuyu Events";

function encryptionKey() {
  const raw = process.env.MFA_ENCRYPTION_KEY ?? "";
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32 || key.toString("base64").replace(/=+$/, "") !== raw.replace(/=+$/, "")) {
    throw new Error("MFA_ENCRYPTION_KEY must be valid base64 for a 32-byte key.");
  }
  return key;
}

export function encryptMfaSecret(secret: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}

export function decryptMfaSecret(value: string) {
  const [version, iv, tag, encrypted] = value.split(".");
  if (version !== "v1" || !iv || !tag || !encrypted) throw new Error("Invalid encrypted MFA secret.");
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8");
}

function totp(secret: string, email: string) {
  return new OTPAuth.TOTP({
    issuer: ISSUER,
    label: email,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secret),
  });
}

export function createMfaEnrollment(email: string) {
  const secret = new OTPAuth.Secret({ size: 20 }).base32;
  return { secret, uri: totp(secret, email).toString() };
}

export function verifyMfaCode(secret: string, email: string, input: string) {
  const token = input.replace(/[\s-]/g, "");
  return /^\d{6}$/.test(token) && totp(secret, email).validate({ token, window: 1 }) !== null;
}

export function generateRecoveryCodes() {
  return Array.from({ length: 10 }, () => {
    const value = crypto.randomBytes(6).toString("hex").toUpperCase();
    return `${value.slice(0, 4)}-${value.slice(4, 8)}-${value.slice(8)}`;
  });
}

export function hashRecoveryCode(code: string) {
  const normalized = code.replace(/[\s-]/g, "").toUpperCase();
  return crypto.createHmac("sha256", process.env.AUTH_SECRET ?? "").update(normalized).digest("hex");
}

/**
 * Atomically consume one recovery-code hash. Performing array removal inside
 * PostgreSQL prevents concurrent sign-ins from accepting the same code or
 * reintroducing a code through a stale read/replace update.
 */
export async function consumeRecoveryCode(userId: string, code: string) {
  const recoveryHash = hashRecoveryCode(code);
  const consumed = await prisma.$executeRaw`
    UPDATE "User"
    SET "recoveryCodeHashes" = array_remove("recoveryCodeHashes", ${recoveryHash})
    WHERE "id" = ${userId}
      AND ${recoveryHash} = ANY("recoveryCodeHashes")
  `;
  return consumed === 1;
}
