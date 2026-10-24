"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { JudgingStatus, SubmissionStatus } from "@prisma/client";
import { useToast } from "@/components/feedback/ToastProvider";
import type { ChipTone } from "@/components/ui/display";

/*
 * Small client helpers shared by the organiser Judging panels. Every action
 * is re-checked on the server (organisation admin, event lock, judging rules
 * in lib/core/judging.ts); these only run it, report the outcome, and refresh
 * the server-rendered data.
 */

export type JudgingScope = { organisationSlug: string; eventId: string };

/** Input limits from lib/validators.ts, passed down by the server panel (the server enforces them). */
export type JudgingLimits = {
  criteria: number;
  criterionName: number;
  description: number;
  weight: number;
  maxScore: number;
  awards: number;
  awardName: number;
  awardPlace: number;
  disqualifyReason: number;
};

type Outcome = { ok: true } | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

export const JUDGING_STATUS_LABELS: Record<JudgingStatus, string> = {
  NOT_STARTED: "Not started",
  OPEN: "Open",
  CLOSED: "Closed",
};

export const JUDGING_STATUS_TONES: Record<JudgingStatus, ChipTone> = {
  NOT_STARTED: "neutral",
  OPEN: "success",
  CLOSED: "ink",
};

export const SUBMISSION_STATUS_LABELS: Record<SubmissionStatus, string> = {
  DRAFT: "Draft",
  SUBMITTED: "Submitted",
  WITHDRAWN: "Withdrawn",
  DISQUALIFIED: "Disqualified",
};

export const SUBMISSION_STATUS_TONES: Record<SubmissionStatus, ChipTone> = {
  DRAFT: "warning",
  SUBMITTED: "success",
  WITHDRAWN: "neutral",
  DISQUALIFIED: "danger",
};

/** "72.5" or an em dash for no score. */
export function formatScore(score: number | null): string {
  return score == null ? "—" : score.toFixed(1);
}

/**
 * Runs one judging action at a time: tracks which item is busy, shows a toast,
 * and refreshes the page data on success. Returns field errors to the caller.
 */
export function useJudgingAction() {
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);

  function run(key: string, action: () => Promise<Outcome>, success: string | null, after?: (result: Outcome) => void) {
    setBusy(key);
    startTransition(async () => {
      let result: Outcome;
      try {
        result = await action();
      } catch {
        result = { ok: false, error: "Something went wrong. Try again." };
      }
      setBusy(null);
      if (!result.ok) showToast(result.error, "error");
      else {
        if (success) showToast(success, "success");
        router.refresh();
      }
      after?.(result);
    });
  }

  return { run, pending, busy };
}

/** First message for a field from a server action's field errors. */
export function fieldError(errors: Record<string, string[]> | undefined, key: string): string | undefined {
  return errors?.[key]?.[0];
}
