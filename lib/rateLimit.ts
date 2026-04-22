import type { NextRequest } from "next/server";

export type Bucket = "global" | "auth" | "rsvp" | "search";

const limits: Record<Bucket, { max: number; windowMs: number }> = {
  global: { max: 300, windowMs: 60_000 },
  auth: { max: 40, windowMs: 60_000 },
  rsvp: { max: 30, windowMs: 60_000 },
  search: { max: 60, windowMs: 60_000 },
};

type Entry = { count: number; resetAt: number };

const store = new Map<string, Entry>();

function keyFor(bucket: Bucket, id: string) {
  return `${bucket}:${id}`;
}

export function getClientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = request.headers.get("x-real-ip");
  if (real) return real.trim();
  return "unknown";
}

/** Returns true if the request is allowed; false if rate limited. */
export function checkRateLimit(
  request: NextRequest,
  bucket: Bucket,
): boolean {
  const id = getClientIp(request);
  const k = keyFor(bucket, id);
  const { max, windowMs } = limits[bucket];
  const now = Date.now();
  let entry = store.get(k);
  if (!entry || now >= entry.resetAt) {
    entry = { count: 0, resetAt: now + windowMs };
    store.set(k, entry);
  }
  entry.count += 1;
  return entry.count <= max;
}
