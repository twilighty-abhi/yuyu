import { createBackup, parseOptions } from "./db-backup-lib.mjs";

try {
  const options = parseOptions(process.argv.slice(2));
  const result = await createBackup({ options: { ...options, upload: Boolean(options["s3-bucket"]) } });
  console.log(`Backup created: ${result.archive}`);
  if (result.s3Key) console.log(`Backup uploaded: ${result.s3Key}`);
} catch {
  console.error("Backup failed.");
  process.exitCode = 1;
}
