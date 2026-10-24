"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Shuffle } from "lucide-react";
import { loadJudgingProgressPage, saveReviewsPerProject } from "@/app/actions/judging-ops";
import { Button } from "@/components/ui/button";
import { Callout, Card, CardHeader, Chip, EmptyState, ProgressBar, StatTile } from "@/components/ui/display";
import { Field, Input } from "@/components/ui/field";
import { FilterChip } from "@/components/ui/choice";
import { PageNumberPager } from "@/components/ui/page-number-pager";
import { Spinner } from "@/components/ui/spinner";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { formatRelativeTime } from "@/lib/format/datetime";
import { numberedPageLabel, type NumberedPage } from "@/lib/judgingOrganiserPaging";
import { DEFAULT_REVIEWS_PER_PROJECT, REVIEWS_PER_PROJECT_MAX, REVIEWS_PER_PROJECT_MIN, STALE_REVIEW_HOURS, type JudgingProgressSection } from "@/lib/judgingProgress";
import type {
  JudgingProgressDto,
  ProgressBelowTargetRow,
  ProgressJudgeRow,
  ProgressOutlierRow,
  ProgressStaleRow,
} from "@/lib/core/judgingOps";
import type { EligibleJudgeDto } from "@/lib/core/judging";
import { NO_SAVED_VIEWS, viewParam, type SavedViewDto, type ViewParams } from "@/lib/savedViews";
import { SavedViewsMenu } from "@/components/event-dashboard/views/SavedViewsMenu";
import { useInitialViewParams, useSyncViewToUrl } from "@/components/event-dashboard/views/useViewUrl";
import { AutoAssignDialog } from "./JudgingAutoAssignDialog";
import { formatScore, useJudgingAction, type JudgingScope } from "./JudgingPanelShared";
import { progressTargetLine, signedPoints } from "./judgingOpsCopy";

type ProgressShow = "all" | JudgingProgressSection;

const PROGRESS_SHOW: Array<{ value: ProgressShow; label: string }> = [
  { value: "all", label: "All lists" },
  { value: "below-target", label: "Below target" },
  { value: "judges", label: "Judges" },
  { value: "outliers", label: "Outliers" },
  { value: "stale", label: "Stale" },
];

/**
 * Judging → Progress (docs/HACKATHON.md): who still needs reviews, how far
 * each judge has got, scores far from the other judges', and reviews left
 * half-done. Every list is computed on the server over the whole event and
 * shown as numbered pages (`loadJudgingProgressPage`, re-checked as an
 * organiser on every call). Also home to the review target and automatic
 * assignment.
 */
