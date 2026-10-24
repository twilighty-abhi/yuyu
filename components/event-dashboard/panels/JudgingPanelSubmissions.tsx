"use client";

import { useMemo, useState, useTransition } from "react";
import { Ban, ExternalLink, Eye, MessageSquareText, MoreHorizontal, RotateCcw, UserCheck } from "lucide-react";
import type { SubmissionStatus } from "@prisma/client";
import { assignProjectJudge, disqualifyProject, loadProjectReviews, reinstateProject, unassignProjectJudge, type SubmissionReviewView } from "@/app/actions/judging-admin";
import { useToast } from "@/components/feedback/ToastProvider";
import { Button, IconButton } from "@/components/ui/button";
import { CheckboxField, FilterChip } from "@/components/ui/choice";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Callout, Chip, EmptyState } from "@/components/ui/display";
import { Field, Input, SearchInput } from "@/components/ui/field";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { Spinner } from "@/components/ui/spinner";
import { formatDayTime } from "@/lib/format/datetime";
import type { JudgingDashboardCriterion, JudgingDashboardJudge, JudgingDashboardSubmission } from "@/lib/eventDashboard/judging";
import {
  SUBMISSION_STATUS_LABELS,
  SUBMISSION_STATUS_TONES,
  fieldError,
  useJudgingAction,
  type JudgingLimits,
  type JudgingScope,
} from "./JudgingPanelShared";

type Filter = "all" | SubmissionStatus;

const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: "all", label: "All" },
  { value: "SUBMITTED", label: "Submitted" },
  { value: "DRAFT", label: "Drafts" },
  { value: "WITHDRAWN", label: "Withdrawn" },
  { value: "DISQUALIFIED", label: "Disqualified" },
];

/**
 * Judging → Submissions: every project with its status, organiser-only
 * disqualification reason, judge assignments, and the judges' reviews. Entrant
 * emails and ticket links never reach this view.
 */
export function JudgingPanelSubmissions({
  scope,
  submissions,
  judges,
  criteria,
  judgesSeeAll,
  timezone,
  limits,
}: {
  scope: JudgingScope;
  submissions: JudgingDashboardSubmission[];
  judges: JudgingDashboardJudge[];
  criteria: JudgingDashboardCriterion[];
  judgesSeeAll: boolean;
  timezone: string;
  limits: JudgingLimits;
}) {
  const { run, busy } = useJudgingAction();
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [viewing, setViewing] = useState<JudgingDashboardSubmission | null>(null);
  const [assigningId, setAssigningId] = useState<string | null>(null);
  const [disqualifying, setDisqualifying] = useState<JudgingDashboardSubmission | null>(null);
  const [reviewing, setReviewing] = useState<JudgingDashboardSubmission | null>(null);
  const [reviews, setReviews] = useState<{ id: string; rows: SubmissionReviewView[] } | null>(null);
  const [, startLoading] = useTransition();
  const { showToast } = useToast();

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
  const counts = useMemo(() => {
    const result: Record<Filter, number> = { all: submissions.length, DRAFT: 0, SUBMITTED: 0, WITHDRAWN: 0, DISQUALIFIED: 0 };
    for (const submission of submissions) result[submission.status] += 1;
    return result;
  }, [submissions]);
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return submissions.filter(
      (submission) =>
        (filter === "all" || submission.status === filter) &&
        (!needle || submission.title.toLowerCase().includes(needle) || submission.entrantName.toLowerCase().includes(needle)),
    );
  }, [submissions, filter, query]);
  // Re-read from the refreshed list so the assignment dialog shows current state.
  const assigning = assigningId ? submissions.find((submission) => submission.id === assigningId) ?? null : null;

  if (submissions.length === 0) {
    return <EmptyState title="No projects yet">Projects appear here once confirmed entrants start a submission.</EmptyState>;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by status">
          {FILTERS.map((item) => (
            <FilterChip key={item.value} selected={filter === item.value} onClick={() => setFilter(item.value)}>
              {item.label} <span className="font-medium opacity-80">{counts[item.value]}</span>
            </FilterChip>
          ))}
        </div>
        <div className="sm:w-[260px]">
          <SearchInput placeholder="Search projects" aria-label="Search projects" value={query} onChange={(event) => setQuery(event.target.value)} onClear={() => setQuery("")} />
        </div>
      </div>
      {judgesSeeAll ? null : (
        <Callout tone="info">Judges only see the projects assigned to them. Use Assign judges on each submitted project.</Callout>
      )}
      {visible.length === 0 ? (
        <EmptyState title="No matching projects">Try another filter or search.</EmptyState>
      ) : (
        <ul className="flex flex-col divide-y divide-line rounded-lg border border-line bg-canvas">
          {visible.map((submission) => (
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
                      <MenuItem icon={<RotateCcw />} onSelect={() => run(submission.id, () => reinstateProject({ ...scope, submissionId: submission.id }), "Project reinstated.")}>
                        Reinstate
                      </MenuItem>
                    ) : null}
                  </MenuContent>
                </Menu>
              </div>
            </li>
          ))}
        </ul>
      )}

      <ProjectDialog submission={viewing} onClose={() => setViewing(null)} />
      <AssignDialog scope={scope} submission={assigning} judges={judges} onClose={() => setAssigningId(null)} />
      <DisqualifyDialog scope={scope} submission={disqualifying} maxLength={limits.disqualifyReason} onClose={() => setDisqualifying(null)} />
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

function DisqualifyDialog({ scope, submission, maxLength, onClose }: { scope: JudgingScope; submission: JudgingDashboardSubmission | null; maxLength: number; onClose: () => void }) {
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
        <DialogHeader title="Disqualify this project?" description={submission ? `"${submission.title}" stops being judged and loses any award it holds. You can reinstate it later.` : undefined} />
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
          <DialogBody>
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
