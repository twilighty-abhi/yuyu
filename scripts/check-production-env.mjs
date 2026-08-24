const required = [
  "DATABASE_URL",
  "AUTH_SECRET",
  "AUTH_URL",
  "NEXT_PUBLIC_BASE_URL",
  "REDIS_URL",
  "CRON_SECRET",
  "HEALTHCHECK_SECRET",
  "NEXT_SERVER_ACTIONS_ENCRYPTION_KEY",
  "EMAIL_FROM",
  "TRUSTED_PROXY_IP_HEADER",
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

if (process.env.SMTP_HOST && (!process.env.SMTP_USER?.trim() || !process.env.SMTP_PASSWORD?.trim())) {
  console.error("SMTP_HOST requires SMTP_USER and SMTP_PASSWORD in production.");
  process.exit(1);
}

if (!["cf-connecting-ip", "x-forwarded-for", "x-real-ip"].includes(process.env.TRUSTED_PROXY_IP_HEADER)) {
  console.error("TRUSTED_PROXY_IP_HEADER must be cf-connecting-ip, x-forwarded-for, or x-real-ip.");
  process.exit(1);
}

try {
  const authUrl = new URL(process.env.AUTH_URL);
  const baseUrl = new URL(process.env.NEXT_PUBLIC_BASE_URL);
  if (authUrl.protocol !== "https:" || baseUrl.protocol !== "https:" || authUrl.origin !== baseUrl.origin) {
    throw new Error("AUTH_URL and NEXT_PUBLIC_BASE_URL must be the same HTTPS origin.");
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "Invalid production URLs.");
  process.exit(1);
}

console.log("Production environment preflight passed.");
