import { describe, expect, it } from "vitest";
import { mkdir, readFile } from "node:fs/promises";

const backup = await import("../../scripts/db-backup-lib.mjs");

describe("database backup command safety", () => {
  it("parses only unique, explicit command options", () => {
    expect(backup.parseOptions(["--s3-bucket", "backups", "--s3-force-path-style"])).toEqual({ "s3-bucket": "backups", "s3-force-path-style": true });
    expect(() => backup.parseOptions(["--file", "a", "--file", "b"])).toThrow("Invalid command option.");
    expect(() => backup.parseOptions(["--file"])).toThrow("Missing value for --file.");
  });

  it("requires TLS PostgreSQL URLs and returns only the database name", () => {
    expect(backup.databaseDetails("postgresql://user:secret@db.example/yuyu?sslmode=verify-full").databaseName).toBe("yuyu");
    expect(() => backup.databaseDetails("postgresql://user:secret@db.example/yuyu")).toThrow("must require TLS");
    expect(() => backup.databaseDetails("https://example.com/yuyu?sslmode=require")).toThrow("PostgreSQL");
  });

  it("identifies development and local restore targets", () => {
    expect(backup.isUnsafeRestoreDatabase("postgresql://user:secret@localhost/yuyu?sslmode=require")).toBe(true);
    expect(backup.isUnsafeRestoreDatabase("postgresql://user:secret@db.example/yuyu_test?sslmode=require")).toBe(true);
    expect(backup.isUnsafeRestoreDatabase("postgresql://user:secret@db.example/yuyu?sslmode=require")).toBe(false);
  });

  it("uses an owner-only temporary password file instead of forwarding DATABASE_URL", async () => {
    await mkdir(backup.backupDirectory, { recursive: true });
    const details = backup.databaseDetails("postgresql://backup-user:very-secret@db.example:5433/yuyu?sslmode=verify-full");
    const connection = await backup.createDatabaseEnvironment(details);
    try {
      expect(connection.environment.DATABASE_URL).toBeUndefined();
      expect(connection.environment.PGPASSWORD).toBeUndefined();
      expect(connection.environment.PGHOST).toBe("db.example");
      expect(connection.environment.PGPORT).toBe("5433");
      const passfile = connection.environment.PGPASSFILE;
      expect(passfile).toContain(".pgpass-");
      if (!passfile) throw new Error("Expected PGPASSFILE.");
      await expect(readFile(passfile, "utf8")).resolves.toBe("db.example:5433:yuyu:backup-user:very-secret\n");
    } finally {
      await connection.dispose();
    }
  });

  it("requires complete HTTPS S3 command settings", () => {
    expect(() => backup.s3Options({ "s3-bucket": "x" })).toThrow("All S3 options");
    expect(() => backup.s3Options({ "s3-bucket": "x", "s3-region": "r", "s3-endpoint": "http://s3.example", "s3-access-key-id": "id", "s3-secret-access-key": "secret" })).toThrow("must use HTTPS");
    expect(() => backup.s3Options({ "s3-bucket": "x", "s3-region": "r", "s3-endpoint": "https://s3.example", "s3-access-key-id": "id", "s3-secret-access-key": "secret", "s3-prefix": "../unsafe" })).toThrow("Invalid S3 prefix");
  });
});
