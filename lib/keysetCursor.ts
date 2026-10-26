/*
 * Opaque keyset cursors for bounded, server-side lists (Guests, check-in
 * desk, check-in lists, team move targets). Pure helpers: no I/O, safe in
 * client components and unit tests. A cursor names the last row the browser
 * has seen; the server re-applies its own scoping and filters on every page,
 * so a cursor can only move within a list the caller may already read.
 */

/** Ids as Prisma generates them (cuid) plus test-friendly ids. */
const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

/** `<epoch ms>.<id>`, the same shape as the Teams view cursor. */
export function encodeTimeCursor(row: { at: Date; id: string }): string {
  return `${row.at.getTime()}.${row.id}`;
}

export function decodeTimeCursor(cursor: string | null | undefined): { at: Date; id: string } | null {
  if (!cursor) return null;
  const match = /^(\d{1,15})\.([A-Za-z0-9_-]{1,128})$/.exec(cursor);
  if (!match) return null;
  const at = new Date(Number(match[1]));
  return Number.isNaN(at.getTime()) ? null : { at, id: match[2]! };
}

function toBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): string | null {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) return null;
  try {
    const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/** A text sort key (such as a team's `nameKey`) and the row id, base64url-encoded. */
export function encodeKeyCursor(row: { key: string; id: string }): string {
  return toBase64Url(JSON.stringify([row.key, row.id]));
}

export function decodeKeyCursor(cursor: string | null | undefined, maxKeyLength = 200): { key: string; id: string } | null {
  if (!cursor || cursor.length > 600) return null;
  const json = fromBase64Url(cursor);
  if (json == null) return null;
  try {
    const value: unknown = JSON.parse(json);
    if (!Array.isArray(value) || value.length !== 2) return null;
    const [key, id] = value;
    if (typeof key !== "string" || typeof id !== "string") return null;
    if (key.length > maxKeyLength || !ID_PATTERN.test(id)) return null;
    return { key, id };
  } catch {
    return null;
  }
}

/** "Showing 50 of 909" style wording for a loaded slice of a counted list. */
export function showingLabel(shown: number, total: number, noun: string): string {
  return `Showing ${Math.min(shown, total)} of ${total} ${noun}`;
}
