import crypto from "node:crypto";

/**
 * Solo submission links (`/submit/{token}`, docs/HACKATHON.md). The raw token
 * is 256 random bits in base64url (43 characters), emailed once to the RSVP's
 * own address; only its SHA-256 digest is stored in `SubmissionLink.tokenHash`.
 * Regenerating replaces the digest, which retires the old link.
 */
const SUBMISSION_TOKEN_BYTES = 32;

/** Hex SHA-256 of a raw submission token, as stored in `SubmissionLink.tokenHash`. */
export function hashSubmissionLinkToken(rawToken: string): string {
  return crypto.createHash("sha256").update(rawToken, "utf8").digest("hex");
}

/** A fresh link token and the digest to persist. Never store or log `raw`. */
export function generateSubmissionLinkToken(): { raw: string; hash: string } {
  const raw = crypto.randomBytes(SUBMISSION_TOKEN_BYTES).toString("base64url");
  return { raw, hash: hashSubmissionLinkToken(raw) };
}

/** Shape check before any lookup, so malformed values never reach the database. */
export function isSubmissionTokenShape(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{32,128}$/.test(value);
}

export function submissionLinkPath(rawToken: string): string {
  return `/submit/${encodeURIComponent(rawToken)}`;
}

export function projectGalleryPath(orgSlug: string, eventSlug: string): string {
  return `/${encodeURIComponent(orgSlug)}/${encodeURIComponent(eventSlug)}/projects`;
}

export function resultsPath(orgSlug: string, eventSlug: string): string {
  return `/${encodeURIComponent(orgSlug)}/${encodeURIComponent(eventSlug)}/results`;
}
