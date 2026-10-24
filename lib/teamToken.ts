import crypto from "node:crypto";

/**
 * Team capabilities (docs/TEAMS.md). Both are 256-bit random base64url
 * strings (43 characters), well above the 128-bit minimum.
 *
 * - The join token is stored as-is: the leader can always see and share the
 *   join link, and it reveals only the team name and size.
 * - The management token is shown once (in the team-created email) and only
 *   its SHA-256 digest is stored, like mobile session tokens.
 */
const TEAM_TOKEN_BYTES = 32;

export function generateTeamToken(): string {
  return crypto.randomBytes(TEAM_TOKEN_BYTES).toString("base64url");
}

/** Hex SHA-256 of a raw management token, as stored in `Team.manageTokenHash`. */
export function hashTeamManageToken(rawToken: string): string {
  return crypto.createHash("sha256").update(rawToken, "utf8").digest("hex");
}

/** A fresh management token and the digest to persist. Never store `raw`. */
export function generateTeamManageToken(): { raw: string; hash: string } {
  const raw = generateTeamToken();
  return { raw, hash: hashTeamManageToken(raw) };
}

/** Shape check before any lookup, so malformed values never reach the database. */
export function isTeamTokenShape(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{32,128}$/.test(value);
}

export function teamJoinPath(orgSlug: string, eventSlug: string, joinToken: string): string {
  return `/${encodeURIComponent(orgSlug)}/${encodeURIComponent(eventSlug)}/team/${encodeURIComponent(joinToken)}`;
}

export function teamManagePath(rawManageToken: string): string {
  return `/team/${encodeURIComponent(rawManageToken)}`;
}
