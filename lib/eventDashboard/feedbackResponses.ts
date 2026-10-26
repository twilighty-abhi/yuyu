import "server-only";

import { z } from "zod";
import { prisma } from "@/lib/db";
import { clampPage } from "@/lib/eventDashboard/invites";

/*
 * Feedback → Responses → "Show individual responses", one numbered page at a
 * time (no browser cap). Callers must have checked that the viewer may read
 * responses (organisation OWNER/ADMIN, `canViewFeedbackResponses`); the form
 * is re-read here inside the event and its organisation. Only answer values
 * are read: never the RSVP, attendee identity or certificate token.
 */

export const FEEDBACK_RESPONSES_PAGE_SIZE = 25;

export const feedbackResponsesPageViewSchema = z
  .object({ page: z.number().int().min(1).max(100_000).optional().default(1) })
  .strict();

export type FeedbackResponseRow = {
  id: string;
  /** 1 for the first response ever submitted; stable across pages. */
  number: number;
  submittedAt: string;
  answers: Array<{ label: string; value: string }>;
};

export type FeedbackResponsesPage = {
  responses: FeedbackResponseRow[];
  /** The page actually shown (a page past the end shows the last one). */
  page: number;
  pageCount: number;
  total: number;
  pageSize: number;
};

type AnswerValue = { valueText: string | null; valueBool: boolean | null; valueNumber: number | null; valueDate: Date | null };

/** One answer as text; null when the answer holds no value. */
export function feedbackAnswerText(answer: AnswerValue): string | null {
  if (answer.valueText != null) return answer.valueText;
  if (answer.valueBool != null) return answer.valueBool ? "Yes" : "No";
  if (answer.valueNumber != null) return String(answer.valueNumber);
  return answer.valueDate ? answer.valueDate.toISOString().slice(0, 10) : null;
}

/** Answers grouped by question (a multi-select's values joined), in the order they were given. */
export function groupFeedbackAnswers(answers: ReadonlyArray<AnswerValue & { fieldKey: string; fieldLabel: string }>): Array<{ label: string; value: string }> {
  const grouped = new Map<string, { label: string; values: string[] }>();
  for (const answer of answers) {
    const value = feedbackAnswerText(answer);
    if (value === null) continue;
    const entry = grouped.get(answer.fieldKey) ?? { label: answer.fieldLabel, values: [] };
    entry.values.push(value);
    grouped.set(answer.fieldKey, entry);
  }
  return [...grouped.values()].map((entry) => ({ label: entry.label, value: entry.values.join(", ") }));
}

const EMPTY = (pageSize: number): FeedbackResponsesPage => ({ responses: [], page: 1, pageCount: 1, total: 0, pageSize });

/** Newest first, `id` breaking ties so pages never skip or repeat a response. */
export async function listFeedbackResponsesPage(scope: { eventId: string; organisationId: string }, input: unknown = {}): Promise<FeedbackResponsesPage> {
  const parsed = feedbackResponsesPageViewSchema.safeParse(input ?? {});
  const requested = parsed.success ? parsed.data.page : 1;
  const form = await prisma.eventFeedbackForm.findFirst({
    where: { eventId: scope.eventId, event: { organisationId: scope.organisationId } },
    select: { id: true },
  });
  if (!form) return EMPTY(FEEDBACK_RESPONSES_PAGE_SIZE);
  const total = await prisma.eventFeedbackResponse.count({ where: { formId: form.id } });
  const { page, pageCount } = clampPage(requested, total, FEEDBACK_RESPONSES_PAGE_SIZE);
  if (total === 0) return EMPTY(FEEDBACK_RESPONSES_PAGE_SIZE);
  const skip = (page - 1) * FEEDBACK_RESPONSES_PAGE_SIZE;
  const rows = await prisma.eventFeedbackResponse.findMany({
    where: { formId: form.id },
    orderBy: [{ submittedAt: "desc" }, { id: "desc" }],
    skip,
    take: FEEDBACK_RESPONSES_PAGE_SIZE,
    select: {
      id: true,
      submittedAt: true,
      answers: { select: { fieldKey: true, fieldLabel: true, valueText: true, valueBool: true, valueNumber: true, valueDate: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
    },
  });
  return {
    responses: rows.map((row, index) => ({ id: row.id, number: total - skip - index, submittedAt: row.submittedAt.toISOString(), answers: groupFeedbackAnswers(row.answers) })),
    page,
    pageCount,
    total,
    pageSize: FEEDBACK_RESPONSES_PAGE_SIZE,
  };
}
