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
  if (isTrustedProxyHeader(configuredHeader)) return readConfiguredIp(request.headers, configuredHeader);
  return "unknown";
}

export function getClientIpFromHeaders(headers: Headers): string {
  const configuredHeader = process.env.TRUSTED_PROXY_IP_HEADER;
  return isTrustedProxyHeader(configuredHeader) ? readConfiguredIp(headers, configuredHeader) : "unknown";
}

function isTrustedProxyHeader(value: string | undefined): value is "cf-connecting-ip" | "x-forwarded-for" | "x-real-ip" {
  return value === "cf-connecting-ip" || value === "x-forwarded-for" || value === "x-real-ip";
}

function readConfiguredIp(headers: Headers, header: "cf-connecting-ip" | "x-forwarded-for" | "x-real-ip") {
  const value = headers.get(header)?.trim();
  if (!value) return "unknown";
  return header === "x-forwarded-for" ? value.split(",")[0]?.trim() || "unknown" : value;
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
    // Increment and expiry must be one Redis operation. A pipeline can leave
    // an unexpiring key behind if the process dies between INCR and PEXPIRE.
    const count = await redis.eval(
      "local c = redis.call('INCR', KEYS[1]); if c == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]); end; return c",
      1,
      k,
      String(windowMs),
    );
    return Number(count) <= max;
  } catch (e) {
    console.warn("[rateLimit] Redis check failed:", e);
    if (process.env.NODE_ENV === "production") return false;
    return checkRateLimitMemory(bucket, id);
  }
}
