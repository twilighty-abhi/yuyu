import type { NextRequest } from "next/server";
import Redis from "ioredis";

export type Bucket = "global" | "auth" | "rsvp" | "search";

const limits: Record<Bucket, { max: number; windowMs: number }> = {
  global: { max: 300, windowMs: 60_000 },
  auth: { max: 40, windowMs: 60_000 },
  rsvp: { max: 30, windowMs: 60_000 },
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
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = request.headers.get("x-real-ip");
  if (real) return real.trim();
  return "unknown";
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
  const id = getClientIp(request);
  const redis = getRedisClient();
  
  if (!redis) {
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
    console.warn("[rateLimit] Redis check failed, falling back to in-memory check:", e);
    return checkRateLimitMemory(bucket, id);
  }
}

