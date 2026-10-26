import { createBackup, databaseDetails, downloadBackup, isUnsafeRestoreDatabase, parseOptions, readVerifiedBackup, restoreArchive, runNpmScript } from "./db-backup-lib.mjs";
import { rm } from "node:fs/promises";

/** Our own refusal text: safe to print, and says what to change. */
class RestoreRefused extends Error {}

let temporaryArchive;
try {
  const options = parseOptions(process.argv.slice(2));
  const database = databaseDetails();
  const hasFile = typeof options.file === "string";
  const hasS3 = typeof options["s3-key"] === "string";
  if (hasFile === hasS3) throw new Error("Choose exactly one restore source.");
  if (options.production !== true || options["confirm-database"] !== database.databaseName) throw new RestoreRefused("Restore confirmation was refused: pass --production and --confirm-database with the target database name.");
  if (isUnsafeRestoreDatabase(database.url, { viaLocalTunnel: options["via-local-tunnel"] === true })) {
    throw new RestoreRefused("Restore refused: the target looks like a development, test, or local database. Through a local proxy or SSH tunnel to the production server, add --via-local-tunnel.");
  }
  const source = hasFile ? await readVerifiedBackup(options.file) : await downloadBackup(options["s3-key"], options);
  temporaryArchive = hasS3 ? source.archive : undefined;
  const safety = await createBackup({ purpose: "pre-restore-safety" });
  await restoreArchive(source.archive);
  await runNpmScript("db:status");
  await runNpmScript("db:verify");
  console.log(`Restore completed from: ${source.archive}`);
  console.log(`Pre-restore safety backup: ${safety.archive}`);
} catch (error) {
  // Other errors can carry connection details, so only our own refusals are printed.
  console.error(error instanceof RestoreRefused ? error.message : "Restore failed.");
  process.exitCode = 1;
} finally {
  if (temporaryArchive) {
    await rm(temporaryArchive, { force: true }).catch(() => undefined);
    await rm(`${temporaryArchive}.json`, { force: true }).catch(() => undefined);
  }
}
