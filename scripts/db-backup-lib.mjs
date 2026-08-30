import { createHash, randomUUID } from "node:crypto";
import { access, chmod, lstat, mkdir, readFile, readdir, rename, rm, stat, statfs, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const backupDirectory = path.join(rootDirectory, "backups");
const minimumFreeBytes = 256 * 1024 * 1024;
const metadataMaximumBytes = 64 * 1024;
const commandTimeoutMs = 60 * 60 * 1000;

function fail(message) {
  throw new Error(message);
}

export function parseOptions(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--")) fail("Invalid command option.");
    const key = argument.slice(2);
    if (!key || key in options) fail("Invalid command option.");
    if (key === "production" || key === "s3-force-path-style") {
      options[key] = true;
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) fail(`Missing value for --${key}.`);
    options[key] = value;
    index += 1;
  }
  return options;
}

export function databaseDetails(databaseUrl = process.env.DATABASE_URL) {
  if (!databaseUrl) fail("DATABASE_URL is required.");
  let url;
  try { url = new URL(databaseUrl); } catch { fail("DATABASE_URL must be a valid PostgreSQL URL."); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.pathname || url.pathname === '/') fail("DATABASE_URL must name a PostgreSQL database.");
  const sslMode = url.searchParams.get("sslmode");
  if (!['require', 'verify-ca', 'verify-full'].includes(sslMode || '')) fail("DATABASE_URL must require TLS.");
  return { url: url.toString(), databaseName: decodeURIComponent(url.pathname.slice(1)) };
}

function decodeUrlPart(value) {
  try { return decodeURIComponent(value); } catch { fail("DATABASE_URL contains invalid encoding."); }
}

function pgpassEscape(value) {
  return value.replace(/\\/g, "\\\\").replace(/:/g, "\\:");
}

export async function createDatabaseEnvironment(database) {
  const url = new URL(database.url);
  const host = decodeUrlPart(url.hostname);
  const port = url.port || "5432";
  const user = decodeUrlPart(url.username);
  const password = decodeUrlPart(url.password);
  if (!host || !user || !password) fail("DATABASE_URL must include host, user, and password for backup operations.");
  const passfile = path.join(backupDirectory, `.pgpass-${randomUUID()}`);
  await writeFile(passfile, `${pgpassEscape(host)}:${pgpassEscape(port)}:${pgpassEscape(database.databaseName)}:${pgpassEscape(user)}:${pgpassEscape(password)}\n`, { mode: 0o600 });
  await chmod(passfile, 0o600).catch(() => undefined);
  const environment = { ...process.env };
  delete environment.DATABASE_URL;
  for (const key of Object.keys(environment)) {
    if (key.startsWith("PG")) delete environment[key];
  }
  Object.assign(environment, { PGHOST: host, PGPORT: port, PGUSER: user, PGDATABASE: database.databaseName, PGPASSFILE: passfile, PGSSLMODE: url.searchParams.get("sslmode") });
  const queryEnvironment = {
    sslrootcert: "PGSSLROOTCERT", sslcert: "PGSSLCERT", sslkey: "PGSSLKEY", sslcrl: "PGSSLCRL",
    connect_timeout: "PGCONNECT_TIMEOUT", application_name: "PGAPPNAME", target_session_attrs: "PGTARGETSESSIONATTRS",
  };
  for (const [queryKey, environmentKey] of Object.entries(queryEnvironment)) {
    const value = url.searchParams.get(queryKey);
    if (value) environment[environmentKey] = value;
  }
  return { environment, dispose: async () => { await rm(passfile, { force: true }).catch(() => undefined); } };
}

export function isUnsafeRestoreDatabase(databaseUrl) {
  const url = new URL(databaseUrl);
  return ["localhost", "127.0.0.1", "::1"].includes(url.hostname) || /(^|[_-])(dev|test)([_-]|$)/i.test(decodeURIComponent(url.pathname.slice(1)));
}

async function run(command, argumentsList, environment = process.env) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, argumentsList, { stdio: ["ignore", "ignore", "ignore"], env: environment });
    const timeout = setTimeout(() => child.kill("SIGTERM"), commandTimeoutMs);
    child.once("error", () => { clearTimeout(timeout); reject(new Error("Required PostgreSQL command is unavailable.")); });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve(); else reject(new Error("PostgreSQL command failed."));
    });
  });
}

async function commandOutput(command, argumentsList, environment = process.env) {
  return await new Promise((resolve, reject) => {
    let output = "";
    const child = spawn(command, argumentsList, { stdio: ["ignore", "pipe", "ignore"], env: environment });
    const timeout = setTimeout(() => child.kill("SIGTERM"), commandTimeoutMs);
    child.stdout.on("data", (chunk) => { output += chunk.toString(); });
    child.once("error", () => { clearTimeout(timeout); reject(new Error("Required PostgreSQL command is unavailable.")); });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve(output.trim()); else reject(new Error("PostgreSQL command failed."));
    });
  });
}

