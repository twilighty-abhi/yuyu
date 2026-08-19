const required = [
  "DATABASE_URL",
  "AUTH_SECRET",
  "AUTH_URL",
  "NEXT_PUBLIC_BASE_URL",
  "REDIS_URL",
  "CRON_SECRET",
  "HEALTHCHECK_SECRET",
  "EMAIL_FROM",
];

const missing = required.filter((key) => !process.env[key]?.trim());
if (!(process.env.SMTP_SERVICE?.trim() || process.env.SMTP_HOST?.trim())) {
  missing.push("SMTP_SERVICE or SMTP_HOST");
}

if (missing.length > 0) {
  console.error(`Missing required production configuration: ${missing.join(", ")}`);
  process.exit(1);
}

console.log("Production environment preflight passed.");
