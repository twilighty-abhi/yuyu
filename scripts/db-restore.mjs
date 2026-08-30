import { createBackup, databaseDetails, downloadBackup, isUnsafeRestoreDatabase, parseOptions, readVerifiedBackup, restoreArchive, runNpmScript } from "./db-backup-lib.mjs";
import { rm } from "node:fs/promises";

let temporaryArchive;
try {
  const options = parseOptions(process.argv.slice(2));
  const database = databaseDetails();
  const hasFile = typeof options.file === "string";
  const hasS3 = typeof options["s3-key"] === "string";
  if (hasFile === hasS3) throw new Error("Choose exactly one restore source.");
  if (options.production !== true || options["confirm-database"] !== database.databaseName || isUnsafeRestoreDatabase(database.url)) throw new Error("Restore confirmation was refused.");
  const source = hasFile ? await readVerifiedBackup(options.file) : await downloadBackup(options["s3-key"], options);
  temporaryArchive = hasS3 ? source.archive : undefined;
  const safety = await createBackup({ purpose: "pre-restore-safety" });
  await restoreArchive(source.archive);
  await runNpmScript("db:status");
  await runNpmScript("db:verify");
  console.log(`Restore completed from: ${source.archive}`);
  console.log(`Pre-restore safety backup: ${safety.archive}`);
} catch {
  console.error("Restore failed.");
  process.exitCode = 1;
} finally {
  if (temporaryArchive) {
    await rm(temporaryArchive, { force: true }).catch(() => undefined);
    await rm(`${temporaryArchive}.json`, { force: true }).catch(() => undefined);
  }
}
