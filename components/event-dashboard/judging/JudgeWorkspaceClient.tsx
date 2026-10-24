"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ChevronRight, ExternalLink, Users } from "lucide-react";
import type { JudgingStatus } from "@prisma/client";
import { loadJudgeSubmission, loadJudgeSubmissionsPage, saveJudgeReviewAction } from "@/app/actions/judging";
import { useToast } from "@/components/feedback/ToastProvider";
import { Button } from "@/components/ui/button";
import { useLoadMoreFocus } from "@/components/ui/use-load-more-focus";
import { Callout, Card, Chip, EmptyState, ProgressBar } from "@/components/ui/display";
import { Field, SearchInput, Textarea } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/cn";
import type { JudgeSubmissionDetailDto, JudgeSubmissionDto, JudgeSubmissionsPageDto, JudgingCriterionDto } from "@/lib/judgingDto";
import { JUDGING_SEARCH_MAX_LENGTH, type JudgeSubmissionCounts, type JudgeSubmissionFilter } from "@/lib/judgingPaging";
import {
  isFullyScored,
  JUDGE_FILTER_OPTIONS,
  judgeEmptyViewText,
  judgeProgressChip,
  judgeProgressFromCounts,
  judgingStatusNotice,
  linkLabel,
  noRubricNotice,
  scoreMapFrom,
  scoresToSave,
  type ScoreMap,
  type WorkspaceAudience,
} from "./judgeProgress";
import { OpenTabButton } from "../EventDashboardTabs";

const COMMENT_MAX_LENGTH = 2000;
const SEARCH_DELAY_MS = 300;

type Scope = { organisationSlug: string; eventId: string };
type ListView = { query: string; filter: JudgeSubmissionFilter };

/**
 * Client half of the judge workspace: the list of submissions with this
 * judge's progress, and a scoring view loaded on demand. All reads and
 * writes go through app/actions/judging.ts, which re-checks access.
 *
 * The list is paged on the server: the first page and the totals come with
 * the panel; filters, search and "Load more" fetch bounded pages through
 * `loadJudgeSubmissionsPage`. The list state stays here while a submission
 * is open, so "All submissions" returns to the same filter, search and pages.
 */
