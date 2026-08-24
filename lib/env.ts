import "server-only";

import { z } from "zod";

const secret = z.string().min(32, "must be at least 32 characters");

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
  NEXT_PUBLIC_BASE_URL: z.string().url().optional(),
  REDIS_URL: z.string().url().optional(),
  CRON_SECRET: secret.optional(),
  HEALTHCHECK_SECRET: secret.optional(),
  NEXT_SERVER_ACTIONS_ENCRYPTION_KEY: z.string().min(22).optional(),
  ALLOWED_ACTION_ORIGINS: z.string().optional(),
  TRUSTED_PROXY_IP_HEADER: z.enum(["cf-connecting-ip", "x-forwarded-for", "x-real-ip"]).optional(),
  SUPER_ADMIN_EMAIL: z.string().email().optional(),
  BACKUP_PROVIDER: z.string().max(80).optional(),
  BACKUP_LAST_SUCCESS_AT: z.preprocess((value) => value === "" ? undefined : value, z.string().datetime().optional()),
  BACKUP_RETENTION_DAYS: z.coerce.number().int().positive().max(3650).optional(),
});

// Optional display-only configuration for server-rendered operations pages.
// Runtime startup validation is handled explicitly by validateRuntimeEnvironment.
export const env = envSchema.safeParse(process.env).data;

function issueMessages(error: z.ZodError) {
  return error.issues.map((issue) => `${issue.path.join(".") || "environment"}: ${issue.message}`);
}

/** Validate only when a production server starts, never as an import side effect. */
export function validateRuntimeEnvironment() {
  if (process.env.NODE_ENV !== "production") return;
  const parsed = envSchema.safeParse(process.env);
  const missing = ["AUTH_URL", "NEXT_PUBLIC_BASE_URL", "REDIS_URL", "CRON_SECRET", "HEALTHCHECK_SECRET", "EMAIL_FROM", "TRUSTED_PROXY_IP_HEADER"]
    .filter((key) => !process.env[key]?.trim());
  if (!(process.env.SMTP_SERVICE?.trim() || process.env.SMTP_HOST?.trim())) missing.push("SMTP_SERVICE or SMTP_HOST");
  if (process.env.SMTP_HOST && (!process.env.SMTP_USER || !process.env.SMTP_PASSWORD)) {
    missing.push("SMTP_USER and SMTP_PASSWORD for SMTP_HOST");
  }
  if (!parsed.success || missing.length > 0) {
    const details = [...(parsed.success ? [] : issueMessages(parsed.error)), ...missing.map((key) => `${key}: required in production`)];
    throw new Error(`Invalid production environment configuration: ${details.join("; ")}`);
  }
  const baseUrl = new URL(process.env.NEXT_PUBLIC_BASE_URL!);
  const authUrl = new URL(process.env.AUTH_URL!);
  if (baseUrl.protocol !== "https:" || authUrl.protocol !== "https:" || baseUrl.origin !== authUrl.origin) {
    throw new Error("AUTH_URL and NEXT_PUBLIC_BASE_URL must be the same HTTPS origin in production.");
  }
}
