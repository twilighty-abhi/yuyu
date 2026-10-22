import "server-only";

import { z } from "zod";

const secret = z.string().min(32, "must be at least 32 characters");

function isValidServerActionsKey(value: string) {
  try {
    const normalized = value.replace(/=+$/, "");
    const decoded = Buffer.from(value, "base64");
    return (
      [16, 24, 32].includes(decoded.length) &&
      decoded.toString("base64").replace(/=+$/, "") === normalized
    );
  } catch {
    return false;
  }
}

const serverActionsKey = z.string().refine(isValidServerActionsKey, {
  message: "must be valid base64 that decodes to a 16, 24, or 32 byte AES key",
});

const mfaEncryptionKey = z.string().refine((value) => {
  try {
    const normalized = value.replace(/=+$/, "");
    const decoded = Buffer.from(value, "base64");
    return decoded.length === 32 && decoded.toString("base64").replace(/=+$/, "") === normalized;
  } catch {
    return false;
  }
}, {
  message: "must be valid base64 that decodes to a 32 byte AES key",
});

export const envSchema = z.object({
  DATABASE_URL: z.string().url("must be a valid database connection URL"),
  AUTH_SECRET: secret,
  AUTH_URL: z.string().url("must be a valid URL").optional(),
  EMAIL_FROM: z.string().min(3).optional(),
  SMTP_HOST: z.string().min(1).optional(),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).optional(),
  SMTP_SECURE: z.enum(["true", "false"]).optional(),
  SMTP_SERVICE: z.string().min(1).optional(),
  SMTP_USER: z.string().min(1).optional(),
  SMTP_PASSWORD: z.string().min(1).optional(),
  SMTP_ALLOW_UNAUTHENTICATED: z.enum(["0", "1"]).optional(),
  NEXT_PUBLIC_BASE_URL: z.string().url().optional(),
  REDIS_URL: z.string().url().optional(),
  CRON_SECRET: secret.optional(),
  HEALTHCHECK_SECRET: secret.optional(),
  NEXT_SERVER_ACTIONS_ENCRYPTION_KEY: serverActionsKey.optional(),
  MFA_ENCRYPTION_KEY: mfaEncryptionKey.optional(),
  S3_BUCKET: z.string().min(1).optional(),
  S3_REGION: z.string().min(1).optional(),
  S3_ENDPOINT: z.string().url().optional(),
  S3_ACCESS_KEY_ID: z.string().min(1).optional(),
  S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  S3_FORCE_PATH_STYLE: z.enum(["0", "1"]).optional(),
  ALLOW_INSECURE_PRODUCTION_TESTS: z.enum(["0", "1"]).optional(),
  // Development/test only; ignored by a production server outside CI test mode (lib/webhooks/urlSafety.ts).
  WEBHOOKS_ALLOW_PRIVATE_TARGETS: z.enum(["0", "1"]).optional(),
  ALLOWED_ACTION_ORIGINS: z.string().optional(),
  ALLOWED_EMBED_ORIGINS: z.string().optional(),
  TRUSTED_PROXY_IP_HEADER: z.enum(["cf-connecting-ip", "x-forwarded-for", "x-real-ip"]).optional(),
  SUPER_ADMIN_EMAIL: z.string().email().optional(),
  BACKUP_PROVIDER: z.string().max(80).optional(),
  BACKUP_LAST_SUCCESS_AT: z.preprocess((value) => value === "" ? undefined : value, z.string().datetime().optional()),
  BACKUP_RETENTION_DAYS: z.coerce.number().int().positive().max(3650).optional(),
  OUTBOX_RETENTION_DAYS: z.coerce.number().int().positive().max(365).optional(),
});

/**
 * Treat blank values as unset. Environment files copied from `.env.example`
 * commonly keep panel-managed fallbacks such as `SMTP_HOST=""` or
 * `S3_ENDPOINT=""`; those must not fail optional `min(1)`/URL rules and stop a
 * production server from starting.
 */
function environmentValues(source: NodeJS.ProcessEnv = process.env) {
  return Object.fromEntries(
    Object.entries(source).filter(([, value]) => typeof value === "string" && value.trim() !== ""),
  );
}

