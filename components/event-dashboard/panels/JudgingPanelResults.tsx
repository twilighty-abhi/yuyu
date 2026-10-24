"use client";

import { useState } from "react";
import { Download, ExternalLink } from "lucide-react";
import type { JudgingStatus } from "@prisma/client";
import { publishJudgingResults, unpublishJudgingResults } from "@/app/actions/judging-admin";
import { ConfirmationDialog } from "@/components/feedback/ConfirmationDialog";
import { Button } from "@/components/ui/button";
import { Callout, Card, CardHeader, Chip, EmptyState, ProgressBar } from "@/components/ui/display";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { formatDayTime } from "@/lib/format/datetime";
import type { JudgingDashboardCriterion, JudgingDashboardJudge, JudgingDashboardResultRow } from "@/lib/eventDashboard/judging";
import { formatScore, useJudgingAction, type JudgingScope } from "./JudgingPanelShared";

/**
 * Judging → Results: the ranked score table (score, judges counted,
 * per-criterion averages), CSV export, and publishing. Scores and comments
 * stay organiser-only; the public results page shows awards and winners.
 */
export function JudgingPanelResults({
  scope,
  rows,
  criteria,
  judgingStatus,
  resultsPublishedAt,
  resultsUrl,
  exportHref,
  timezone,
}: {
  scope: JudgingScope;
  rows: JudgingDashboardResultRow[];
  criteria: JudgingDashboardCriterion[];
  judgingStatus: JudgingStatus;
  resultsPublishedAt: string | null;
  resultsUrl: string;
  exportHref: string;
  timezone: string;
}) {
  return (
    <div className="flex flex-col gap-5">
      <PublishCard scope={scope} judgingStatus={judgingStatus} resultsPublishedAt={resultsPublishedAt} resultsUrl={resultsUrl} timezone={timezone} />
      <Card as="section">
        <CardHeader
          title="Ranking"
          description="Each judge's weighted percentage, averaged over judges who submitted a review. Projects with the same score share a rank."
          action={
            <Button asChild variant="secondary" size="sm">
              <a href={exportHref} download>
                <Download aria-hidden className="size-4" />
                Export scores (CSV)
              </a>
            </Button>
          }
        />
        {rows.length === 0 ? (
          <EmptyState title="No submitted projects">The ranking fills in as judges submit their reviews.</EmptyState>
        ) : (
          <Table label="Ranked projects">
            <THead>
              <tr>
                <TH>Rank</TH>
                <TH>Project</TH>
                <TH className="text-right">Score</TH>
                <TH className="text-right">Judges</TH>
                {criteria.map((criterion) => (
                  <TH key={criterion.id} className="text-right" title={`Average out of ${criterion.maxScore}`}>
                    {criterion.name}
                    <span className="block font-normal">/ {criterion.maxScore}</span>
                  </TH>
                ))}
              </tr>
            </THead>
            <TBody>
              {rows.map((row) => {
                const averages = new Map(row.criterionAverages.map((average) => [average.criterionId, average.average]));
                return (
                  <TR key={row.submissionId}>
                    <TD className="font-semibold">{row.rank ?? "—"}</TD>
                    <TD className="min-w-[200px]">
                      <span className="block font-semibold">{row.title}</span>
                      <span className="block text-caption text-ink-muted">{row.entrantName}</span>
                      {row.status === "DISQUALIFIED" ? (
                        <Chip size="sm" tone="danger" className="mt-1">
                          Disqualified
                        </Chip>
                      ) : null}
                    </TD>
                    <TD className="text-right font-semibold tabular-nums">{formatScore(row.score)}</TD>
                    <TD className="text-right tabular-nums">{row.judgesCounted}</TD>
                    {criteria.map((criterion) => (
                      <TD key={criterion.id} className="text-right tabular-nums">
                        {formatScore(averages.get(criterion.id) ?? null)}
                      </TD>
                    ))}
                  </TR>
                );
              })}
            </TBody>
          </Table>
        )}
      </Card>
    </div>
  );
}

