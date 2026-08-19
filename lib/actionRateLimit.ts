import "server-only";

import crypto from "crypto";
import { headers } from "next/headers";
import {
  checkRateLimitById,
  getClientIpFromHeaders,
  type Bucket,
} from "@/lib/rateLimit";

function fingerprint(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 32);
}

/**
 * Rate-limit Server Actions as well as Route Handlers. The account subject is
 * hashed before it reaches Redis so operational stores do not contain emails.
 */
export async function isActionRateLimited(bucket: Bucket, subject?: string) {
  const requestHeaders = await headers();
  const ip = getClientIpFromHeaders(requestHeaders);
  const keys = [`ip:${ip}`];
  if (subject?.trim()) keys.push(`subject:${fingerprint(subject.trim().toLowerCase())}`);

  const checks = await Promise.all(keys.map((key) => checkRateLimitById(bucket, key)));
  return checks.some((allowed) => !allowed);
}
