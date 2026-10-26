import crypto from "node:crypto";

/**
 * Attendance confirmation links (`/attend/{token}`, docs/FEATURES.md). The raw
 * token is 256 random bits in base64url (43 characters), emailed once to the
 * registration's own address; only its SHA-256 digest is stored in
 * `AttendanceCheck.tokenHash`. A reminder rotates it, which retires the
 * earlier link.
 */
const ATTENDANCE_TOKEN_BYTES = 32;

/** Hex SHA-256 of a raw attendance token, as stored in `AttendanceCheck.tokenHash`. */
export function hashAttendanceToken(rawToken: string): string {
  return crypto.createHash("sha256").update(rawToken, "utf8").digest("hex");
}

/** A fresh link token and the digest to persist. Never store or log `raw`. */
export function generateAttendanceToken(): { raw: string; hash: string } {
  const raw = crypto.randomBytes(ATTENDANCE_TOKEN_BYTES).toString("base64url");
  return { raw, hash: hashAttendanceToken(raw) };
}

/** Shape check before any lookup, so malformed values never reach the database. */
export function isAttendanceTokenShape(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
}

/** Site-relative form link; `answer` preselects Yes or No on the form. */
export function attendancePath(rawToken: string, answer?: "yes" | "no"): string {
  return `/attend/${encodeURIComponent(rawToken)}${answer ? `?answer=${answer}` : ""}`;
}
