import type { EventDashboardContext } from "@/lib/eventDashboard/context";
import { judgingOrganiserContext, loadJudgingDashboard } from "@/lib/eventDashboard/judging";
import { listEligibleJudges } from "@/lib/core/judging";
import { loadJudgingProgress } from "@/lib/core/judgingOps";
import type { JudgingOrganiserContext } from "@/lib/judgingAccess";
import {
  DISQUALIFY_REASON_MAX_LENGTH,
  EVENT_AWARD_NAME_MAX_LENGTH,
  EVENT_AWARD_PLACE_MAX,
  EVENT_AWARDS_LIMIT,
  JUDGING_CRITERIA_LIMIT,
  JUDGING_CRITERION_NAME_MAX_LENGTH,
  JUDGING_MAX_SCORE_LIMIT,
  JUDGING_TEXT_DESCRIPTION_MAX_LENGTH,
  JUDGING_WEIGHT_MAX,
} from "@/lib/validators";
import { JudgeWorkspace } from "@/components/event-dashboard/judging/JudgeWorkspace";
import { SubTabs, type SubTab } from "../SubTabs";
import { JudgingPanelAwards } from "./JudgingPanelAwards";
import { JudgingPanelResults, JudgingPanelJudges } from "./JudgingPanelResults";
import { JudgingPanelProgress } from "./JudgingPanelProgress";
import { JudgingPanelRubric } from "./JudgingPanelRubric";
import { JudgingPanelSetup } from "./JudgingPanelSetup";
import type { JudgingLimits } from "./JudgingPanelShared";
import { JudgingPanelSubmissions } from "./JudgingPanelSubmissions";
import { NoPermission } from "./shared";

const LIMITS: JudgingLimits = {
  criteria: JUDGING_CRITERIA_LIMIT,
  criterionName: JUDGING_CRITERION_NAME_MAX_LENGTH,
  description: JUDGING_TEXT_DESCRIPTION_MAX_LENGTH,
  weight: JUDGING_WEIGHT_MAX,
  maxScore: JUDGING_MAX_SCORE_LIMIT,
  awards: EVENT_AWARDS_LIMIT,
  awardName: EVENT_AWARD_NAME_MAX_LENGTH,
  awardPlace: EVENT_AWARD_PLACE_MAX,
  disqualifyReason: DISQUALIFY_REASON_MAX_LENGTH,
};

/** Judging → Progress: the summary and first pages, plus who can be picked for automatic assignment. */
async function loadProgressTab(organiser: JudgingOrganiserContext, now: Date) {
  const [data, judges] = await Promise.all([loadJudgingProgress(organiser, now), listEligibleJudges(organiser)]);
  return data ? { data, judges } : null;
}

/**
 * The event dashboard's Judging tab (docs/HACKATHON.md). Organisation owners
 * and admins (`canManageJudging`, the same check as the organiser RSVP
 * actions) get setup, rubric, submissions, judges, progress, results, and awards. Anyone
 * who can judge also gets the judge workspace. A JUDGE-only collaborator never
 * reaches this panel: the page shows them the workspace on its own.
 */
export async function JudgingPanel({ ctx }: { ctx: EventDashboardContext }) {
  const { permissions } = ctx;
  if (!permissions.canManageJudging) {
    return permissions.canJudge ? <JudgeWorkspace ctx={ctx} /> : <NoPermission>You do not have permission to manage judging for this event.</NoPermission>;
  }

  const organiser = judgingOrganiserContext(ctx);
  const [data, progress] = await Promise.all([loadJudgingDashboard(ctx), organiser ? loadProgressTab(organiser, ctx.now) : null]);
  if (!data) return <NoPermission>You do not have permission to manage judging for this event.</NoPermission>;
  const { scope, settings } = data;
  const frozen = settings.judgingStatus !== "NOT_STARTED";

  const setup: SubTab = {
    value: "judging-setup",
    label: "Setup",
    content: (
      <div className="flex flex-col gap-5">
        <JudgingPanelSetup scope={scope} settings={settings} criteriaCount={data.criteria.length} submittedCount={data.counts.SUBMITTED} now={ctx.now.toISOString()} />
        <JudgingPanelRubric scope={scope} criteria={data.criteria} frozen={frozen} limits={LIMITS} />
      </div>
    ),
  };
  if (!settings.submissionsEnabled && data.submissionsTotal === 0 && settings.judgingStatus === "NOT_STARTED" && !settings.resultsPublishedAt) {
    // Nothing to judge yet: only the settings needed to turn submissions on.
    return <SubTabs label="Judging sections" items={[setup]} />;
  }

  return (
    <SubTabs
      label="Judging sections"
      items={[
        setup,
        {
          value: "judging-submissions",
          label: "Submissions",
          count: data.submissionsTotal,
          content: (
            <JudgingPanelSubmissions
              scope={scope}
              initialPage={data.submissions}
              counts={data.counts}
              total={data.submissionsTotal}
              judges={data.judges}
              criteria={data.criteria}
              judgesSeeAll={settings.judgesSeeAll}
              timezone={settings.timezone}
              awards={data.awards}
              resultsPublished={Boolean(settings.resultsPublishedAt)}
              limits={LIMITS}
            />
          ),
        },
        {
          value: "judging-judges",
          label: "Judges",
          // Invited judges only: organisers can always judge, so counting them would never show 0.
          count: data.judges.filter((judge) => judge.kind === "judge").length,
          content: <JudgingPanelJudges judges={data.judges} judgesSeeAll={settings.judgesSeeAll} />,
        },
        {
          value: "judging-progress",
          label: "Progress",
          content: progress ? (
            <JudgingPanelProgress scope={scope} initial={progress.data} judges={progress.judges} timezone={settings.timezone} now={ctx.now.toISOString()} />
          ) : (
            <NoPermission>You do not have permission to manage judging for this event.</NoPermission>
          ),
        },
        {
          value: "judging-score",
          label: "Score",
          content: <JudgeWorkspace ctx={ctx} />,
        },
        {
          value: "judging-results",
          label: "Results",
          content: (
            <JudgingPanelResults
              scope={scope}
              initialPage={data.results}
              criteria={data.criteria}
              judgingStatus={settings.judgingStatus}
              resultsPublishedAt={settings.resultsPublishedAt}
              resultsUrl={data.resultsUrl}
              exportHref={data.exportHref}
              timezone={settings.timezone}
            />
          ),
        },
        {
          value: "judging-awards",
          label: "Awards",
          count: data.awards.length,
          content: <JudgingPanelAwards scope={scope} awards={data.awards} submittedCount={data.counts.SUBMITTED} resultsPublished={Boolean(settings.resultsPublishedAt)} limits={LIMITS} />,
        },
      ]}
    />
  );
}
