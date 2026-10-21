import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");

describe("production migration safety contracts", () => {
  it("preserves standalone schedule rows before replacing their legacy column", () => {
    const sql = readFileSync(resolve(root, "prisma/migrations/20260828130000_event_website_program/migration.sql"), "utf8");
    const backup = sql.indexOf('CREATE TEMP TABLE "_standalone_schedule_migration"');
    const deletion = sql.indexOf('DELETE FROM "EventScheduleItem" WHERE "eventId" IS NOT NULL');
    const restore = sql.indexOf('FROM "_standalone_schedule_migration";');
    expect(backup).toBeGreaterThanOrEqual(0);
    expect(deletion).toBeGreaterThan(backup);
    expect(restore).toBeGreaterThan(deletion);
  });

  it("restores cascade-safe auditing and covers collaborator security tables", () => {
    const sql = readFileSync(resolve(root, "prisma/migrations/20260829180000_production_readiness_integrity/migration.sql"), "utf8");
    expect(sql).toContain("IF TG_OP = 'DELETE' THEN\n    organisation_id := NULL;");
    expect(sql).toContain('audit_fallback_eventcollaborator"');
    expect(sql).toContain('audit_fallback_eventcollaboratorinvite"');
  });

  it("backfills immutable feedback field semantics before allowing field removal", () => {
    const sql = readFileSync(resolve(root, "prisma/migrations/20260830020000_feedback_answer_snapshots/migration.sql"), "utf8");
    const addSnapshots = sql.indexOf('ADD COLUMN "fieldKey"');
    const backfill = sql.indexOf('UPDATE "EventFeedbackAnswer" AS answer');
    const notNull = sql.indexOf('ALTER COLUMN "fieldKey" SET NOT NULL');
    const setNull = sql.indexOf('ON DELETE SET NULL');
    expect(addSnapshots).toBeGreaterThanOrEqual(0);
    expect(backfill).toBeGreaterThan(addSnapshots);
    expect(notNull).toBeGreaterThan(backfill);
    expect(setNull).toBeGreaterThan(notNull);
  });

  it("normalizes outbox rows before enforcing the queue state machine", () => {
    const sql = readFileSync(resolve(root, "prisma/migrations/20260830030000_outbox_state_integrity/migration.sql"), "utf8");
    const removeCapabilities = sql.indexOf('DELETE FROM "OutboxMessage"');
    const redactLegacyErrors = sql.indexOf("Legacy delivery failure detail redacted");
    const clearLocks = sql.indexOf('SET "lockedAt" = NULL');
    const repairSent = sql.indexOf('SET "sentAt" = COALESCE');
    const constraint = sql.indexOf('ADD CONSTRAINT "OutboxMessage_state_shape"');
    expect(removeCapabilities).toBeGreaterThanOrEqual(0);
    expect(redactLegacyErrors).toBeGreaterThan(removeCapabilities);
    expect(clearLocks).toBeGreaterThan(redactLegacyErrors);
    expect(repairSent).toBeGreaterThan(clearLocks);
    expect(constraint).toBeGreaterThan(repairSent);
  });

  it("adds event broadcasts without touching existing tables, types, or indexes", () => {
    const sql = readFileSync(resolve(root, "prisma/migrations/20261013000000_event_broadcasts/migration.sql"), "utf8");
    expect(sql).not.toMatch(/\bDROP\b/i);
    expect(sql).not.toMatch(/ALTER TABLE "(?!EventBroadcast")/);
    expect(sql).toContain('CREATE TABLE "EventBroadcast"');
    expect(sql).toContain('"EventBroadcast_statuses_nonempty" CHECK (cardinality("statuses") > 0)');
    expect(sql).toContain('REFERENCES "Event"("id") ON DELETE CASCADE');
    expect(sql).toContain('REFERENCES "User"("id") ON DELETE SET NULL');
  });

  it("adds broadcast drafts as a new table that cascades with its event and author", () => {
    const sql = readFileSync(resolve(root, "prisma/migrations/20261022000000_event_broadcast_drafts/migration.sql"), "utf8");
    expect(sql).not.toMatch(/\bDROP\b/i);
    expect(sql).not.toMatch(/ALTER TABLE "(?!EventBroadcastDraft")/);
    expect(sql).not.toMatch(/^\s*(UPDATE|DELETE FROM|INSERT INTO)\b/m);
    expect(sql).toContain('CREATE TABLE "EventBroadcastDraft"');
    expect(sql).toContain('CREATE UNIQUE INDEX "EventBroadcastDraft_eventId_userId_key" ON "EventBroadcastDraft"("eventId", "userId")');
    expect(sql).toContain('CHECK (char_length("subject") <= 150)');
    expect(sql).toContain('FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE');
    expect(sql).toContain('FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE');
  });
});
