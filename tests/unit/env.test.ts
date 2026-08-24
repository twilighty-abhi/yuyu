import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { validateRuntimeEnvironment } from "@/lib/env";

const original = { ...process.env };
const key = Buffer.alloc(32, 3).toString("base64");

beforeEach(() => {
  Object.assign(process.env, {
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://user:pass@db.example.test/yuyu?sslmode=require",
    AUTH_SECRET: "a".repeat(32), AUTH_URL: "https://events.example.test", NEXT_PUBLIC_BASE_URL: "https://events.example.test",
    REDIS_URL: "rediss://redis.example.test", CRON_SECRET: "c".repeat(32), HEALTHCHECK_SECRET: "h".repeat(32),
    NEXT_SERVER_ACTIONS_ENCRYPTION_KEY: key, MFA_ENCRYPTION_KEY: key, EMAIL_FROM: "Yuyu <noreply@example.test>",
    SMTP_SERVICE: "test", SMTP_ALLOW_UNAUTHENTICATED: "1", TRUSTED_PROXY_IP_HEADER: "x-forwarded-for",
    S3_BUCKET: "private-assets", S3_REGION: "us-east-1",
  });
  delete process.env.CI;
  delete process.env.ALLOW_INSECURE_PRODUCTION_TESTS;
});

afterEach(() => {
  for (const name of Object.keys(process.env)) if (!(name in original)) delete process.env[name];
  Object.assign(process.env, original);
});

describe("production environment validation", () => {
  it("accepts a complete TLS-protected configuration", () => expect(validateRuntimeEnvironment).not.toThrow());
  it("rejects plaintext database and public origins", () => {
    process.env.DATABASE_URL = "postgresql://user:pass@db.example.test/yuyu?sslmode=disable";
    expect(validateRuntimeEnvironment).toThrow(/DATABASE_URL must require TLS/);
    process.env.DATABASE_URL = "postgresql://user:pass@db.example.test/yuyu?sslmode=require";
    process.env.AUTH_URL = "http://events.example.test";
    process.env.NEXT_PUBLIC_BASE_URL = "http://events.example.test";
    expect(validateRuntimeEnvironment).toThrow(/same HTTPS origin/);
  });
  it("rejects missing secrets and half-configured object credentials", () => {
    delete process.env.CRON_SECRET;
    expect(validateRuntimeEnvironment).toThrow(/CRON_SECRET/);
    process.env.CRON_SECRET = "c".repeat(32);
    process.env.S3_ACCESS_KEY_ID = "access";
    expect(validateRuntimeEnvironment).toThrow(/S3_SECRET_ACCESS_KEY/);
  });
});
