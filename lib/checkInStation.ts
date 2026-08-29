import "server-only";

import crypto from "crypto";
import bcrypt from "bcryptjs";

// v2 intentionally avoids browsers retaining the old page-scoped v1 cookie,
// which could not be sent to the station API endpoint.
export const CHECK_IN_STATION_COOKIE = "yuyu.check-in-station.v2";
export const CHECK_IN_STATION_GRACE_MS = 60 * 60 * 1000;

type StationProof = { eventId: string; version: number; expiresAt: number };

function signingKey() {
  const secret = process.env.AUTH_SECRET ?? "";
  if (secret.length < 32) throw new Error("AUTH_SECRET must be configured before verifying check-in station access.");
  return secret;
}

function encryptionKey() {
  const raw = process.env.MFA_ENCRYPTION_KEY ?? "";
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32 || key.toString("base64").replace(/=+$/, "") !== raw.replace(/=+$/, "")) {
    throw new Error("MFA_ENCRYPTION_KEY must be valid base64 for a 32-byte key.");
  }
  return key;
}

function signature(payload: string) {
  return crypto.createHmac("sha256", signingKey()).update(`check-in-station:${payload}`).digest("base64url");
}

export function stationExpiresAt(eventEnd: Date) {
  return new Date(eventEnd.getTime() + CHECK_IN_STATION_GRACE_MS);
}

export function createCheckInStationProof(eventId: string, version: number, eventEnd: Date, now = Date.now()) {
  const expiresAt = stationExpiresAt(eventEnd).getTime();
  if (expiresAt <= now) return null;
  const payload = Buffer.from(JSON.stringify({ eventId, version, expiresAt } satisfies StationProof)).toString("base64url");
  return `${payload}.${signature(payload)}`;
}

export function hasValidCheckInStationProof(value: string | undefined, eventId: string, version: number, eventEnd: Date, now = Date.now()) {
  if (!value) return false;
  const [payload, providedSignature, ...extra] = value.split(".");
  if (!payload || !providedSignature || extra.length > 0) return false;
  const expectedSignature = signature(payload);
  const provided = Buffer.from(providedSignature);
  const expected = Buffer.from(expectedSignature);
  if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) return false;
  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as StationProof;
    return decoded.eventId === eventId
      && decoded.version === version
      && Number.isSafeInteger(decoded.expiresAt)
      && decoded.expiresAt === stationExpiresAt(eventEnd).getTime()
      && decoded.expiresAt > now;
  } catch {
    return false;
  }
}

export function createStationPin() {
  return String(crypto.randomInt(0, 100_000_000)).padStart(8, "0");
}

export async function hashStationPin(pin: string) {
  return bcrypt.hash(pin, 12);
}

export async function verifyStationPin(pin: string, hash: string | null) {
  if (!hash) return false;
  return bcrypt.compare(pin, hash);
}

/** Encrypt separately from MFA values; only organisation admins may decrypt it. */
export function encryptStationPin(pin: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(pin, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}

export function decryptStationPin(value: string) {
  const [version, iv, tag, encrypted] = value.split(".");
  if (version !== "v1" || !iv || !tag || !encrypted) throw new Error("Invalid encrypted check-in station PIN.");
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8");
}
