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

/**
 * The join token in something a person pasted: a bare token, or a join link
 * (absolute or relative) of the form `/{orgSlug}/{eventSlug}/team/{token}`.
 * A management link (`/team/{token}`) is not a join link and is refused, so
 * it is never looked up as one. Null when nothing usable was pasted.
 */
export function joinTokenFromInput(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw || raw.length > 2048) return null;
  if (isTeamTokenShape(raw)) return raw;
  let path: string;
  try {
    path = new URL(raw, "https://join.invalid").pathname;
  } catch {
    return null;
  }
  // A link pasted without its scheme ("yuyu.example/org/event/team/…") keeps
  // the host as a leading segment, so only the last four segments count.
  const segments = path.split("/").filter(Boolean);
  if (segments.length < 4 || segments[segments.length - 2] !== "team") return null;
  let token: string;
  try {
    token = decodeURIComponent(segments[segments.length - 1]!);
  } catch {
    return null;
  }
  return isTeamTokenShape(token) ? token : null;
}
