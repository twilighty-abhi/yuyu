import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

const script = path.join(process.cwd(), "scripts/check-production-env.mjs");
const key = Buffer.alloc(32, 7).toString("base64");

const base = {
  PATH: process.env.PATH ?? "",
  DATABASE_URL: "postgresql://user:pass@db.example.test/yuyu?sslmode=require",
  AUTH_SECRET: "a".repeat(32),
  AUTH_URL: "https://events.example.test",
  NEXT_PUBLIC_BASE_URL: "https://events.example.test",
  REDIS_URL: "rediss://redis.example.test",
  CRON_SECRET: "c".repeat(32),
  HEALTHCHECK_SECRET: "h".repeat(32),
  NEXT_SERVER_ACTIONS_ENCRYPTION_KEY: key,
  MFA_ENCRYPTION_KEY: key,
  TRUSTED_PROXY_IP_HEADER: "x-forwarded-for",
  S3_BUCKET: "private-assets",
  S3_REGION: "us-east-1",
};

function run(env: Record<string, string>) {
  return spawnSync(process.execPath, [script], { env: { NODE_ENV: "production", ...env }, encoding: "utf8" });
}

describe("npm run production:check", () => {
  it("passes without SMTP or Google environment values, noting that the panel must supply SMTP", () => {
    const result = run(base);
    expect(result.status).toBe(0);
    expect(result.stderr).toMatch(/Super admin -> Settings/);
    expect(result.stdout).toMatch(/preflight passed/);
  });

  it("accepts blank SMTP placeholders as no fallback", () => {
    const result = run({ ...base, EMAIL_FROM: "", SMTP_HOST: "", SMTP_SERVICE: "", SMTP_USER: "", SMTP_PASSWORD: "" });
    expect(result.status).toBe(0);
  });

  it("still requires credentials for an environment SMTP fallback", () => {
    const result = run({ ...base, SMTP_HOST: "smtp.example.test" });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/SMTP requires credentials/);
  });

  it("requires MFA_ENCRYPTION_KEY as base64 for a 32-byte key", () => {
    expect(run({ ...base, MFA_ENCRYPTION_KEY: "" }).stderr).toMatch(/MFA_ENCRYPTION_KEY/);
    const short = run({ ...base, MFA_ENCRYPTION_KEY: Buffer.alloc(16, 1).toString("base64") });
    expect(short.status).toBe(1);
    expect(short.stderr).toMatch(/MFA_ENCRYPTION_KEY/);
  });

  it("refuses the development-only webhook private-target flag outside CI test mode", () => {
    const refused = run({ ...base, WEBHOOKS_ALLOW_PRIVATE_TARGETS: "1" });
    expect(refused.status).toBe(1);
    expect(refused.stderr).toMatch(/WEBHOOKS_ALLOW_PRIVATE_TARGETS/);
    expect(run({ ...base, WEBHOOKS_ALLOW_PRIVATE_TARGETS: "" }).status).toBe(0);
    expect(run({ ...base, WEBHOOKS_ALLOW_PRIVATE_TARGETS: "1", CI: "true", ALLOW_INSECURE_PRODUCTION_TESTS: "1" }).status).toBe(0);
  });
});
