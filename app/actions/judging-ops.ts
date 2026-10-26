"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import * as ops from "@/lib/core/judgingOps";
import { resolveJudgingOrganiser, type JudgingOrganiserContext } from "@/lib/judgingAccess";
import type { ActionResult } from "./org";

/*
 * Judging operations on the event dashboard (docs/HACKATHON.md): automatic
 * judge assignment, the review target, and the Progress dashboard. The
 * permission check is the one every judging management surface uses
 * (organisation OWNER/ADMIN, `resolveJudgingOrganiser`, which re-reads the
 * event inside the organisation); the rules, the Event lock, and the audit
 * events live in lib/core/judgingOps.ts.
 */

const NO_PERMISSION = "You do not have permission to manage judging for this event.";

const scopeSchema = z.object({
  organisationSlug: z.string().trim().min(1).max(128),
  eventId: z.string().trim().min(1).max(128),
});

type Gate = { ok: true; ctx: JudgingOrganiserContext; input: Record<string, unknown> } | { ok: false; error: string };

function record(input: unknown): Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
}

async function organiserGate(input: unknown, bucket: "action" | "search"): Promise<Gate> {
  const fields = record(input);
  const scope = scopeSchema.safeParse({ organisationSlug: fields.organisationSlug, eventId: fields.eventId });
  if (!scope.success) return { ok: false, error: "Invalid input." };
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in." };
  if (await isActionRateLimited(bucket, userId)) return { ok: false, error: bucket === "search" ? "Too many requests. Try again shortly." : "Too many judging updates. Try again shortly." };
  const ctx = await resolveJudgingOrganiser(userId, scope.data.organisationSlug, scope.data.eventId);
  if (!ctx) return { ok: false, error: NO_PERMISSION };
  return { ok: true, ctx, input: fields };
}

function revalidateJudging(ctx: JudgingOrganiserContext) {
  revalidatePath(`/dashboard/${ctx.orgSlug}/event/${ctx.eventId}`);
}

function autoAssignInput(fields: Record<string, unknown>, withFingerprint: boolean) {
  const options = record(fields.options);
  return {
    perProject: options.perProject,
    mode: options.mode,
    judgeUserIds: options.judgeUserIds,
    ...(withFingerprint ? { fingerprint: options.fingerprint } : {}),
  };
}

/** Plan an automatic assignment without changing anything (read-only, no revalidation). */
export async function previewJudgeAutoAssignment(input: unknown): Promise<ActionResult<ops.AutoAssignPreviewDto>> {
  const gate = await organiserGate(input, "search");
  if (!gate.ok) return gate;
  return ops.previewAutoAssignment(gate.ctx, autoAssignInput(gate.input, false));
}

/** Apply the previewed plan (refused when it changed since the preview). */
export async function applyJudgeAutoAssignment(input: unknown): Promise<ActionResult<ops.AutoAssignAppliedDto>> {
  const gate = await organiserGate(input, "action");
  if (!gate.ok) return gate;
  const result = await ops.applyAutoAssignment(gate.ctx, autoAssignInput(gate.input, true));
  if (result.ok) revalidateJudging(gate.ctx);
  return result;
}

/** Set or clear the target number of judges per project. */
export async function saveReviewsPerProject(input: unknown): Promise<ActionResult<{ reviewsPerProject: number | null }>> {
  const gate = await organiserGate(input, "action");
  if (!gate.ok) return gate;
  const result = await ops.setReviewsPerProject(gate.ctx, gate.input.reviewsPerProject ?? null);
  if (result.ok) revalidateJudging(gate.ctx);
  return result;
}

/** One numbered page of one Progress list (read-only, on the search rate-limit bucket). */
export async function loadJudgingProgressPage(input: unknown): Promise<ActionResult<ops.JudgingProgressSectionDto>> {
  const gate = await organiserGate(input, "search");
  if (!gate.ok) return gate;
  const page = await ops.loadJudgingProgressPage(gate.ctx, { section: gate.input.section, page: gate.input.page ?? 1 });
  if (!page) return { ok: false, error: "Invalid input." };
  return { ok: true, data: page };
}
