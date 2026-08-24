const required = [
  "DATABASE_URL",
  "AUTH_SECRET",
  "AUTH_URL",
  "NEXT_PUBLIC_BASE_URL",
  "REDIS_URL",
  "CRON_SECRET",
  "HEALTHCHECK_SECRET",
  "NEXT_SERVER_ACTIONS_ENCRYPTION_KEY",
  "MFA_ENCRYPTION_KEY",
  "EMAIL_FROM",
  "TRUSTED_PROXY_IP_HEADER",
  "S3_BUCKET",
  "S3_REGION",
];

const missing = required.filter((key) => !process.env[key]?.trim());
if (!(process.env.SMTP_SERVICE?.trim() || process.env.SMTP_HOST?.trim())) {
  missing.push("SMTP_SERVICE or SMTP_HOST");
}

if (missing.length > 0) {
  console.error(`Missing required production configuration: ${missing.join(", ")}`);
  process.exit(1);
}

for (const key of ["AUTH_SECRET", "CRON_SECRET", "HEALTHCHECK_SECRET"]) {
  if (process.env[key].trim().length < 32) {
    console.error(`${key} must be at least 32 characters.`);
    process.exit(1);
  }
}

for (const key of ["NEXT_SERVER_ACTIONS_ENCRYPTION_KEY", "MFA_ENCRYPTION_KEY"]) {
  const value = process.env[key];
  const decoded = Buffer.from(value, "base64");
  const normalized = value.replace(/=+$/, "");
  const allowedLengths = key === "MFA_ENCRYPTION_KEY" ? [32] : [16, 24, 32];
  if (!allowedLengths.includes(decoded.length) || decoded.toString("base64").replace(/=+$/, "") !== normalized) {
    console.error(`${key} must be valid base64 with the required AES key length.`);
    process.exit(1);
  }
}

if ((process.env.SMTP_HOST || process.env.SMTP_SERVICE) && process.env.SMTP_ALLOW_UNAUTHENTICATED !== "1" && (!process.env.SMTP_USER?.trim() || !process.env.SMTP_PASSWORD?.trim())) {
  console.error("SMTP requires credentials unless SMTP_ALLOW_UNAUTHENTICATED=1 is explicitly set.");
  process.exit(1);
}

if (Boolean(process.env.S3_ACCESS_KEY_ID) !== Boolean(process.env.S3_SECRET_ACCESS_KEY)) {
  console.error("Configure both S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY, or neither when using an IAM role.");
  process.exit(1);
}

if (!["cf-connecting-ip", "x-forwarded-for", "x-real-ip"].includes(process.env.TRUSTED_PROXY_IP_HEADER)) {
  console.error("TRUSTED_PROXY_IP_HEADER must be cf-connecting-ip, x-forwarded-for, or x-real-ip.");
  process.exit(1);
}

try {
  const authUrl = new URL(process.env.AUTH_URL);
  const baseUrl = new URL(process.env.NEXT_PUBLIC_BASE_URL);
  const databaseUrl = new URL(process.env.DATABASE_URL);
  const redisUrl = new URL(process.env.REDIS_URL);
  const s3Endpoint = process.env.S3_ENDPOINT ? new URL(process.env.S3_ENDPOINT) : null;
  const insecureCiTest = process.env.CI === "true" && process.env.ALLOW_INSECURE_PRODUCTION_TESTS === "1";
  if ((!insecureCiTest && (authUrl.protocol !== "https:" || baseUrl.protocol !== "https:")) || authUrl.origin !== baseUrl.origin) {
    throw new Error("AUTH_URL and NEXT_PUBLIC_BASE_URL must be the same HTTPS origin.");
  }
  if (!insecureCiTest && !["require", "verify-ca", "verify-full"].includes(databaseUrl.searchParams.get("sslmode") ?? "")) {
    throw new Error("DATABASE_URL must require TLS using sslmode=require, verify-ca, or verify-full.");
  }
  if (!insecureCiTest && redisUrl.protocol !== "rediss:") {
    throw new Error("REDIS_URL must use TLS (rediss://) in production.");
  }
  if (!insecureCiTest && s3Endpoint && s3Endpoint.protocol !== "https:") {
    throw new Error("S3_ENDPOINT must use HTTPS in production.");
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "Invalid production URLs.");
  process.exit(1);
}

console.log("Production environment preflight passed.");
