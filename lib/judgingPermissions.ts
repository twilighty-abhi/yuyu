import { EventPermission } from "@prisma/client";

/*
 * Pure judging permission rules (docs/HACKATHON.md), shared by the event
 * dashboard context, the judging resolvers, and unit tests.
 *
 * JUDGE is deliberately isolated: it opens the judging workspace and nothing
 * else. No other permission check in the app ever treats JUDGE as one of its
 * grants, and a collaborator whose only grant is JUDGE is a "judge-only"
 * viewer who must see no guests, answers, emails, check-in, or editing.
 */

export type JudgingPermissions = {
  /** Org owner/admin, or an event collaborator with the JUDGE grant. */
  canJudge: boolean;
  /** Rubric, settings, assignments, awards, results: org owner/admin only (same check as RSVP actions). */
  canManageJudging: boolean;
  /** A collaborator whose grants are exactly [JUDGE] and who is not an organisation member. */
  isJudgeOnly: boolean;
};

/**
 * @param isAdmin organisation OWNER/ADMIN
 * @param isMember any organisation membership (MEMBER, ADMIN, or OWNER)
 * @param grant the caller's collaborator permissions on this one event ([] when none)
 */
export function judgingPermissionsFor(isAdmin: boolean, isMember: boolean, grant: readonly EventPermission[]): JudgingPermissions {
  const hasJudge = grant.includes(EventPermission.JUDGE);
  return {
    canJudge: isAdmin || hasJudge,
    canManageJudging: isAdmin,
    isJudgeOnly: !isAdmin && !isMember && hasJudge && grant.every((permission) => permission === EventPermission.JUDGE),
  };
}

/** Whether a grant carries anything besides JUDGE (organiser surfaces outside the judging workspace). */
export function hasNonJudgePermission(grant: readonly EventPermission[]): boolean {
  return grant.some((permission) => permission !== EventPermission.JUDGE);
}
