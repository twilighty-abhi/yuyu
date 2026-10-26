/*
 * Full-scale equivalence check for the judging read models
 * (docs/PERFORMANCE.md). Against the seeded PERF_DATABASE_URL:
 *
 *   PERF_GOLDEN_WRITE=before.json  record the outputs of the current code
 *   PERF_GOLDEN_CHECK=before.json  fail unless the current code gives exactly the same
 *
 * Covers the ranking under both score methods, every Progress list, the
 * Judges tab, both auto-assignment previews, and the judging CSV rows.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));
vi.mock("@/lib/actionRateLimit", () => ({ isActionRateLimited: async () => false }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

import { prisma } from "@/lib/db";
import { buildJudgingExportRows, loadJudgeProgress, loadJudgingResults } from "@/lib/core/judging";
import { loadJudgingProgress, loadJudgingProgressPage, previewAutoAssignment } from "@/lib/core/judgingOps";
import { JUDGING_PROGRESS_SECTIONS } from "@/lib/judgingProgress";

const writePath = process.env.PERF_GOLDEN_WRITE;
const checkPath = process.env.PERF_GOLDEN_CHECK;

describe.runIf(Boolean(writePath || checkPath))("judging outputs at full scale", () => {
  it("match the recorded outputs", async () => {
    const event = await prisma.event.findFirstOrThrow({ where: { slug: "load-hackathon" }, select: { id: true, slug: true, organisationId: true, resultsPublishedAt: true, organisation: { select: { slug: true } } } });
    const owner = await prisma.membership.findFirstOrThrow({ where: { organisationId: event.organisationId, role: "OWNER" }, select: { userId: true } });
    const ctx = { userId: owner.userId, organisationId: event.organisationId, orgSlug: event.organisation.slug, eventId: event.id, eventSlug: event.slug };
    const now = new Date("2026-10-26T12:00:00Z");

    const outputs: Record<string, unknown> = {};
    outputs.resultsRaw = await loadJudgingResults(ctx, { method: "RAW" });
    outputs.resultsZ = await loadJudgingResults(ctx, { method: "ZSCORE" });
    outputs.judges = await loadJudgeProgress(ctx);
    outputs.progressSummary = (await loadJudgingProgress(ctx, now))?.summary;
    for (const section of JUDGING_PROGRESS_SECTIONS) {
      const rows: unknown[] = [];
      for (let page = 1; ; page++) {
        const result = await loadJudgingProgressPage(ctx, { section, page }, now);
        if (!result) break;
        rows.push(...result.page.rows);
        if (page >= result.page.totalPages) break;
      }
      outputs[`progress:${section}`] = rows;
    }
    outputs.exportRows = await buildJudgingExportRows(ctx, { method: "ZSCORE" });
    const judges = await prisma.eventCollaborator.findMany({ where: { eventId: event.id, permissions: { has: "JUDGE" } }, select: { userId: true }, orderBy: { userId: "asc" } });
    await prisma.event.update({ where: { id: event.id }, data: { resultsPublishedAt: null } });
    try {
      outputs.previewKeep = await previewAutoAssignment(ctx, { perProject: 3, mode: "keep", judgeUserIds: judges.map((row) => row.userId) });
      outputs.previewReplace = await previewAutoAssignment(ctx, { perProject: 5, mode: "replace", judgeUserIds: judges.map((row) => row.userId) });
    } finally {
      await prisma.event.update({ where: { id: event.id }, data: { resultsPublishedAt: event.resultsPublishedAt } });
    }

    // countedReviewKeys is a set (its order was never defined): compare it sorted.
    for (const key of ["resultsRaw", "resultsZ"] as const) {
      const result = outputs[key] as { countedReviewKeys: string[] } | null;
      if (result) result.countedReviewKeys = [...result.countedReviewKeys].sort();
    }
    const json = JSON.parse(JSON.stringify(outputs)) as Record<string, unknown>;
    if (writePath) writeFileSync(writePath, JSON.stringify(json));
    if (checkPath) {
      const expected = JSON.parse(readFileSync(checkPath, "utf8")) as Record<string, unknown>;
      for (const key of Object.keys(expected)) expect(json[key], key).toEqual(expected[key]);
    }
  });
});
