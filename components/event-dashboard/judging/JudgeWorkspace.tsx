import type { EventDashboardContext } from "@/lib/eventDashboard/context";
import { resolveJudgeContext } from "@/lib/judgingAccess";
import { listSubmissionsForJudge } from "@/lib/core/judging";
import { EmptyState } from "@/components/ui/display";
import { NoPermission } from "@/components/event-dashboard/panels/shared";
import { JudgeWorkspaceClient } from "./JudgeWorkspaceClient";

/**
 * The judge workspace (docs/HACKATHON.md): the submissions this person may
 * score, their own progress, and a scoring view per submission. Shown on its
 * own to a JUDGE-only collaborator, and as "Score submissions" inside the
 * Judging tab for organisation owners and admins.
 *
 * Access is re-resolved from the session user (resolveJudgeContext), and the
 * list comes from the judging core, which applies assignments, conflict of
 * interest, and status filters. Only project content and this judge's own
 * progress reach the browser: never entrant emails, answers, or tickets.
 */
export async function JudgeWorkspace({ ctx }: { ctx: EventDashboardContext }) {
  if (!ctx.permissions.canJudge) return <NoPermission>You do not have access to judging for this event.</NoPermission>;
  const judge = await resolveJudgeContext(ctx.userId, ctx.organisation.slug, ctx.event.id);
  if (!judge) return <NoPermission>You do not have access to judging for this event.</NoPermission>;
  const workspace = await listSubmissionsForJudge(judge);
  if (!workspace) {
    return (
      <EmptyState title="Project submissions are off">
        {ctx.permissions.canManageJudging
          ? "Turn on project submissions in the judging settings to start collecting and scoring projects."
          : "The organisers have not turned on project submissions for this event yet."}
      </EmptyState>
    );
  }
  return (
    <JudgeWorkspaceClient
      organisationSlug={ctx.organisation.slug}
      eventId={ctx.event.id}
      judgingStatus={workspace.judgingStatus}
      criteria={workspace.criteria}
      submissions={workspace.submissions}
    />
  );
}