export function JudgingPanelProgress({
  scope,
  initial,
  judges,
  timezone,
  now,
  savedViews = NO_SAVED_VIEWS,
}: {
  scope: JudgingScope;
  initial: JudgingProgressDto;
  judges: EligibleJudgeDto[];
  timezone: string;
  now: string;
  /** Saved views for this page (the viewer's own and shared ones). */
  savedViews?: readonly SavedViewDto[];
}) {
  const { summary } = initial;
  // Which lists show lives in the address bar (saved views): a link reopens the same view.
  const fromUrl = useInitialViewParams("JUDGING_PROGRESS");
  const [show, setShow] = useState<ProgressShow>(viewParam(fromUrl, "show") as ProgressShow);
  const viewParams: ViewParams = show === "all" ? {} : { show };
  useSyncViewToUrl("JUDGING_PROGRESS", viewParams);
  const applyView = useCallback((params: ViewParams) => setShow(viewParam(params, "show") as ProgressShow), []);
  const visible = (section: JudgingProgressSection) => show === "all" || show === section;
  const sectionCounts: Record<ProgressShow, number | null> = {
    all: null,
    "below-target": initial.belowTarget.total,
    judges: initial.judges.total,
    outliers: initial.outliers.total,
    stale: initial.stale.total,
  };
  const [assignOpen, setAssignOpen] = useState(false);
  const canAssign = summary.judgingStatus !== "CLOSED";
  return (
    <div className="flex flex-col gap-5">
      <Card as="section">
        <CardHeader
          title="Judging progress"
          description={progressTargetLine(summary.target, summary.targetIsDefault)}
          action={
            <Button variant="secondary" size="sm" onClick={() => setAssignOpen(true)} disabled={!canAssign || summary.projects === 0}>
              <Shuffle aria-hidden className="size-4" />
              Assign judges automatically
            </Button>
          }
        />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            label="Projects at target"
            value={`${summary.projectsAtTarget} / ${summary.projects}`}
            hint={`${summary.target} reviews each`}
            progress={{ value: summary.projectsAtTarget, max: Math.max(summary.projects, 1), tone: "success" }}
          />
          <StatTile label="Review coverage" value={`${summary.coverage}%`} hint={`${summary.reviewsCounted} reviews submitted`} />
          <StatTile label="Outlier scores" value={initial.outliers.total} tone={initial.outliers.total > 0 ? "attention" : "default"} hint="Far from the other judges" />
          <StatTile label="Stale reviews" value={initial.stale.total} tone={initial.stale.total > 0 ? "attention" : "default"} hint={`Unsubmitted for over ${STALE_REVIEW_HOURS} hours`} />
        </div>
        {/* Keyed on the saved value so a refresh after a change (here or by automatic assignment) resets the field. */}
        <TargetForm key={summary.reviewsPerProject ?? "default"} scope={scope} reviewsPerProject={summary.reviewsPerProject} />
        {!canAssign ? <p className="mt-3 text-caption text-ink-muted">Judging is closed, so assignments can&apos;t change.</p> : null}
      </Card>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Show lists">
          {PROGRESS_SHOW.map((item) => (
            <FilterChip key={item.value} selected={show === item.value} onClick={() => setShow(item.value)}>
              {item.label}
              {sectionCounts[item.value] != null ? <span className="font-medium opacity-80"> {sectionCounts[item.value]}</span> : null}
            </FilterChip>
          ))}
        </div>
        <SavedViewsMenu surface="JUDGING_PROGRESS" scope={scope} params={viewParams} onApply={applyView} initialViews={savedViews} />
      </div>

      {visible("below-target") ? (
        <ProgressSection<ProgressBelowTargetRow>
          scope={scope}
          section="below-target"
          initial={initial.belowTarget}
          title="Projects below target"
          description={`Submitted projects with fewer than ${summary.target} submitted reviews, fewest first.`}
          noun="projects"
          empty={summary.projects === 0 ? "No submitted projects yet." : `Every project has at least ${summary.target} submitted reviews.`}
          head={
            <tr>
              <TH>Project</TH>
              <TH className="text-right">Reviews</TH>
              <TH className="text-right">In progress</TH>
              <TH className="text-right">Assigned</TH>
              <TH className="text-right">Missing</TH>
            </tr>
          }
          renderRow={(row) => (
            <TR key={row.submissionId}>
              <TD>
                <span className="block font-semibold">{row.title}</span>
                <span className="block text-caption text-ink-muted">{row.entrantName}</span>
              </TD>
              <TD className="text-right tabular-nums">{row.reviews}</TD>
              <TD className="text-right tabular-nums">{row.inProgress}</TD>
              <TD className="text-right tabular-nums">{summary.judgesSeeAll ? <span className="text-ink-muted">All judges</span> : row.assigned}</TD>
              <TD className="text-right tabular-nums font-semibold">{row.missing}</TD>
            </TR>
          )}
        />
      ) : null}

      {visible("judges") ? (
        <ProgressSection<ProgressJudgeRow>
          scope={scope}
          section="judges"
          initial={initial.judges}
          title="Judges"
          description={
            summary.judgesSeeAll
              ? "Judges see every project, so each is expected to review all of them (less any they're registered on). Lowest completion first."
              : "Each judge's assigned projects, how many they've started, and how many reviews they've submitted. Lowest completion first."
          }
          noun="judges"
          empty="No judges yet. Invite judges from Settings, or organisers can judge from the Score tab."
          head={
            <tr>
              <TH>Judge</TH>
              <TH className="text-right">{summary.judgesSeeAll ? "Projects" : "Assigned"}</TH>
              <TH className="text-right">Started</TH>
              <TH className="text-right">Submitted</TH>
              <TH className="min-w-[160px]">Completion</TH>
            </tr>
          }
          renderRow={(row) => (
            <TR key={row.userId}>
              <TD>
                <span className="block font-semibold">{row.name}</span>
                <span className="block text-caption text-ink-muted">
                  {row.kind === "admin" ? "Organiser" : "Judge"}
                  {row.email ? ` · ${row.email}` : ""}
                </span>
              </TD>
              <TD className="text-right tabular-nums">{row.assigned}</TD>
              <TD className="text-right tabular-nums">{row.started}</TD>
              <TD className="text-right tabular-nums">{row.submitted}</TD>
              <TD>
                <div className="flex items-center gap-3">
                  <ProgressBar value={row.completion} max={100} tone="success" className="w-24" label={`${row.name}: ${row.completion}% complete`} />
                  <span className="text-caption tabular-nums text-ink-secondary">{row.completion}%</span>
                </div>
              </TD>
            </TR>
          )}
        />
      ) : null}

      {visible("outliers") ? (
        <ProgressSection<ProgressOutlierRow>
          scope={scope}
          section="outliers"
          initial={initial.outliers}
          title="Outlier scores"
          description="A judge's score for a project more than two standard deviations from the other judges' average, or, with only two judges, more than 25 points apart. Worth a second look; nothing is changed."
          noun="scores"
          empty="No judge's score stands out from the others."
          head={
            <tr>
              <TH>Project</TH>
              <TH>Judge</TH>
              <TH className="text-right">Score</TH>
              <TH className="text-right">Others&apos; average</TH>
              <TH className="text-right">Difference</TH>
            </tr>
          }
          renderRow={(row) => (
            <TR key={`${row.submissionId}:${row.judgeUserId}`}>
              <TD>
                <span className="block font-semibold">{row.title}</span>
                <span className="block text-caption text-ink-muted">{row.judges} judges</span>
              </TD>
              <TD>{row.judgeName}</TD>
              <TD className="text-right tabular-nums">{formatScore(row.score)}</TD>
              <TD className="text-right tabular-nums">{formatScore(row.othersMean)}</TD>
              <TD className="text-right">
                <Chip size="sm" tone={row.difference < 0 ? "warning" : "neutral"}>
                  {signedPoints(row.difference)}
                  <span className="sr-only">{row.difference < 0 ? " (harsher)" : " (more generous)"}</span>
                </Chip>
              </TD>
            </TR>
          )}
        />
      ) : null}

      {visible("stale") ? (
        <ProgressSection<ProgressStaleRow>
          scope={scope}
          section="stale"
          initial={initial.stale}
          title="Stale reviews"
          description={`Scores saved but the review not submitted, with no change for over ${STALE_REVIEW_HOURS} hours. Unsubmitted reviews don't count towards the results.`}
          noun="reviews"
          empty="No half-finished reviews waiting."
          head={
            <tr>
              <TH>Project</TH>
              <TH>Judge</TH>
              <TH className="text-right">Scored</TH>
              <TH>Last saved</TH>
            </tr>
          }
          renderRow={(row) => (
            <TR key={`${row.submissionId}:${row.judgeUserId}`}>
              <TD className="font-semibold">{row.title}</TD>
              <TD>{row.judgeName}</TD>
              <TD className="text-right tabular-nums">
                {row.scored} / {row.criteria}
              </TD>
              <TD className="whitespace-nowrap">{formatRelativeTime(row.lastSavedAt, timezone, now)}</TD>
            </TR>
          )}
        />
      ) : null}

      <AutoAssignDialog
        open={assignOpen}
        onOpenChange={setAssignOpen}
        scope={scope}
        judges={judges}
        defaultPerProject={summary.reviewsPerProject ?? DEFAULT_REVIEWS_PER_PROJECT}
      />
    </div>
  );
}