function PublishCard({
  scope,
  judgingStatus,
  resultsPublishedAt,
  resultsUrl,
  timezone,
}: {
  scope: JudgingScope;
  judgingStatus: JudgingStatus;
  resultsPublishedAt: string | null;
  resultsUrl: string;
  timezone: string;
}) {
  const { run, busy } = useJudgingAction();
  const [confirming, setConfirming] = useState<"publish" | "unpublish" | null>(null);
  const closed = judgingStatus === "CLOSED";
  return (
    <Card as="section">
      <CardHeader
        title="Results page"
        description="Shows each award's winners with their project titles, names and links. Scores and judges' comments are never public."
        action={<Chip tone={resultsPublishedAt ? "success" : "neutral"}>{resultsPublishedAt ? "Published" : "Not published"}</Chip>}
      />
      {resultsPublishedAt ? (
        <div className="flex flex-col gap-3">
          <p className="text-body-ui text-ink-secondary">Published {formatDayTime(resultsPublishedAt, timezone)}. It follows the event page&apos;s visibility.</p>
          <div className="flex flex-wrap gap-2.5">
            <Button asChild variant="secondary">
              <a href={resultsUrl} target="_blank" rel="noopener noreferrer">
                View results page
                <ExternalLink aria-hidden className="size-4" />
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            </Button>
            <Button variant="danger" loading={busy === "unpublish"} onClick={() => setConfirming("unpublish")}>
              Unpublish…
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {closed ? null : <Callout tone="info">Close judging on the Setup tab before you publish results.</Callout>}
          <div>
            <Button variant="primary" disabled={!closed} loading={busy === "publish"} onClick={() => setConfirming("publish")}>
              Publish results…
            </Button>
          </div>
        </div>
      )}
      <ConfirmationDialog
        open={confirming === "publish"}
        title="Publish results?"
        message="The results page goes live with the winners you picked on the Awards tab, and every confirmed registrant gets an email announcing it. Check the awards first."
        confirmLabel="Publish results"
        destructive={false}
        loading={busy === "publish"}
        onConfirm={() =>
          run(
            "publish",
            () => publishJudgingResults(scope),
            "Results published.",
            () => setConfirming(null),
          )
        }
        onCancel={() => setConfirming(null)}
      />
      <ConfirmationDialog
        open={confirming === "unpublish"}
        title="Unpublish results?"
        message="The results page is hidden again. Announcement emails that haven't been sent yet are cancelled; ones already delivered can't be recalled."
        confirmLabel="Unpublish"
        loading={busy === "unpublish"}
        onConfirm={() => run("unpublish", () => unpublishJudgingResults(scope), "Results unpublished.", () => setConfirming(null))}
        onCancel={() => setConfirming(null)}
      />
    </Card>
  );
}

/** Judging → Judges: who can judge, how many projects each sees, and their submitted reviews. */
export function JudgingPanelJudges({ judges, judgesSeeAll }: { judges: JudgingDashboardJudge[]; judgesSeeAll: boolean }) {
  return (
    <Card as="section">
      <CardHeader
        title="Judges"
        description="Organisation owners and admins can judge, as can collaborators you invite with the Judge permission in Settings. Judges never see entrant emails or answers, and never see a project they're registered on."
      />
      {judges.length === 0 ? (
        <EmptyState title="No judges yet">Invite collaborators with the Judge permission from the Settings tab.</EmptyState>
      ) : (
        <Table label="Judging progress">
          <THead>
            <tr>
              <TH>Judge</TH>
              {judgesSeeAll ? null : <TH className="text-right">Assigned</TH>}
              <TH className="min-w-[180px]">Reviews submitted</TH>
            </tr>
          </THead>
          <TBody>
            {judges.map((judge) => (
              <TR key={judge.userId}>
                <TD>
                  <span className="block font-semibold">{judge.name}</span>
                  <span className="block text-caption text-ink-muted">
                    {judge.kind === "admin" ? "Organiser" : "Judge"}
                    {judge.email ? ` · ${judge.email}` : ""}
                  </span>
                </TD>
                {judgesSeeAll ? null : <TD className="text-right tabular-nums">{judge.assigned}</TD>}
                <TD>
                  {judge.visible == null ? (
                    <span className="text-caption text-ink-muted">Not judging yet</span>
                  ) : (
                    <div className="flex items-center gap-3">
                      <ProgressBar value={judge.reviewsSubmitted} max={Math.max(judge.visible, 1)} tone="success" className="w-24" label={`${judge.reviewsSubmitted} of ${judge.visible} reviews submitted`} />
                      <span className="text-caption tabular-nums text-ink-secondary">
                        {judge.reviewsSubmitted} / {judge.visible}
                      </span>
                    </div>
                  )}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </Card>
  );
}
