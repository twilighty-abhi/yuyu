import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().url("DATABASE_URL must be a valid database connection URL"),
  AUTH_SECRET: z.string().min(1, "AUTH_SECRET is required"),
  AUTH_URL: z.string().url("AUTH_URL must be a valid URL").optional(),
  EMAIL_FROM: z.string().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.string().optional(),
  SMTP_SECURE: z.string().optional(),
  SMTP_SERVICE: z.string().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  STORAGE_PUBLIC_BASE_URL: z.string().optional(),
  REDIS_URL: z.string().optional(),
  SUPER_ADMIN_EMAIL: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("=========================================");
  console.error("❌ CRITICAL: Invalid environment variables:");
  const formatted = parsed.error.format();
  for (const [key, value] of Object.entries(formatted)) {
    if (key !== "_errors" && value && typeof value === "object" && "_errors" in value) {
      const errors = (value as { _errors?: string[] })._errors || [];
      console.error(`  - ${key}: ${errors.join(", ")}`);
    }
  }
  console.error("=========================================");

  // Throw to fail-fast only at runtime in production (avoiding build-time crashes)
  const isBuildPhase = process.env.NEXT_PHASE === "phase-production-build" || process.argv.some(arg => arg.includes("build"));
  if (process.env.NODE_ENV === "production" && !isBuildPhase) {
    throw new Error("Invalid environment configuration. Check server logs.");
  }
}

export const env = parsed.data;
