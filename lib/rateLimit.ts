import type { NextRequest } from "next/server";
import Redis from "ioredis";

export type Bucket =
  | "global"
  | "auth"
  | "signup"
  | "passwordReset"
  | "rsvp"
  | "upload"
  | "invite"
  | "checkin"
  | "search";

const limits: Record<Bucket, { max: number; windowMs: number }> = {
  global: { max: 300, windowMs: 60_000 },
  auth: { max: 10, windowMs: 60_000 },
  signup: { max: 5, windowMs: 60 * 60_000 },
  passwordReset: { max: 5, windowMs: 60 * 60_000 },
  rsvp: { max: 10, windowMs: 60_000 },
  upload: { max: 12, windowMs: 60 * 60_000 },
  invite: { max: 30, windowMs: 60 * 60_000 },
  checkin: { max: 180, windowMs: 60_000 },
  search: { max: 60, windowMs: 60_000 },
};

// Local fallback store
type Entry = { count: number; resetAt: number };
const memoryStore = new Map<string, Entry>();

let redisClient: Redis | null = null;
let isRedisDisabled = false;

function getRedisClient(): Redis | null {
  if (isRedisDisabled) return null;
  if (redisClient) return redisClient;

  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    isRedisDisabled = true;
    return null;
  }

  try {
    redisClient = new Redis(redisUrl, {
      maxRetriesPerRequest: 1,
      connectTimeout: 1000,
      lazyConnect: true,
    });
    
    redisClient.on("error", (err) => {
      console.warn("[rateLimit] Redis error, falling back to in-memory store:", err.message);
    });
    
    return redisClient;
  } catch (e) {
    console.error("[rateLimit] Failed to initialize Redis client:", e);
    isRedisDisabled = true;
    return null;
  }
}

function keyFor(bucket: Bucket, id: string) {
  return `ratelimit:${bucket}:${id}`;
}

export function getClientIp(request: NextRequest): string {
  const configuredHeader = process.env.TRUSTED_PROXY_IP_HEADER;
  const cloudflare = request.headers.get("cf-connecting-ip");
  if ((configuredHeader === "cf-connecting-ip" || !configuredHeader) && cloudflare) {
    return cloudflare.trim();
  }
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = request.headers.get("x-real-ip");
  if (real) return real.trim();
  return "unknown";
}

export function getClientIpFromHeaders(headers: Headers): string {
  const configuredHeader = process.env.TRUSTED_PROXY_IP_HEADER;
  const cloudflare = headers.get("cf-connecting-ip");
  if ((configuredHeader === "cf-connecting-ip" || !configuredHeader) && cloudflare) {
    return cloudflare.trim();
  }
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() || "unknown";
  return headers.get("x-real-ip")?.trim() || "unknown";
}

function checkRateLimitMemory(bucket: Bucket, id: string): boolean {
  const k = keyFor(bucket, id);
  const { max, windowMs } = limits[bucket];
  const now = Date.now();
  let entry = memoryStore.get(k);
  if (!entry || now >= entry.resetAt) {
    entry = { count: 0, resetAt: now + windowMs };
    memoryStore.set(k, entry);
  }
  entry.count += 1;
  return entry.count <= max;
}

/** Returns true if the request is allowed; false if rate limited. */
export async function checkRateLimit(
  request: NextRequest,
  bucket: Bucket,
): Promise<boolean> {
  return checkRateLimitById(bucket, getClientIp(request));
}

/** Check a bucket using a privacy-safe, caller-provided subject key. */
export async function checkRateLimitById(bucket: Bucket, id: string): Promise<boolean> {
  const redis = getRedisClient();
  
  if (!redis) {
    if (process.env.NODE_ENV === "production") return false;
    return checkRateLimitMemory(bucket, id);
  }

  const k = keyFor(bucket, id);
  const { max, windowMs } = limits[bucket];

  try {
    const pipeline = redis.pipeline();
    pipeline.incr(k);
    pipeline.ttl(k);
    const results = await pipeline.exec();
    
    if (!results) {
      throw new Error("Pipeline returned no results");
    }

    const [incrErr, count] = results[0];
    const [ttlErr, ttl] = results[1];

    if (incrErr) throw incrErr;
    if (ttlErr) throw ttlErr;

    const countNum = count as number;
    const ttlNum = ttl as number;

    if (ttlNum < 0) {
      await redis.pexpire(k, windowMs);
    }

    return countNum <= max;
  } catch (e) {
    console.warn("[rateLimit] Redis check failed:", e);
    if (process.env.NODE_ENV === "production") return false;
    return checkRateLimitMemory(bucket, id);
  }
}
