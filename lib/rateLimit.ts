import type { NextRequest } from "next/server";
import Redis from "ioredis";
import { REDIS_FAIL_FAST_OPTIONS } from "@/lib/redisOptions";

export type Bucket =
  | "global"
  | "action"
  | "create"
  | "auth"
  | "signup"
  | "emailVerification"
  | "passwordReset"
  | "rsvp"
  | "feedback"
  | "upload"
  | "invite"
  | "broadcast"
  | "broadcastTest"
  | "broadcastDraft"
  | "checkin"
  | "checkinStationPin"
  | "search"
  | "apiRead"
  | "apiWrite"
  | "dataExport"
  | "ticketStatus"
  | "ticketEvents"
  | "shortLink"
  | "mobileAuth"
  | "mobileApi"
  | "clientError"
  | "webhookManage"
  | "webhookTest"
  | "attendanceCheckSend"
  | "attendanceCheckSettings"
  | "attendanceCheckReply";

const limits: Record<Bucket, { max: number; windowMs: number }> = {
  global: { max: 300, windowMs: 60_000 },
  action: { max: 180, windowMs: 60_000 },
  create: { max: 20, windowMs: 60 * 60_000 },
  auth: { max: 10, windowMs: 60_000 },
  signup: { max: 5, windowMs: 60 * 60_000 },
  emailVerification: { max: 5, windowMs: 60 * 60_000 },
  passwordReset: { max: 5, windowMs: 60 * 60_000 },
  rsvp: { max: 10, windowMs: 60_000 },
  feedback: { max: 8, windowMs: 60_000 },
  // Shared by every image upload (covers, logos, speaker photos, sponsor logos,
  // media, certificates, crew photos). Building one event page can take dozens.
  upload: { max: 60, windowMs: 60 * 60_000 },
  invite: { max: 30, windowMs: 60 * 60_000 },
  broadcast: { max: 10, windowMs: 60 * 60_000 },
  // Tests only reach the organiser's own inbox; kept apart so testing never blocks the real send.
  broadcastTest: { max: 20, windowMs: 60 * 60_000 },
  // Draft autosave and discard in the Emails tab. Saves fire about 1.5s after
  // typing stops, so a steady writer stays well under this.
  broadcastDraft: { max: 60, windowMs: 60_000 },
  checkin: { max: 180, windowMs: 60_000 },
  checkinStationPin: { max: 5, windowMs: 60_000 },
  search: { max: 60, windowMs: 60_000 },
  apiRead: { max: 600, windowMs: 60_000 },
  apiWrite: { max: 60, windowMs: 60_000 },
  dataExport: { max: 5, windowMs: 60 * 60_000 },
  // Public ticket check-in state. Attendees at one venue often share a NAT
  // address, so these stay generous while still bounding polling/reconnects.
  ticketStatus: { max: 120, windowMs: 60_000 },
  ticketEvents: { max: 60, windowMs: 60_000 },
  // Public short-link lookups. Kept tight so the code space cannot be scanned.
  shortLink: { max: 30, windowMs: 60_000 },
  // Mobile app token refreshes per IP (one per device every ~15 minutes;
  // generous because a venue's organisers often share one NAT address).
  mobileAuth: { max: 30, windowMs: 60_000 },
  // Authenticated mobile API requests per user, on top of the proxy IP limit.
  mobileApi: { max: 300, windowMs: 60_000 },
  // Browser crash reports forwarded to the operator alert webhook.
  clientError: { max: 10, windowMs: 60_000 },
  // Organisation webhook endpoint changes (create, edit, rotate, enable, delete).
  webhookManage: { max: 30, windowMs: 60_000 },
  // Webhook test sends and manual redeliveries each make an outbound request.
  webhookTest: { max: 20, windowMs: 60 * 60_000 },
  // Attendance confirmation (docs/FEATURES.md): organiser sends and reminders
  // queue one email per guest, so they share a tight hourly budget.
  attendanceCheckSend: { max: 10, windowMs: 60 * 60_000 },
  // The release-on-decline switch in the Emails tab.
  attendanceCheckSettings: { max: 30, windowMs: 60_000 },
  // Public replies on /attend/{token}, per link and per client address.
  attendanceCheckReply: { max: 10, windowMs: 60_000 },
};

// Local fallback store
type Entry = { count: number; resetAt: number };
const memoryStore = new Map<string, Entry>();

/** Connection states in which Redis is known to be unavailable right now. */
const UNAVAILABLE_STATES = new Set(["reconnecting", "close", "end"]);

let redisClient: Redis | null = null;
let isRedisDisabled = false;

function allowTestMemoryFallback() {
  return process.env.CI === "true" && process.env.ALLOW_INSECURE_PRODUCTION_TESTS === "1";
}

function getRedisClient(): Redis | null {
  if (isRedisDisabled) return null;
  if (redisClient) return redisClient;

  const redisUrl = process.env.REDIS_URL;
  if (redisUrl === "memory://" && allowTestMemoryFallback()) {
    isRedisDisabled = true;
    return null;
  }
  if (!redisUrl) {
    isRedisDisabled = true;
    return null;
  }

  try {
    redisClient = new Redis(redisUrl, REDIS_FAIL_FAST_OPTIONS);
    
    redisClient.on("error", () => {
      console.warn("[rateLimit] Redis client error");
    });
    
    return redisClient;
  } catch {
    console.error("[rateLimit] Redis client initialization failed");
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
    if (process.env.NODE_ENV === "production" && !allowTestMemoryFallback()) return false;
    return checkRateLimitMemory(bucket, id);
  }

  const k = keyFor(bucket, id);
  const { max, windowMs } = limits[bucket];

  // While ioredis is between reconnect attempts, answer at once instead of
  // queueing behind the backoff (production fails closed, as below).
  if (UNAVAILABLE_STATES.has(redis.status)) {
    if (process.env.NODE_ENV === "production" && !allowTestMemoryFallback()) return false;
    return checkRateLimitMemory(bucket, id);
  }

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
  } catch {
    console.warn("[rateLimit] Redis check failed");
    if (process.env.NODE_ENV === "production" && !allowTestMemoryFallback()) return false;
    return checkRateLimitMemory(bucket, id);
  }
}
