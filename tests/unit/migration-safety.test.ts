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

  it("adds team registration without rewriting existing rows", () => {
    const sql = readFileSync(resolve(root, "prisma/migrations/20261024000000_team_registration/migration.sql"), "utf8");
    expect(sql).not.toMatch(/\bDROP\b/i);
    expect(sql).not.toMatch(/^\s*UPDATE\s/im);
    expect(sql).toContain('ADD COLUMN     "registrationMode" "RegistrationMode" NOT NULL DEFAULT \'INDIVIDUAL\'');
    expect(sql).toContain('ALTER TABLE "RSVP" ADD COLUMN     "teamId" TEXT;');
    expect(sql).toContain('"Event_team_min_size_positive" CHECK ("teamMinSize" IS NULL OR "teamMinSize" >= 1)');
    expect(sql).toContain('"Event_team_max_size_at_least_two" CHECK ("teamMaxSize" IS NULL OR "teamMaxSize" >= 2)');
    expect(sql).toContain('"Event_team_size_order" CHECK ("teamMinSize" IS NULL OR "teamMaxSize" IS NULL OR "teamMaxSize" >= "teamMinSize")');
    expect(sql).toContain('"Event_team_mode_requires_max_size" CHECK ("registrationMode" <> \'TEAM\' OR "teamMaxSize" IS NOT NULL)');
    expect(sql).toContain('CREATE UNIQUE INDEX "TeamJoinRequest_one_pending_per_team_rsvp" ON "TeamJoinRequest"("teamId", "rsvpId") WHERE "status" = \'PENDING\'');
    expect(sql).toContain('CREATE UNIQUE INDEX "Team_eventId_nameKey_key"');
    expect(sql).toContain('CREATE UNIQUE INDEX "Team_manageTokenHash_key"');
    expect(sql).toContain('"RSVP_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL');
    expect(sql).toContain('"Team_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE');
    expect(sql).toContain('"TeamSeekerProfile_rsvpId_fkey" FOREIGN KEY ("rsvpId") REFERENCES "RSVP"("id") ON DELETE CASCADE');
    expect(sql).toContain('"TeamJoinRequest_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE');
  });

  it("adds hackathon judging without rewriting existing rows", () => {
    const sql = readFileSync(resolve(root, "prisma/migrations/20261024010000_hackathon_judging/migration.sql"), "utf8");
    expect(sql).not.toMatch(/\bDROP\b/i);
    expect(sql).not.toMatch(/^\s*UPDATE\s/im);
    expect(sql).toContain(`ALTER TYPE "EventPermission" ADD VALUE 'JUDGE';`);
    expect(sql).toContain('ADD COLUMN     "submissionsEnabled" BOOLEAN NOT NULL DEFAULT false');
    expect(sql).toContain('ADD COLUMN     "judgingStatus" "JudgingStatus" NOT NULL DEFAULT \'NOT_STARTED\'');
    expect(sql).toContain('"Submission_exactly_one_entrant" CHECK (num_nonnulls("teamId", "rsvpId") = 1)');
    expect(sql).toContain('"Event_submission_window_order" CHECK ("submissionsOpenAt" IS NULL OR "submissionsCloseAt" IS NULL OR "submissionsCloseAt" > "submissionsOpenAt")');
    expect(sql).toContain('"JudgingCriterion_weight_range" CHECK ("weight" BETWEEN 1 AND 10)');
    expect(sql).toContain('"JudgingCriterion_max_score_range" CHECK ("maxScore" BETWEEN 1 AND 10)');
    expect(sql).toContain('"JudgeScore_score_range" CHECK ("score" BETWEEN 0 AND 10)');
    expect(sql).toContain('"EventAwardWinner_place_positive" CHECK ("place" >= 1)');
    expect(sql).toContain('CREATE UNIQUE INDEX "Submission_teamId_key"');
    expect(sql).toContain('CREATE UNIQUE INDEX "Submission_rsvpId_key"');
    expect(sql).toContain('CREATE UNIQUE INDEX "SubmissionLink_tokenHash_key"');
    expect(sql).toContain('CREATE UNIQUE INDEX "JudgeScore_submissionId_judgeUserId_criterionId_key"');
    expect(sql).toContain('CREATE UNIQUE INDEX "JudgeReview_submissionId_judgeUserId_key"');
    expect(sql).toContain('CREATE UNIQUE INDEX "EventAwardWinner_awardId_place_key"');
    expect(sql).toContain('"Submission_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE');
    expect(sql).toContain('"Submission_rsvpId_fkey" FOREIGN KEY ("rsvpId") REFERENCES "RSVP"("id") ON DELETE CASCADE');
    expect(sql).toContain('"Submission_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE');
  });

  it("adds the results announcement marker as a nullable column", () => {
    const sql = readFileSync(resolve(root, "prisma/migrations/20261024020000_judging_results_announced/migration.sql"), "utf8");
    expect(sql).not.toMatch(/\bDROP\b/i);
    expect(sql).not.toMatch(/^\s*UPDATE\s/im);
    expect(sql).toContain('ALTER TABLE "Event" ADD COLUMN "resultsAnnouncedAt" TIMESTAMP(3);');
  });
});