async function ensureBackupDirectory(requiredBytes = minimumFreeBytes) {
  await mkdir(backupDirectory, { recursive: true, mode: 0o700 });
  await chmod(backupDirectory, 0o700).catch(() => undefined);
  await access(backupDirectory);
  const space = await statfs(backupDirectory);
  if (Number(space.bavail) * Number(space.bsize) < requiredBytes) fail("Backup directory has insufficient free space.");
}

export async function sha256(file) {
  return createHash("sha256").update(await readFile(file)).digest("hex");
}

function archivePaths(timestamp = new Date()) {
  const stamp = timestamp.toISOString().replace(/[:.]/g, "-");
  const name = `yuyu-backup-${stamp}.dump`;
  return { archive: path.join(backupDirectory, name), metadata: path.join(backupDirectory, `${name}.json`) };
}

async function verifyArchive(archive) {
  await run("pg_restore", ["--list", archive]);
}

async function requiredBackupSpace(environment) {
  const sizeText = await commandOutput("psql", ["--tuples-only", "--no-align", "--command", "SELECT pg_database_size(current_database())"], environment);
  if (!/^\d+$/.test(sizeText) || !Number.isSafeInteger(Number(sizeText))) fail("Could not determine database size.");
  return Math.max(minimumFreeBytes, Math.ceil(Number(sizeText) * 1.2) + minimumFreeBytes);
}

function validS3Prefix(prefix = "yuyu-backups") {
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,255}$/.test(prefix) || prefix.includes("..") || prefix.startsWith("/")) fail("Invalid S3 prefix.");
  return prefix.replace(/\/$/, "");
}

export function s3Options(options) {
  const keys = ["s3-bucket", "s3-region", "s3-endpoint", "s3-access-key-id", "s3-secret-access-key"];
  if (!keys.every((key) => typeof options[key] === "string" && options[key])) fail("All S3 options are required for S3 operations.");
  let endpoint;
  try { endpoint = new URL(options["s3-endpoint"]); } catch { fail("S3 endpoint must be a valid HTTPS URL."); }
  if (endpoint.protocol !== "https:") fail("S3 endpoint must use HTTPS.");
  return {
    bucket: options["s3-bucket"], prefix: validS3Prefix(options["s3-prefix"]),
    client: new S3Client({ region: options["s3-region"], endpoint: endpoint.toString(), forcePathStyle: options["s3-force-path-style"] === true,
      credentials: { accessKeyId: options["s3-access-key-id"], secretAccessKey: options["s3-secret-access-key"] } }),
  };
}

export async function uploadBackup(archive, metadata, options) {
  const s3 = s3Options(options);
  const key = `${s3.prefix}/${path.basename(archive)}`;
  await s3.client.send(new PutObjectCommand({ Bucket: s3.bucket, Key: key, Body: createReadStream(archive), ContentType: "application/octet-stream" }));
  await s3.client.send(new PutObjectCommand({ Bucket: s3.bucket, Key: `${key}.json`, Body: createReadStream(metadata), ContentType: "application/json" }));
  return key;
}

async function pruneBackups() {
  const entries = await readdir(backupDirectory);
  const complete = [];
  for (const entry of entries.filter((name) => name.endsWith(".dump"))) {
    const archive = path.join(backupDirectory, entry);
    const metadata = `${archive}.json`;
    try {
      const [archiveInfo, metadataInfo] = await Promise.all([lstat(archive), lstat(metadata)]);
      if (archiveInfo.isFile() && !archiveInfo.isSymbolicLink() && metadataInfo.isFile() && !metadataInfo.isSymbolicLink()) complete.push({ archive, metadata, modified: (await stat(metadata)).mtimeMs });
    } catch { /* incomplete archive pairs are deliberately retained for investigation */ }
  }
  complete.sort((left, right) => right.modified - left.modified);
  await Promise.all(complete.slice(7).flatMap(({ archive, metadata }) => [rm(archive), rm(metadata)]));
}

export async function createBackup({ options = {}, purpose = "manual" } = {}) {
  const database = databaseDetails();
  await ensureBackupDirectory();
  const connection = await createDatabaseEnvironment(database);
  try {
    const clientVersion = await commandOutput("pg_dump", ["--version"]);
    await ensureBackupDirectory(await requiredBackupSpace(connection.environment));
    const { archive, metadata } = archivePaths();
    const partial = `${archive}.${randomUUID()}.partial`;
    try {
      await run("pg_dump", ["--format=custom", "--compress=9", `--file=${partial}`], connection.environment);
      await verifyArchive(partial);
      const digest = await sha256(partial);
      const size = (await stat(partial)).size;
      const details = { version: 1, createdAt: new Date().toISOString(), databaseName: database.databaseName, byteSize: size, sha256: digest, pgDumpVersion: clientVersion, purpose };
      await rename(partial, archive);
      await writeFile(`${metadata}.partial`, `${JSON.stringify(details, null, 2)}\n`, { mode: 0o600 });
      await rename(`${metadata}.partial`, metadata);
      await chmod(archive, 0o600).catch(() => undefined);
      await chmod(metadata, 0o600).catch(() => undefined);
      if (options.upload) await uploadBackup(archive, metadata, options);
      await pruneBackups();
      return { archive, metadata, s3Key: options.upload ? `${validS3Prefix(options["s3-prefix"])}/${path.basename(archive)}` : null };
    } finally {
      await rm(partial, { force: true }).catch(() => undefined);
      await rm(`${metadata}.partial`, { force: true }).catch(() => undefined);
    }
  } finally {
    await connection.dispose();
  }
}