export function JudgeWorkspaceClient({
  organisationSlug,
  eventId,
  judgingStatus,
  criteria,
  initialPage,
  audience = "judge",
}: Scope & {
  /** Organisers (owners/admins in the Judging tab) get organiser copy and a link to the rubric editor. */
  audience?: WorkspaceAudience;
  judgingStatus: JudgingStatus;
  criteria: JudgingCriterionDto[];
  /** First page of the unfiltered list, plus totals over everything this judge may see. */
  initialPage: JudgeSubmissionsPageDto;
}) {
  const { showToast } = useToast();
  const [detail, setDetail] = useState<JudgeSubmissionDetailDto | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const request = useRef(0);

  const [filter, setFilter] = useState<JudgeSubmissionFilter>("all");
  const [query, setQuery] = useState("");
  const [submissions, setSubmissions] = useState<JudgeSubmissionDto[]>(initialPage.submissions);
  const [nextCursor, setNextCursor] = useState<string | null>(initialPage.nextCursor);
  const [counts, setCounts] = useState<JudgeSubmissionCounts>(initialPage.counts);
  const [loadingList, setLoadingList] = useState<"replace" | "more" | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const listSeq = useRef(0);
  // How many pages the current view holds, so a refresh after a save reloads
  // the same stretch instead of dropping pages added with "Load more".
  const pagesLoaded = useRef(1);

  const fetchPage = useCallback(
    async (view: ListView, cursor: string | null) => {
      const seq = ++listSeq.current;
      setLoadingList(cursor ? "more" : "replace");
      setListError(null);
      const res = await loadJudgeSubmissionsPage({ organisationSlug, eventId, query: view.query.trim(), filter: view.filter, cursor });
      if (seq !== listSeq.current) return;
      setLoadingList(null);
      if (!res.ok || !res.data) {
        setListError(res.ok ? "Could not load submissions." : res.error);
        return;
      }
      const page = res.data;
      setSubmissions((current) => (cursor ? [...current, ...page.submissions.filter((row) => !current.some((other) => other.id === row.id))] : page.submissions));
      setNextCursor(page.nextCursor);
      setCounts(page.counts);
      pagesLoaded.current = cursor ? pagesLoaded.current + 1 : 1;
    },
    [organisationSlug, eventId],
  );

  /** Re-read the first `pages` pages of a view in place (after a save). */
  const reloadPages = useCallback(
    async (view: ListView, pages: number) => {
      const seq = ++listSeq.current;
      setListError(null);
      const collected: JudgeSubmissionDto[] = [];
      let cursor: string | null = null;
      let loaded = 0;
      let latestCounts: JudgeSubmissionCounts | null = null;
      do {
        const res = await loadJudgeSubmissionsPage({ organisationSlug, eventId, query: view.query.trim(), filter: view.filter, cursor });
        if (seq !== listSeq.current) return;
        if (!res.ok || !res.data) {
          setListError(res.ok ? "Could not load submissions." : res.error);
          return;
        }
        for (const row of res.data.submissions) if (!collected.some((other) => other.id === row.id)) collected.push(row);
        cursor = res.data.nextCursor;
        latestCounts = res.data.counts;
        loaded += 1;
      } while (cursor && loaded < pages);
      setSubmissions(collected);
      setNextCursor(cursor);
      if (latestCounts) setCounts(latestCounts);
      pagesLoaded.current = loaded;
    },
    [organisationSlug, eventId],
  );

  // A filter or search fetches its first page (a search waits for typing to
  // pause; the unfiltered view uses the first page that came with the panel).
  // A refresh after a save (new `initialPage`) reloads as many pages as were
  // showing, so a reviewed project leaves "To score" straight away.
  const firstRun = useRef(true);
  const lastView = useRef<ListView>({ query, filter });
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    const unfiltered = filter === "all" && !query.trim();
    const viewChanged = lastView.current.query !== query || lastView.current.filter !== filter;
    lastView.current = { query, filter };
    if (!viewChanged && (pagesLoaded.current > 1 || !unfiltered)) {
      void reloadPages({ query, filter }, pagesLoaded.current);
      return;
    }
    const timer = window.setTimeout(() => {
      if (!unfiltered) {
        void fetchPage({ query, filter }, null);
        return;
      }
      listSeq.current += 1;
      pagesLoaded.current = 1;
      setLoadingList(null);
      setListError(null);
      setSubmissions(initialPage.submissions);
      setNextCursor(initialPage.nextCursor);
      setCounts(initialPage.counts);
    }, viewChanged && !unfiltered && query.trim() ? SEARCH_DELAY_MS : 0);
    return () => window.clearTimeout(timer);
  }, [query, filter, fetchPage, reloadPages, initialPage]);

  // Keyboard and screen-reader focus: the list button that opened a submission
  // unmounts with the list, so focus returns to it when the judge goes back,
  // or to the list heading when it has left this view (e.g. now reviewed).
  const [returnFocusId, setReturnFocusId] = useState<string | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const loadMoreFocus = useLoadMoreFocus(submissions.length);
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (detail || !returnFocusId) return;
    const button = listRef.current?.querySelector<HTMLButtonElement>(`button[data-submission-id="${CSS.escape(returnFocusId)}"]`);
    if (button) button.focus();
    else headingRef.current?.focus({ preventScroll: true });
  }, [detail, returnFocusId]);
  const notice = judgingStatusNotice(judgingStatus, audience);
  const noRubric = noRubricNotice(audience);
  const summary = judgeProgressFromCounts(counts);

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
    setReturnFocusId(detail?.submission.id ?? null);
    setDetail(null);
  }

  if (detail) {
    return (
      <ScoringView
        key={detail.submission.id}
        scope={{ organisationSlug, eventId }}
        detail={detail}
        onBack={close}
        audience={audience}
        onSaved={(next) => {
          setDetail(next);
          // Keep the loaded list in step until the refreshed page arrives.
          setSubmissions((current) => current.map((row) => (row.id === next.submission.id ? next.submission : row)));
        }}
      />
    );
  }

  return (
    <section aria-labelledby="judge-workspace-title" className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 id="judge-workspace-title" ref={headingRef} tabIndex={-1} className="text-title text-ink focus:outline-none">Score submissions</h2>
        <p className="text-body-ui text-ink-muted">
          Read each project, score it against the rubric, and submit your review. Your comments are private to the organisers.
        </p>
      </div>

      {notice ? <Callout tone={judgingStatus === "CLOSED" ? "info" : "warning"} title={notice.title}>{notice.body}</Callout> : null}
      {criteria.length === 0 ? (
        <Callout
          tone="warning"
          title={noRubric.title}
          action={
            audience === "organiser" ? (
              <OpenTabButton tab="judging" sub="judging-setup" className="inline-flex min-h-9 items-center text-sm font-semibold text-ink underline underline-offset-2 hover:text-ink-secondary">
                Edit the rubric
              </OpenTabButton>
            ) : undefined
          }
        >
          {noRubric.body}
        </Callout>
      ) : null}

      {counts.all === 0 ? (
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

          <div className="flex flex-wrap items-center gap-2.5">
            <div role="group" aria-label="Filter submissions by your progress" className="flex flex-wrap gap-1.5">
              {JUDGE_FILTER_OPTIONS.map(({ value, label }) => {
                const on = filter === value;
                return (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setFilter(value)}
                    className={cn(
                      "inline-flex min-h-[38px] items-center gap-2 rounded-full border px-3.5 text-sm font-semibold transition-colors",
                      on ? "border-primary bg-primary text-on-primary" : "border-line-strong bg-canvas text-ink hover:bg-subtle",
                    )}
                  >
                    {label}
                    <span className="opacity-75">{counts[value]}</span>
                  </button>
                );
              })}
            </div>
            <div className="w-full min-w-0 sm:ml-auto sm:w-[260px]">
              <label htmlFor="judge-submission-search" className="sr-only">Search submissions by project or entrant</label>
              <SearchInput
                id="judge-submission-search"
                placeholder="Search project or team"
                value={query}
                maxLength={JUDGING_SEARCH_MAX_LENGTH}
                onChange={(event) => setQuery(event.target.value)}
                onClear={() => setQuery("")}
                autoComplete="off"
                className="py-2 sm:text-sm"
              />
            </div>
          </div>

          {listError ? <Callout tone="danger" role="alert">{listError}</Callout> : null}

          {loadingList === "replace" ? (
            <p role="status" className="text-body-ui text-ink-muted">Loading submissions…</p>
          ) : submissions.length === 0 ? (
            <EmptyState>{judgeEmptyViewText(filter, query)}</EmptyState>
          ) : (
            <ul ref={listRef} id={loadMoreFocus.listId} aria-label="Submissions" aria-busy={loadingList != null} className="flex flex-col gap-2.5">
              {submissions.map((submission) => {
                const chip = judgeProgressChip(submission, criteria.length);
                const busy = openingId === submission.id;
                return (
                  <li key={submission.id}>
                    <button
                      type="button"
                      data-submission-id={submission.id}
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
          )}

          {nextCursor && loadingList !== "replace" ? (
            <div className="flex justify-center">
              <Button variant="secondary" loading={loadingList === "more"} loadingLabel="Loading…" onClick={() => {
                loadMoreFocus.beforeLoadMore();
                void fetchPage({ query, filter }, nextCursor);
              }}>
                Load more submissions
              </Button>
            </div>
          ) : null}
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
  audience,
}: {
  scope: Scope;
  detail: JudgeSubmissionDetailDto;
  onBack: () => void;
  audience: WorkspaceAudience;
  onSaved: (next: JudgeSubmissionDetailDto) => void;
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  const [saving, setSaving] = useState<"draft" | "submit" | null>(null);
  const [scores, setScores] = useState<ScoreMap>(() => scoreMapFrom(detail.myScores, detail.criteria));
  const [comment, setComment] = useState(detail.myReview?.comment ?? "");
  const [error, setError] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  // The list button that opened this view is gone: move focus to the project's heading.
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, []);
  const { submission, criteria, judgingStatus } = detail;
  const readOnly = judgingStatus !== "OPEN";
  const notice = judgingStatusNotice(judgingStatus, audience);
  const noRubric = noRubricNotice(audience);
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
          <h2 id="judge-submission-title" ref={headingRef} tabIndex={-1} className="text-h3 break-words text-ink focus:outline-none">{submission.title}</h2>
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
            <p className="text-body-ui text-ink-muted">{noRubric.body}</p>
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
