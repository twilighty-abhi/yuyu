import crypto from "node:crypto";

/**
 * Webhook signing (docs/WEBHOOKS.md#verifying-signatures).
 *
 * `x-yuyu-signature: t=<unix seconds>,v1=<hex HMAC-SHA256>` where the HMAC key
 * is the full endpoint secret (including its `whsec_` prefix, UTF-8) and the
 * signed message is `<t>.<raw request body>`.
 */
export const WEBHOOK_SECRET_PREFIX = "whsec_";
const SECRET_PATTERN = /^whsec_[A-Za-z0-9_-]{43}$/;

export function generateWebhookSecret() {
  return `${WEBHOOK_SECRET_PREFIX}${crypto.randomBytes(32).toString("base64url")}`;
}

export function isWebhookSecretShape(value: string) {
  return SECRET_PATTERN.test(value);
}

export function computeWebhookSignature(secret: string, timestamp: number, body: string) {
  return crypto.createHmac("sha256", secret).update(`${timestamp}.${body}`, "utf8").digest("hex");
}

export function webhookSignatureHeader(secret: string, timestamp: number, body: string) {
  return `t=${timestamp},v1=${computeWebhookSignature(secret, timestamp, body)}`;
}

/**
 * Reference verifier, matching the snippet in docs/WEBHOOKS.md. Rejects
 * signatures older (or further in the future) than `toleranceSeconds`.
 */
export function verifyWebhookSignature(params: {
  secret: string;
  header: string | null | undefined;
  body: string;
  toleranceSeconds?: number;
  now?: number;
}) {
  const parts = Object.fromEntries(
    (params.header ?? "").split(",").map((part) => {
      const index = part.indexOf("=");
      return index > 0 ? [part.slice(0, index).trim(), part.slice(index + 1).trim()] : ["", ""];
    }),
  );
  const timestamp = Number(parts.t);
  const signature = parts.v1;
  if (!Number.isInteger(timestamp) || typeof signature !== "string" || !/^[0-9a-f]{64}$/.test(signature)) return false;
  const now = params.now ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > (params.toleranceSeconds ?? 300)) return false;
  const expected = Buffer.from(computeWebhookSignature(params.secret, timestamp, params.body), "hex");
  return crypto.timingSafeEqual(expected, Buffer.from(signature, "hex"));
}