export async function readVerifiedBackup(archive) {
  const root = await import("node:fs/promises").then(({ realpath }) => realpath(backupDirectory));
  const info = await lstat(archive).catch(() => fail("Backup archive does not exist."));
  if (!info.isFile() || info.isSymbolicLink()) fail("Backup archive must be a regular file.");
  const resolved = await import("node:fs/promises").then(({ realpath }) => realpath(archive));
  if (!resolved.startsWith(`${root}${path.sep}`)) fail("Backup archive must be inside backups/.");
  const metadataPath = `${resolved}.json`;
  const metadataInfo = await lstat(metadataPath).catch(() => fail("Backup metadata is missing or invalid."));
  if (!metadataInfo.isFile() || metadataInfo.isSymbolicLink()) fail("Backup metadata must be a regular file.");
  let metadata;
  try { metadata = JSON.parse(await readFile(metadataPath, "utf8")); } catch { fail("Backup metadata is missing or invalid."); }
  if (!metadata || metadata.version !== 1 || typeof metadata.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(metadata.sha256) || typeof metadata.databaseName !== "string" || !Number.isSafeInteger(metadata.byteSize) || metadata.byteSize < 1 || typeof metadata.createdAt !== "string" || Number.isNaN(Date.parse(metadata.createdAt)) || typeof metadata.pgDumpVersion !== "string") fail("Backup metadata is invalid.");
  if ((await stat(resolved)).size !== metadata.byteSize) fail("Backup size does not match metadata.");
  if (metadata.sha256 !== await sha256(resolved)) fail("Backup checksum does not match metadata.");
  await verifyArchive(resolved);
  return { archive: resolved, metadata };
}

export async function downloadBackup(key, options) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,511}\.dump$/.test(key) || key.includes("..") || key.startsWith("/")) fail("Invalid S3 backup key.");
  await ensureBackupDirectory();
  const s3 = s3Options(options);
  if (!key.startsWith(`${s3.prefix}/`)) fail("S3 backup key is outside the configured prefix.");
  const archive = path.join(backupDirectory, `.restore-${randomUUID()}.dump`);
  const partial = `${archive}.partial`;
  const metadataPartial = `${archive}.json.partial`;
  try {
    const [archiveObject, metadataObject] = await Promise.all([s3.client.send(new GetObjectCommand({ Bucket: s3.bucket, Key: key })), s3.client.send(new GetObjectCommand({ Bucket: s3.bucket, Key: `${key}.json` }))]);
    if (!archiveObject.Body || !metadataObject.Body) fail("S3 backup is incomplete.");
    const availableBytes = Number((await statfs(backupDirectory)).bavail) * Number((await statfs(backupDirectory)).bsize);
    if (archiveObject.ContentLength && archiveObject.ContentLength > availableBytes) fail("Backup directory has insufficient free space.");
    if (metadataObject.ContentLength && metadataObject.ContentLength > metadataMaximumBytes) fail("S3 backup metadata is too large.");
    const archiveStream = typeof archiveObject.Body.pipe === "function" ? archiveObject.Body : Readable.fromWeb(archiveObject.Body.transformToWebStream());
    const metadataStream = typeof metadataObject.Body.pipe === "function" ? metadataObject.Body : Readable.fromWeb(metadataObject.Body.transformToWebStream());
    await pipeline(archiveStream, createWriteStream(partial, { mode: 0o600 }));
    await pipeline(metadataStream, createWriteStream(metadataPartial, { mode: 0o600 }));
    if ((await stat(metadataPartial)).size > metadataMaximumBytes) fail("S3 backup metadata is too large.");
    await rename(partial, archive);
    await rename(metadataPartial, `${archive}.json`);
    return await readVerifiedBackup(archive);
  } catch (error) {
    await rm(archive, { force: true }).catch(() => undefined);
    await rm(`${archive}.json`, { force: true }).catch(() => undefined);
    await rm(partial, { force: true }).catch(() => undefined);
    await rm(metadataPartial, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function restoreArchive(archive) {
  const database = databaseDetails();
  const connection = await createDatabaseEnvironment(database);
  try {
    await run("pg_restore", ["--clean", "--if-exists", "--no-owner", "--no-privileges", "--exit-on-error", "--single-transaction", `--dbname=${database.databaseName}`, archive], connection.environment);
  } finally {
    await connection.dispose();
  }
}

export async function runNpmScript(script) {
  await run("npm", ["run", script]);
}
