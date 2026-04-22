import type { RsvpStatus } from "@prisma/client";

/**
 * Extract opaque check-in token from pasted text (raw token, URL path, or query).
 */
export function parseCheckInPayload(raw: string): string {
  const t = raw.trim();
  if (!t) return "";

  const tryUrl = (s: string) => {
    try {
      return new URL(s);
    } catch {
      return null;
    }
  };

  const withProto = /^[a-z][a-z0-9+.-]*:/i.test(t) ? t : `https://placeholder.local${t.startsWith("/") ? "" : "/"}${t}`;
  const u = tryUrl(withProto);
  if (u) {
    const parts = u.pathname.split("/").filter(Boolean);
    const last = parts[parts.length - 1];
    if (last && last.length >= 8) {
      const clean = last.split("?")[0];
      if (clean) return clean;
    }
    const qp =
      u.searchParams.get("t") ??
      u.searchParams.get("token") ??
      u.searchParams.get("q");
    if (qp?.trim()) return qp.trim();
  }

  const segments = t.split("/").filter(Boolean);
  const tail = segments[segments.length - 1]?.split("?")[0];
  if (tail && tail.length >= 8) return tail;
  return t.split("?")[0].trim();
}

export type CheckInGate =
  | { ok: true }
  | { ok: false; reason: string; needsForce: boolean; blocked?: boolean };

export function gateCheckInForStatus(
  status: RsvpStatus,
  force: boolean,
): CheckInGate {
  if (status === "CONFIRMED") return { ok: true };
  if (status === "REJECTED") {
    return {
      ok: false,
      reason: "This registration was rejected.",
      needsForce: false,
      blocked: true,
    };
  }
  if (force && (status === "WAITLISTED" || status === "PENDING_APPROVAL")) {
    return { ok: true };
  }
  if (status === "WAITLISTED") {
    return {
      ok: false,
      reason: "Guest is on the waitlist — use “Override” to check in at the door.",
      needsForce: true,
    };
  }
  if (status === "PENDING_APPROVAL") {
    return {
      ok: false,
      reason: "Registration is pending approval — use “Override” to admit.",
      needsForce: true,
    };
  }
  return {
    ok: false,
    reason: "This RSVP cannot be checked in.",
    needsForce: false,
    blocked: true,
  };
}
