"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Ban, Download, ExternalLink, Eye, MessageSquareText, MoreHorizontal, RotateCcw, UserCheck } from "lucide-react";
import type { SubmissionStatus } from "@prisma/client";
import {
  assignProjectJudge,
  disqualifyProject,
  loadProjectReviews,
  loadSubmissionsPage,
  reinstateProject,
  unassignProjectJudge,
  type SubmissionReviewView,
} from "@/app/actions/judging-admin";
import { useToast } from "@/components/feedback/ToastProvider";
import { Button, IconButton } from "@/components/ui/button";
import { useLoadMoreFocus } from "@/components/ui/use-load-more-focus";
import { CheckboxField, FilterChip } from "@/components/ui/choice";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Callout, Chip, EmptyState } from "@/components/ui/display";
import { ConfirmationDialog } from "@/components/feedback/ConfirmationDialog";
import { Field, Input, SearchInput } from "@/components/ui/field";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { Spinner } from "@/components/ui/spinner";
import { formatDayTime } from "@/lib/format/datetime";
import { showingLabel } from "@/lib/keysetCursor";
import type { SubmissionViewFilter } from "@/lib/judgingOrganiserPaging";
import { NO_SAVED_VIEWS, viewParam, type SavedViewDto, type ViewParams } from "@/lib/savedViews";
import { SavedViewsMenu } from "@/components/event-dashboard/views/SavedViewsMenu";
import { useInitialViewParams, useSyncViewToUrl } from "@/components/event-dashboard/views/useViewUrl";
import { JudgingUnsubmittedList } from "./JudgingUnsubmittedList";
import { judgingSubmissionsExportHref } from "@/lib/judgingExport";
import type {
  JudgingDashboardAward,
  JudgingDashboardCriterion,
  JudgingDashboardJudge,
  JudgingDashboardSubmission,
  JudgingDashboardSubmissionsPage,
} from "@/lib/eventDashboard/judging";
import { awardsHeldBy, disqualifyImpact, reinstateImpact } from "./judgingCopy";
import {
  SUBMISSION_STATUS_LABELS,
  SUBMISSION_STATUS_TONES,
  fieldError,
  useJudgingAction,
  type JudgingLimits,
  type JudgingScope,
} from "./JudgingPanelShared";

type Filter = SubmissionViewFilter;
type View = { query: string; status: Filter };

const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: "all", label: "All" },
  { value: "SUBMITTED", label: "Submitted" },
  { value: "DRAFT", label: "Drafts" },
  { value: "WITHDRAWN", label: "Withdrawn" },
  { value: "DISQUALIFIED", label: "Disqualified" },
  { value: "notSubmitted", label: "Not submitted" },
];

const SEARCH_DELAY_MS = 300;

/**
 * Judging → Submissions: every project with its status, organiser-only
 * disqualification reason, judge assignments, and the judges' reviews. Entrant
 * emails and ticket links never reach this view.
 *
 * The list is paged on the server, oldest first, like Guests → Teams: the
 * first page comes with the panel, and status filters, searches and "Load
 * more" fetch bounded pages through `loadSubmissionsPage`. The chip counts
 * are per-status totals for the whole event.
 */