// Optional display-only configuration for server-rendered operations pages.
// Runtime startup validation is handled explicitly by validateRuntimeEnvironment.
export const env = envSchema.safeParse(environmentValues()).data;

function issueMessages(error: z.ZodError) {
  return error.issues.map((issue) => `${issue.path.join(".") || "environment"}: ${issue.message}`);
}

/**
 * Validate only when a production server starts, never as an import side effect.
 *
 * SMTP (`EMAIL_FROM`, `SMTP_*`) and Google SSO (`AUTH_GOOGLE_*`) are deliberately
 * not required: they can be configured in Super admin → Settings, which is read
 * from the database at send/sign-in time and needs no restart. Their values are
 * still format-checked when present. `MFA_ENCRYPTION_KEY` is required because it
 * decrypts both MFA seeds and the panel's stored SMTP/Google/alert-webhook
 * secrets; its rule matches lib/instanceConfigSecrets.ts (canonical base64, 32
 * bytes). Whether the key can decrypt the stored values is checked separately by
 * `scripts/check-instance-secrets.mjs`, because a mismatch must not crash-loop
 * the server.
 */
export function validateRuntimeEnvironment() {
  if (process.env.NODE_ENV !== "production") return;
  const parsed = envSchema.safeParse(environmentValues());
  const missing = ["AUTH_URL", "NEXT_PUBLIC_BASE_URL", "REDIS_URL", "CRON_SECRET", "HEALTHCHECK_SECRET", "NEXT_SERVER_ACTIONS_ENCRYPTION_KEY", "MFA_ENCRYPTION_KEY", "TRUSTED_PROXY_IP_HEADER", "S3_BUCKET", "S3_REGION"]
    .filter((key) => !process.env[key]?.trim());
  if (Boolean(process.env.S3_ACCESS_KEY_ID) !== Boolean(process.env.S3_SECRET_ACCESS_KEY)) {
    missing.push("both S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY, or neither when using an IAM role");
  }
  if (!parsed.success || missing.length > 0) {
    const details = [...(parsed.success ? [] : issueMessages(parsed.error)), ...missing.map((key) => `${key}: required in production`)];
    throw new Error(`Invalid production environment configuration: ${details.join("; ")}`);
  }
  const baseUrl = new URL(process.env.NEXT_PUBLIC_BASE_URL!);
  const authUrl = new URL(process.env.AUTH_URL!);
  const insecureCiTest = process.env.CI === "true" && process.env.ALLOW_INSECURE_PRODUCTION_TESTS === "1";
  if ((!insecureCiTest && (baseUrl.protocol !== "https:" || authUrl.protocol !== "https:")) || baseUrl.origin !== authUrl.origin) {
    throw new Error("AUTH_URL and NEXT_PUBLIC_BASE_URL must be the same HTTPS origin in production.");
  }
  const databaseUrl = new URL(process.env.DATABASE_URL!);
  if (!insecureCiTest && !["require", "verify-ca", "verify-full"].includes(databaseUrl.searchParams.get("sslmode") ?? "")) {
    throw new Error("DATABASE_URL must require TLS using sslmode=require, verify-ca, or verify-full.");
  }
  const redisUrl = new URL(process.env.REDIS_URL!);
  if (!insecureCiTest && redisUrl.protocol !== "rediss:") {
    throw new Error("REDIS_URL must use TLS (rediss://) in production.");
  }
  if (!insecureCiTest && process.env.S3_ENDPOINT && new URL(process.env.S3_ENDPOINT).protocol !== "https:") {
    throw new Error("S3_ENDPOINT must use HTTPS in production.");
  }
  for (const value of (process.env.ALLOWED_EMBED_ORIGINS ?? "").split(",").map((origin) => origin.trim()).filter(Boolean)) {
    let origin: URL;
    try {
      origin = new URL(value);
    } catch {
      throw new Error("ALLOWED_EMBED_ORIGINS must contain valid origins only.");
    }
    if (origin.origin !== value || (!insecureCiTest && origin.protocol !== "https:")) {
      throw new Error("ALLOWED_EMBED_ORIGINS must contain exact HTTPS origins without paths.");
    }
  }
}