function TargetForm({ scope, reviewsPerProject }: { scope: JudgingScope; reviewsPerProject: number | null }) {
  const [value, setValue] = useState(reviewsPerProject == null ? "" : String(reviewsPerProject));
  const [error, setError] = useState<string | undefined>();
  const { run, busy } = useJudgingAction();
  const saved = reviewsPerProject == null ? "" : String(reviewsPerProject);
  return (
    <form
      className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end"
      onSubmit={(event) => {
        event.preventDefault();
        setError(undefined);
        run(
          "target",
          () => saveReviewsPerProject({ ...scope, reviewsPerProject: value.trim() === "" ? null : value.trim() }),
          "Review target saved.",
          (result) => {
            if (!result.ok) setError(result.fieldErrors?.reviewsPerProject?.[0] ?? result.error);
          },
        );
      }}
    >
      <Field
        label="Target judges per project"
        helperText={`Leave empty for the default of ${DEFAULT_REVIEWS_PER_PROJECT}.`}
        error={error}
        className="sm:max-w-[260px]"
      >
        <Input
          type="number"
          inputMode="numeric"
          min={REVIEWS_PER_PROJECT_MIN}
          max={REVIEWS_PER_PROJECT_MAX}
          step={1}
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
      </Field>
      <Button type="submit" variant="secondary" loading={busy === "target"} loadingLabel="Saving…" disabled={value.trim() === saved} className="sm:mb-[22px]">
        Save target
      </Button>
    </form>
  );
}

