"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ChevronRight, ExternalLink, Users } from "lucide-react";
import type { JudgingStatus } from "@prisma/client";
import { loadJudgeSubmission, saveJudgeReviewAction } from "@/app/actions/judging";
import { useToast } from "@/components/feedback/ToastProvider";
import { Button } from "@/components/ui/button";
import { Callout, Card, Chip, EmptyState, ProgressBar } from "@/components/ui/display";
import { Field, Textarea } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/cn";
import type { JudgeSubmissionDetailDto, JudgeSubmissionDto, JudgingCriterionDto } from "@/lib/judgingDto";
import {
  isFullyScored,
  judgeProgressChip,
  judgeProgressSummary,
  judgingStatusNotice,
  linkLabel,
  scoreMapFrom,
  scoresToSave,
  type ScoreMap,
} from "./judgeProgress";

const COMMENT_MAX_LENGTH = 2000;

type Scope = { organisationSlug: string; eventId: string };

/**
 * Client half of the judge workspace: the list of submissions with this
 * judge's progress, and a scoring view loaded on demand. All reads and
 * writes go through app/actions/judging.ts, which re-checks access.
 */
export function JudgeWorkspaceClient({
  organisationSlug,
  eventId,
  judgingStatus,
  criteria,
  submissions,
}: Scope & {
  judgingStatus: JudgingStatus;
  criteria: JudgingCriterionDto[];
  submissions: JudgeSubmissionDto[];
}) {
  const { showToast } = useToast();
  const [detail, setDetail] = useState<JudgeSubmissionDetailDto | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const request = useRef(0);
  const notice = judgingStatusNotice(judgingStatus);
  const summary = judgeProgressSummary(submissions);

  function open(submissionId: string) {
    const ticket = ++request.current;
    setOpeningId(submissionId);
    startTransition(async () => {
      const res = await loadJudgeSubmission({ organisationSlug, eventId, submissionId });
      if (ticket !== request.current) return;
      setOpeningId(null);
      if (!res.ok || !res.data) {
        showToast(res.ok ? "This submission is not available to you." : res.error, "error");
        return;
      }
      setDetail(res.data);
      window.scrollTo({ top: 0, behavior: "auto" });
    });
  }

  function close() {
    request.current++;
    setOpeningId(null);
    setDetail(null);
  }

  if (detail) {
    return (
      <ScoringView
        key={detail.submission.id}
        scope={{ organisationSlug, eventId }}
        detail={detail}
        onBack={close}
        onSaved={(next) => setDetail(next)}
      />
    );
  }

  return (
    <section aria-labelledby="judge-workspace-title" className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 id="judge-workspace-title" className="text-title text-ink">Score submissions</h2>
        <p className="text-body-ui text-ink-muted">
          Read each project, score it against the rubric, and submit your review. Your comments are private to the organisers.
        </p>
      </div>

      {notice ? <Callout tone={judgingStatus === "CLOSED" ? "info" : "warning"} title={notice.title}>{notice.body}</Callout> : null}
      {criteria.length === 0 ? (
        <Callout tone="warning" title="No rubric yet">The organisers have not added judging criteria, so there is nothing to score yet.</Callout>
      ) : null}

      {submissions.length === 0 ? (
        <EmptyState title="No submissions to score">
          Submitted projects you are asked to judge will appear here. Projects from a team or registration you belong to are never shown to you.
        </EmptyState>
      ) : (
        <>
          <Card padding="sm" className="flex flex-col gap-2.5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-label text-ink">
                {summary.submitted} of {summary.total} {summary.total === 1 ? "review" : "reviews"} submitted
              </p>
              {summary.started > 0 ? <p className="text-caption text-ink-muted">{summary.started} in progress</p> : null}
            </div>
            <ProgressBar value={summary.submitted} max={summary.total} tone="success" label="Reviews submitted" />
          </Card>

          <ul className="flex flex-col gap-2.5">
            {submissions.map((submission) => {
              const chip = judgeProgressChip(submission, criteria.length);
              const busy = openingId === submission.id;
              return (
                <li key={submission.id}>
                  <button
                    type="button"
                    onClick={() => open(submission.id)}
                    disabled={openingId !== null}
                    aria-busy={busy || undefined}
                    className="flex w-full items-center gap-3 rounded-lg border border-line bg-canvas p-4 text-left transition-colors hover:bg-subtle disabled:cursor-progress focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--yy-focus)]"
                  >
                    <span className="flex min-w-0 flex-1 flex-col gap-1">
                      <span className="truncate text-[17px] font-bold text-ink">{submission.title}</span>
                      <span className="flex min-w-0 items-center gap-1.5 text-caption text-ink-muted">
                        {submission.isTeam ? <Users aria-hidden className="size-3.5 shrink-0" /> : null}
                        <span className="truncate">{submission.entrantName}</span>
                      </span>
                      {submission.summary ? <span className="line-clamp-2 text-body-ui text-ink-secondary">{submission.summary}</span> : null}
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <Chip tone={chip.tone} size="sm">{chip.label}</Chip>
                      {busy ? <Spinner className="size-4" /> : <ChevronRight aria-hidden className="size-4 text-ink-muted" />}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}

function ScoringView({
  scope,
  detail,
  onBack,
  onSaved,
}: {
  scope: Scope;
  detail: JudgeSubmissionDetailDto;
  onBack: () => void;
  onSaved: (next: JudgeSubmissionDetailDto) => void;
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  const [saving, setSaving] = useState<"draft" | "submit" | null>(null);
  const [scores, setScores] = useState<ScoreMap>(() => scoreMapFrom(detail.myScores, detail.criteria));
  const [comment, setComment] = useState(detail.myReview?.comment ?? "");
  const [error, setError] = useState<string | null>(null);
  const { submission, criteria, judgingStatus } = detail;
  const readOnly = judgingStatus !== "OPEN";
  const notice = judgingStatusNotice(judgingStatus);
  const submitted = Boolean(detail.myReview?.submittedAt);
  const complete = isFullyScored(scores, criteria);
  const links = [
    { label: "Code", url: submission.repoUrl },
    { label: "Demo", url: submission.demoUrl },
    { label: "Video", url: submission.videoUrl },
  ].filter((link): link is { label: string; url: string } => Boolean(link.url));

  function save(submit: boolean) {
    setError(null);
    setSaving(submit ? "submit" : "draft");
    startTransition(async () => {
      const entered = scoresToSave(scores, criteria);
      const res = await saveJudgeReviewAction({ ...scope, submissionId: submission.id, scores: entered, comment, submit });
      setSaving(null);
      if (!res.ok || !res.data) {
        const message = res.ok ? "Could not save your review." : res.error;
        setError(message);
        showToast(message, "error");
        return;
      }
      const nowSubmitted = res.data.submitted;
      onSaved({
        ...detail,
        submission: { ...submission, scoredCriteria: res.data.scored, reviewSubmitted: nowSubmitted },
        myScores: entered,
        myReview: { comment, submittedAt: nowSubmitted ? (detail.myReview?.submittedAt ?? new Date()) : null },
      });
      showToast(submit ? (submitted ? "Review updated." : "Review submitted.") : "Scores saved.", "success");
      router.refresh();
    });
  }

  return (
    <section aria-labelledby="judge-submission-title" className="flex flex-col gap-5">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex min-h-9 items-center gap-1.5 self-start text-sm font-semibold text-ink-secondary hover:text-ink"
      >
        <ArrowLeft aria-hidden className="size-4" />
        All submissions
      </button>

      {notice ? <Callout tone={judgingStatus === "CLOSED" ? "info" : "warning"} title={notice.title}>{notice.body}</Callout> : null}

      <Card as="article" padding="lg" className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            {submission.isTeam ? <Chip size="sm" icon={<Users />}>Team</Chip> : null}
            {submitted ? <Chip size="sm" tone="success">Review submitted</Chip> : null}
          </div>
          <h2 id="judge-submission-title" className="text-h3 break-words text-ink">{submission.title}</h2>
          <p className="text-body-ui text-ink-muted">{submission.entrantName}</p>
        </div>
        {submission.summary ? <p className="whitespace-pre-wrap break-words text-body text-ink-secondary">{submission.summary}</p> : null}
        {links.length ? (
          <ul className="flex flex-wrap gap-2">
            {links.map((link) => (
              <li key={link.label}>
                <a
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  referrerPolicy="no-referrer"
                  className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-line-strong bg-canvas px-3.5 text-sm font-semibold text-ink transition-colors hover:bg-subtle"
                >
                  {link.label}
                  <span className="max-w-[16ch] truncate font-normal text-ink-muted">{linkLabel(link.url)}</span>
                  <ExternalLink aria-hidden className="size-3.5 shrink-0" />
                  <span className="sr-only">(opens in a new tab)</span>
                </a>
              </li>
            ))}
          </ul>
        ) : null}
      </Card>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!readOnly && complete) save(true);
        }}
        className="flex flex-col gap-5"
      >
        <fieldset disabled={readOnly || pending} className="flex flex-col gap-4">
          <legend className="mb-1 text-title text-ink">Rubric</legend>
          {criteria.length === 0 ? (
            <p className="text-body-ui text-ink-muted">The organisers have not added judging criteria yet.</p>
          ) : (
            criteria.map((criterion) => (
              <CriterionInput
                key={criterion.id}
                criterion={criterion}
                value={scores[criterion.id]}
                onChange={(score) => setScores((current) => ({ ...current, [criterion.id]: score }))}
              />
            ))
          )}
          <Field
            label="Private comment"
            optional
            helperText={`Only organisers see this. ${comment.length} / ${COMMENT_MAX_LENGTH}`}
          >
            <Textarea value={comment} onChange={(event) => setComment(event.target.value)} maxLength={COMMENT_MAX_LENGTH} rows={5} />
          </Field>
        </fieldset>

        {error ? <Callout tone="danger" role="alert">{error}</Callout> : null}

        {readOnly ? null : (
          <div className="flex flex-col-reverse gap-2.5 sm:flex-row sm:items-center sm:justify-end">
            {!complete && criteria.length > 0 ? (
              <p className="text-caption text-ink-muted sm:mr-auto">Score every criterion to submit your review.</p>
            ) : null}
            <Button type="button" variant="secondary" onClick={() => save(false)} loading={saving === "draft"} disabled={pending}>
              Save scores
            </Button>
            <Button type="submit" variant="primary" loading={saving === "submit"} disabled={pending || !complete}>
              {submitted ? "Update review" : "Submit review"}
            </Button>
          </div>
        )}
      </form>
    </section>
  );
}

function CriterionInput({
  criterion,
  value,
  onChange,
}: {
  criterion: JudgingCriterionDto;
  value: number | undefined;
  onChange: (score: number) => void;
}) {
  const options = Array.from({ length: criterion.maxScore + 1 }, (_, index) => index);
  const name = `criterion-${criterion.id}`;
  return (
    <fieldset className="flex flex-col gap-2.5 rounded-lg border border-line bg-canvas p-4">
      <legend className="sr-only">{criterion.name}</legend>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p aria-hidden className="text-label text-ink">{criterion.name}</p>
        <p className="text-caption text-ink-muted">
          {value === undefined ? "Not scored" : `${value} / ${criterion.maxScore}`} · weight {criterion.weight}
        </p>
      </div>
      {criterion.description ? <p className="whitespace-pre-wrap text-body-ui text-ink-secondary">{criterion.description}</p> : null}
      <div className="flex flex-wrap gap-1.5">
        {options.map((score) => {
          const selected = value === score;
          return (
            <label
              key={score}
              className={cn(
                "relative inline-flex size-11 cursor-pointer items-center justify-center rounded-full border text-sm font-bold transition-colors",
                "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--yy-focus)]",
                "has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-70",
                selected ? "border-primary bg-primary text-on-primary" : "border-line-strong bg-canvas text-ink hover:bg-subtle",
              )}
            >
              <input
                type="radio"
                name={name}
                value={score}
                checked={selected}
                onChange={() => onChange(score)}
                className="sr-only"
              />
              {score}
              <span className="sr-only"> out of {criterion.maxScore}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