export function JudgingPanelSubmissions({
  scope,
  initialPage,
  counts,
  total,
  judges,
  criteria,
  judgesSeeAll,
  timezone,
  awards,
  resultsPublished,
  limits,
  unsubmittedCount = 0,
  savedViews = NO_SAVED_VIEWS,
}: {
  scope: JudgingScope;
  initialPage: JudgingDashboardSubmissionsPage;
  counts: Record<SubmissionStatus, number>;
  /** Every project of the event, whatever its status. */
  total: number;
  judges: JudgingDashboardJudge[];
  criteria: JudgingDashboardCriterion[];
  judgesSeeAll: boolean;
  timezone: string;
  /** Award winners, to say which awards a disqualification takes away. */
  awards: JudgingDashboardAward[];
  /** Once results are published, disqualifying changes the live results page. */
  resultsPublished: boolean;
  limits: JudgingLimits;
  /** Confirmed teams and solo registrants without a SUBMITTED project (the "Not submitted" view). */
  unsubmittedCount?: number;
  /** Saved views for this list (the viewer's own and shared ones). */
  savedViews?: readonly SavedViewDto[];
}) {
  const { run, busy } = useJudgingAction();
  // Filters live in the address bar (saved views): a link reopens the same view.
  const fromUrl = useInitialViewParams("JUDGING_SUBMISSIONS");
  const [filter, setFilter] = useState<Filter>(viewParam(fromUrl, "status") as Filter);
  const [query, setQuery] = useState(viewParam(fromUrl, "q"));
  const [searchedQuery, setSearchedQuery] = useState(query.trim());
  useEffect(() => {
    const timer = window.setTimeout(() => setSearchedQuery(query.trim()), SEARCH_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [query]);
  const viewParams: ViewParams = {};
  if (filter !== "all") viewParams.status = filter;
  if (searchedQuery) viewParams.q = searchedQuery;
  useSyncViewToUrl("JUDGING_SUBMISSIONS", viewParams);
  const applyView = useCallback((params: ViewParams) => {
    setFilter(viewParam(params, "status") as Filter);
    setQuery(viewParam(params, "q"));
  }, []);
  const [viewing, setViewing] = useState<JudgingDashboardSubmission | null>(null);
  const [assigningId, setAssigningId] = useState<string | null>(null);
  const [disqualifying, setDisqualifying] = useState<JudgingDashboardSubmission | null>(null);
  const [reinstating, setReinstating] = useState<JudgingDashboardSubmission | null>(null);
  const [reviewing, setReviewing] = useState<JudgingDashboardSubmission | null>(null);
  const [reviews, setReviews] = useState<{ id: string; rows: SubmissionReviewView[] } | null>(null);
  const [, startLoading] = useTransition();
  const { showToast } = useToast();

  const [submissions, setSubmissions] = useState<JudgingDashboardSubmission[]>(initialPage.submissions);
  const loadMoreFocus = useLoadMoreFocus(submissions.length);
  const [nextCursor, setNextCursor] = useState<string | null>(initialPage.nextCursor);
  // A view opened from the address bar isn't the server-rendered first page: it loads on mount.
  const [loadingList, setLoadingList] = useState<"replace" | "more" | null>(filter === "all" && !query.trim() ? null : "replace");
  const [listError, setListError] = useState<string | null>(null);
  const requestSeq = useRef(0);
  const { organisationSlug, eventId } = scope;
  // How many pages the current view holds, so a refresh after a change
  // reloads the same stretch instead of dropping pages added with "Load more".
  const pagesLoaded = useRef(1);

  const fetchPage = useCallback(
    async (view: View, cursor: string | null) => {
      const seq = ++requestSeq.current;
      setLoadingList(cursor ? "more" : "replace");
      setListError(null);
      const res = await loadSubmissionsPage({ organisationSlug, eventId, query: view.query.trim(), status: view.status, cursor });
      if (seq !== requestSeq.current) return;
      setLoadingList(null);
      if (!res.ok || !res.data) {
        setListError(res.ok ? "Could not load projects." : res.error);
        return;
      }
      const page = res.data;
      setSubmissions((current) => (cursor ? [...current, ...page.submissions.filter((row) => !current.some((other) => other.id === row.id))] : page.submissions));
      setNextCursor(page.nextCursor);
      pagesLoaded.current = cursor ? pagesLoaded.current + 1 : 1;
    },
    [organisationSlug, eventId],
  );

  /** Re-read the first `pages` pages of a view in place (after a change). */
  const reloadPages = useCallback(
    async (view: View, pages: number) => {
      const seq = ++requestSeq.current;
      setListError(null);
      const collected: JudgingDashboardSubmission[] = [];
      let cursor: string | null = null;
      let loaded = 0;
      do {
        const res = await loadSubmissionsPage({ organisationSlug, eventId, query: view.query.trim(), status: view.status, cursor });
        if (seq !== requestSeq.current) return;
        if (!res.ok || !res.data) {
          setListError(res.ok ? "Could not load projects." : res.error);
          return;
        }
        for (const row of res.data.submissions) if (!collected.some((other) => other.id === row.id)) collected.push(row);
        cursor = res.data.nextCursor;
        loaded += 1;
      } while (cursor && loaded < pages);
      setSubmissions(collected);
      setNextCursor(cursor);
      pagesLoaded.current = loaded;
    },
    [organisationSlug, eventId],
  );

  // A filter or a search fetches its first page (a search waits for typing to
  // pause; the unfiltered view uses the first page that came with the panel).
  // A refresh after a change (new `initialPage`) reloads the pages showing.
  const firstRun = useRef(true);
  const lastView = useRef<View>({ query, status: filter });
  useEffect(() => {
    // "Not submitted" lists entrants, not projects (JudgingUnsubmittedList loads its own pages).
    if (filter === "notSubmitted") {
      firstRun.current = false;
      lastView.current = { query, status: filter };
      return;
    }
    if (firstRun.current) {
      firstRun.current = false;
      if (filter === "all" && !query.trim()) return;
      const timer = window.setTimeout(() => void fetchPage({ query, status: filter }, null), 0);
      return () => window.clearTimeout(timer);
    }
    const view: View = { query, status: filter };
    const unfiltered = filter === "all" && !query.trim();
    const viewChanged = lastView.current.query !== query || lastView.current.status !== filter;
    lastView.current = view;
    if (!viewChanged && pagesLoaded.current > 1) {
      void reloadPages(view, pagesLoaded.current);
      return;
    }
    const timer = window.setTimeout(() => {
      if (!unfiltered) {
        void fetchPage(view, null);
        return;
      }
      requestSeq.current += 1;
      pagesLoaded.current = 1;
      setLoadingList(null);
      setListError(null);
      setSubmissions(initialPage.submissions);
      setNextCursor(initialPage.nextCursor);
    }, viewChanged && !unfiltered && query.trim() ? SEARCH_DELAY_MS : 0);
    return () => window.clearTimeout(timer);
  }, [query, filter, fetchPage, reloadPages, initialPage]);

  function openReviews(submission: JudgingDashboardSubmission) {
    setReviewing(submission);
    setReviews(null);
    startLoading(async () => {
      const result = await loadProjectReviews({ ...scope, submissionId: submission.id });
      if (!result.ok) {
        showToast(result.error, "error");
        setReviewing(null);
        return;
      }
      setReviews({ id: submission.id, rows: result.data ?? [] });
    });
  }

  const judgeNames = useMemo(() => new Map(judges.map((judge) => [judge.userId, judge.name])), [judges]);
  const chipCounts: Record<Filter, number> = { all: total, ...counts, notSubmitted: unsubmittedCount };
  // Re-read from the loaded rows so the assignment dialog shows current state.
  const assigning = assigningId ? submissions.find((submission) => submission.id === assigningId) ?? null : null;

  if (total === 0 && unsubmittedCount === 0) {
    return <EmptyState title="No projects yet">Projects appear here once confirmed entrants start a submission.</EmptyState>;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by status">
          {FILTERS.map((item) => (
            <FilterChip key={item.value} selected={filter === item.value} onClick={() => setFilter(item.value)}>
              {item.label} <span className="font-medium opacity-80">{chipCounts[item.value]}</span>
            </FilterChip>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
          <div className="w-full sm:w-[260px]">
            <SearchInput placeholder="Search projects" aria-label="Search projects" value={query} onChange={(event) => setQuery(event.target.value)} onClear={() => setQuery("")} />
          </div>
          <SavedViewsMenu surface="JUDGING_SUBMISSIONS" scope={scope} params={viewParams} onApply={applyView} initialViews={savedViews} />
          {chipCounts[filter] > 0 ? (
            <Button asChild variant="secondary" startIcon={<Download />}>
              <a
                href={judgingSubmissionsExportHref(`/api/exports/events/${eventId}/judging`, { query, status: filter })}
                title={filter === "notSubmitted" ? "Export every entrant without a submitted project matching this search" : "Export every project matching this filter and search"}
              >
                Export CSV
              </a>
            </Button>
          ) : (
            <Button variant="secondary" startIcon={<Download />} disabled title={filter === "notSubmitted" ? "No entrants match this filter" : "No projects match this filter"}>
              Export CSV
            </Button>
          )}
        </div>
      </div>
      {judgesSeeAll ? null : (
        <Callout tone="info">Judges only see the projects assigned to them. Use Assign judges on each submitted project.</Callout>
      )}
      {listError ? (
        <Callout tone="danger" role="alert">
          {listError}
        </Callout>
      ) : null}
      {filter === "notSubmitted" ? (
        <JudgingUnsubmittedList scope={scope} query={query} total={unsubmittedCount} timezone={timezone} />
      ) : loadingList === "replace" ? (
        <div className="flex justify-center py-6">
          <Spinner className="size-5" />
          <span className="sr-only">Loading projects</span>
        </div>
      ) : submissions.length === 0 ? (
        <EmptyState title="No matching projects">Try another filter or search.</EmptyState>
      ) : (
        <ul id={loadMoreFocus.listId} aria-label="Projects" aria-busy={loadingList != null} className="flex flex-col divide-y divide-line rounded-lg border border-line bg-canvas">
          {submissions.map((submission) => (
            <li key={submission.id} className="flex flex-col gap-2 px-4 py-3.5 sm:flex-row sm:items-start sm:gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-label text-ink">{submission.title}</p>
                  <Chip size="sm" tone={SUBMISSION_STATUS_TONES[submission.status]}>
                    {SUBMISSION_STATUS_LABELS[submission.status]}
                  </Chip>
                </div>
                <p className="text-caption text-ink-muted">
                  {submission.isTeam ? "Team" : "Solo"} · {submission.entrantName}
                  {submission.submittedAt ? ` · submitted ${formatDayTime(submission.submittedAt, timezone)}` : ` · updated ${formatDayTime(submission.updatedAt, timezone)}`}
                </p>
                {submission.status === "DISQUALIFIED" && submission.disqualifiedReason ? (
                  <p className="mt-1 text-caption text-danger-fg">Reason (only organisers see this): {submission.disqualifiedReason}</p>
                ) : null}
                {!judgesSeeAll && submission.status === "SUBMITTED" ? (
                  <p className="mt-1 text-caption text-ink-muted">
                    Judges:{" "}
                    {submission.assignedJudgeIds.length === 0
                      ? "none assigned"
                      : submission.assignedJudgeIds.map((id) => judgeNames.get(id) ?? "Former judge").join(", ")}
                  </p>
                ) : null}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Menu>
                  <MenuTrigger asChild>
                    <IconButton label={`Actions for ${submission.title}`} size="sm" disabled={busy === submission.id}>
                      <MoreHorizontal />
                    </IconButton>
                  </MenuTrigger>
                  <MenuContent align="end">
                    <MenuItem icon={<Eye />} onSelect={() => setViewing(submission)}>
                      View project
                    </MenuItem>
                    {submission.status === "SUBMITTED" || submission.status === "DISQUALIFIED" ? (
                      <MenuItem icon={<MessageSquareText />} onSelect={() => openReviews(submission)}>
                        Judges&apos; reviews
                      </MenuItem>
                    ) : null}
                    {submission.status === "SUBMITTED" ? (
                      <MenuItem icon={<UserCheck />} onSelect={() => setAssigningId(submission.id)}>
                        Assign judges
                      </MenuItem>
                    ) : null}
                    {submission.status === "SUBMITTED" ? (
                      <>
                        <MenuSeparator />
                        <MenuItem danger icon={<Ban />} onSelect={() => setDisqualifying(submission)}>
                          Disqualify…
                        </MenuItem>
                      </>
                    ) : null}
                    {submission.status === "DISQUALIFIED" ? (
                      <MenuItem icon={<RotateCcw />} onSelect={() => setReinstating(submission)}>
                        Reinstate…
                      </MenuItem>
                    ) : null}
                  </MenuContent>
                </Menu>
              </div>
            </li>
          ))}
        </ul>
      )}
      {filter !== "notSubmitted" && loadingList !== "replace" && submissions.length > 0 && !query.trim() ? (
        <p className="text-center text-caption text-ink-muted" aria-live="polite">
          {showingLabel(submissions.length, chipCounts[filter], "projects")}
        </p>
      ) : null}
      {filter !== "notSubmitted" && nextCursor && loadingList !== "replace" ? (
        <div className="flex justify-center">
          <Button variant="secondary" loading={loadingList === "more"} loadingLabel="Loading…" onClick={() => {
            loadMoreFocus.beforeLoadMore();
            void fetchPage({ query, status: filter }, nextCursor);
          }}>
            Load more projects
          </Button>
        </div>
      ) : null}

      <ProjectDialog submission={viewing} onClose={() => setViewing(null)} />
      <AssignDialog scope={scope} submission={assigning} judges={judges} onClose={() => setAssigningId(null)} />
      <DisqualifyDialog
        scope={scope}
        submission={disqualifying}
        awardsHeld={disqualifying ? awardsHeldBy(awards, disqualifying.id) : []}
        resultsPublished={resultsPublished}
        maxLength={limits.disqualifyReason}
        onClose={() => setDisqualifying(null)}
      />
      <ConfirmationDialog
        open={reinstating !== null}
        title="Reinstate this project?"
        message={reinstating ? reinstateImpact({ title: reinstating.title, resultsPublished }) : ""}
        confirmLabel="Reinstate"
        destructive={false}
        loading={reinstating !== null && busy === reinstating.id}
        onConfirm={() => {
          if (!reinstating) return;
          run(reinstating.id, () => reinstateProject({ ...scope, submissionId: reinstating.id }), "Project reinstated.", () => setReinstating(null));
        }}
        onCancel={() => setReinstating(null)}
      />
      <ReviewsDialog
        submission={reviewing}
        reviews={reviewing && reviews?.id === reviewing.id ? reviews.rows : null}
        criteria={criteria}
        timezone={timezone}
        onClose={() => setReviewing(null)}
      />
    </div>
  );
}

/** A project link: validated https on write, opened without a referrer. */
export function ProjectLink({ href, children }: { href: string; children: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer nofollow ugc" className="inline-flex items-center gap-1 text-body-ui font-semibold text-ink underline underline-offset-2 hover:text-ink-secondary">
      {children}
      <ExternalLink aria-hidden className="size-3.5" />
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}

function ProjectDialog({ submission, onClose }: { submission: JudgingDashboardSubmission | null; onClose: () => void }) {
  return (
    <Dialog open={submission !== null} onOpenChange={(next) => (!next ? onClose() : undefined)}>
      <DialogContent size="md">
        <DialogHeader title={submission?.title ?? ""} description={submission ? `${submission.isTeam ? "Team" : "Solo"} · ${submission.entrantName}` : undefined} />
        <DialogBody className="flex flex-col gap-4">
          {submission?.summary ? <p className="whitespace-pre-line text-body-ui text-ink-secondary">{submission.summary}</p> : <p className="text-body-ui text-ink-muted">No summary.</p>}
          {submission && (submission.repoUrl || submission.demoUrl || submission.videoUrl) ? (
            <div className="flex flex-wrap gap-4">
              {submission.repoUrl ? <ProjectLink href={submission.repoUrl}>Code</ProjectLink> : null}
              {submission.demoUrl ? <ProjectLink href={submission.demoUrl}>Demo</ProjectLink> : null}
              {submission.videoUrl ? <ProjectLink href={submission.videoUrl}>Video</ProjectLink> : null}
            </div>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AssignDialog({
  scope,
  submission,
  judges,
  onClose,
}: {
  scope: JudgingScope;
  submission: JudgingDashboardSubmission | null;
  judges: JudgingDashboardJudge[];
  onClose: () => void;
}) {
  const { run, busy } = useJudgingAction();
  const assigned = new Set(submission?.assignedJudgeIds ?? []);
  return (
    <Dialog open={submission !== null} onOpenChange={(next) => (!next ? onClose() : undefined)}>
      <DialogContent size="sm">
        <DialogHeader title="Assign judges" description={submission ? `Who judges "${submission.title}". Judges registered on this entry can't be assigned.` : undefined} />
        <DialogBody className="flex flex-col gap-3">
          {judges.length === 0 ? (
            <p className="text-body-ui text-ink-muted">No judges yet. Invite collaborators with the Judge permission in Settings.</p>
          ) : (
            judges.map((judge) => (
              <CheckboxField
                key={judge.userId}
                label={judge.name}
                description={judge.kind === "admin" ? "Organiser" : judge.email ?? "Judge"}
                checked={assigned.has(judge.userId)}
                disabled={busy !== null || !submission}
                onCheckedChange={(checked) => {
                  if (!submission) return;
                  const input = { ...scope, judgeUserId: judge.userId, submissionId: submission.id };
                  run(judge.userId, () => (checked === true ? assignProjectJudge(input) : unassignProjectJudge(input)), null);
                }}
              />
            ))
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DisqualifyDialog({
  scope,
  submission,
  awardsHeld,
  resultsPublished,
  maxLength,
  onClose,
}: {
  scope: JudgingScope;
  submission: JudgingDashboardSubmission | null;
  awardsHeld: string[];
  resultsPublished: boolean;
  maxLength: number;
  onClose: () => void;
}) {
  const { run, busy } = useJudgingAction();
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Record<string, string[]> | undefined>();
  const close = () => {
    setReason("");
    setErrors(undefined);
    onClose();
  };
  return (
    <Dialog open={submission !== null} onOpenChange={(next) => (!next && busy === null ? close() : undefined)}>
      <DialogContent role="alertdialog" size="sm">
        <DialogHeader
          title="Disqualify this project?"
          description={submission ? disqualifyImpact({ title: submission.title, awardsHeld, resultsPublished }) : undefined}
        />
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!submission) return;
            run("disqualify", () => disqualifyProject({ ...scope, submissionId: submission.id, reason }), "Project disqualified.", (result) => {
              if (result.ok) close();
              else setErrors(result.fieldErrors);
            });
          }}
        >
          <DialogBody className="flex flex-col gap-4">
            {resultsPublished && awardsHeld.length > 0 ? (
              <Callout tone="warning" title="The live results page will change">
                <ul className="list-disc pl-5">
                  {awardsHeld.map((award) => (
                    <li key={award}>{award}</li>
                  ))}
                </ul>
              </Callout>
            ) : null}
            <Field label="Reason" helperText="Only organisers see this. The entrant isn't told the reason." error={fieldError(errors, "reason")}>
              <Input value={reason} maxLength={maxLength} required onChange={(event) => setReason(event.target.value)} />
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button variant="secondary" disabled={busy !== null} onClick={close}>
              Cancel
            </Button>
            <Button type="submit" variant="danger" loading={busy === "disqualify"} loadingLabel="Disqualifying…">
              Disqualify
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ReviewsDialog({
  submission,
  reviews,
  criteria,
  timezone,
  onClose,
}: {
  submission: JudgingDashboardSubmission | null;
  reviews: SubmissionReviewView[] | null;
  criteria: JudgingDashboardCriterion[];
  timezone: string;
  onClose: () => void;
}) {
  const criterionNames = new Map(criteria.map((criterion) => [criterion.id, criterion]));

  return (
    <Dialog open={submission !== null} onOpenChange={(next) => (!next ? onClose() : undefined)}>
      <DialogContent size="md">
        <DialogHeader title="Judges' reviews" description={submission ? `"${submission.title}". Comments are private to organisers.` : undefined} />
        <DialogBody className="flex flex-col gap-4">
          {!reviews ? (
            <div className="flex justify-center py-6">
              <Spinner className="size-5" />
              <span className="sr-only">Loading reviews</span>
            </div>
          ) : reviews.length === 0 ? (
            <p className="text-body-ui text-ink-muted">No judge has reviewed this project yet.</p>
          ) : (
            reviews.map((review, index) => (
              <section key={index} className="flex flex-col gap-2 rounded-lg border border-line p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-label text-ink">{review.judgeName}</p>
                  <Chip size="sm" tone={review.submittedAt ? "success" : "warning"}>
                    {review.submittedAt ? `Submitted ${formatDayTime(review.submittedAt, timezone)}` : "In progress"}
                  </Chip>
                </div>
                {review.scores.length > 0 ? (
                  <ul className="flex flex-wrap gap-x-4 gap-y-1 text-caption text-ink-secondary">
                    {review.scores.map((score) => {
                      const criterion = criterionNames.get(score.criterionId);
                      return (
                        <li key={score.criterionId}>
                          {criterion?.name ?? "Criterion"}: <span className="font-semibold text-ink">{score.score}</span>
                          {criterion ? ` / ${criterion.maxScore}` : ""}
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
                {review.comment ? <p className="whitespace-pre-line text-body-ui text-ink-secondary">{review.comment}</p> : null}
              </section>
            ))
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