/**
 * One Progress list as numbered pages. The first page arrives with the
 * server render; other pages come from `loadJudgingProgressPage`. A refresh
 * after a change (a new `initial`) re-reads the page showing.
 */
function ProgressSection<R>({
  scope,
  section,
  initial,
  title,
  description,
  noun,
  empty,
  head,
  renderRow,
}: {
  scope: JudgingScope;
  section: JudgingProgressSection;
  initial: NumberedPage<R>;
  title: string;
  description: string;
  noun: string;
  empty: string;
  head: ReactNode;
  renderRow: (row: R) => ReactNode;
}) {
  const [data, setData] = useState<NumberedPage<R>>(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const pageRef = useRef(1);
  const headingId = `judging-progress-${section}`;

  const fetchPage = useCallback(
    async (page: number) => {
      const mine = ++seq.current;
      setLoading(true);
      setError(null);
      let res: Awaited<ReturnType<typeof loadJudgingProgressPage>>;
      try {
        res = await loadJudgingProgressPage({ ...scope, section, page });
      } catch {
        res = { ok: false, error: "Couldn't load the list. Try again." };
      }
      if (mine !== seq.current) return;
      setLoading(false);
      if (!res.ok || !res.data || res.data.section !== section) {
        setError(res.ok ? "Couldn't load the list. Try again." : res.error);
        return;
      }
      setData(res.data.page as unknown as NumberedPage<R>);
      pageRef.current = res.data.page.page;
    },
    [scope, section],
  );

  // A server refresh: show page 1 as rendered, or re-read the page showing.
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    const timer = window.setTimeout(() => {
      if (pageRef.current === 1) {
        seq.current += 1;
        setLoading(false);
        setError(null);
        setData(initial);
        return;
      }
      void fetchPage(pageRef.current);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [initial, fetchPage]);

  return (
    <Card as="section" aria-labelledby={headingId}>
      <CardHeader title={<span id={headingId}>{title}</span>} description={description} />
      {data.total === 0 ? (
        <EmptyState>{empty}</EmptyState>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-caption text-ink-muted" role="status">
              {numberedPageLabel({ start: data.start, total: data.total, shown: data.rows.length }, noun)}
            </p>
            {loading ? <Spinner label="Loading" /> : null}
          </div>
          {error ? (
            <Callout tone="danger" role="alert">
              {error}
            </Callout>
          ) : null}
          <Table label={title}>
            <THead>{head}</THead>
            <TBody>{data.rows.map(renderRow)}</TBody>
          </Table>
          <PageNumberPager label={`${title} pages`} page={data.page} totalPages={data.totalPages} disabled={loading} onPage={(page) => void fetchPage(page)} />
        </div>
      )}
    </Card>
  );
}
