import "server-only";

import { Prisma, SubmissionStatus } from "@prisma/client";
import { z } from "zod";

/**
 * Submission rows that follow their entrant's registration (docs/HACKATHON.md).
 * Team and RSVP mutations call these inside their own transaction, after they
 * have taken the Event row lock, so no entrant or judge write can interleave
 * (those take the same lock `FOR SHARE`).
 *
 * Kept apart from lib/core/judging.ts, which imports lib/core/teams.ts.
 */

type SoloToTeamResult = { ok: true } | { ok: false; error: string };

/**
 * A solo registration is about to join a team. An entrant is either a team or
 * a single RSVP, never both, so the solo project cannot survive the move:
 *
 * - a SUBMITTED project is in the competition, so the move is refused until
 *   the entrant withdraws it (or an organiser disqualifies it);
 * - a DISQUALIFIED project is refused when the entrant side joins (joining a
 *   team must not erase a disqualification), but an organiser move removes it;
 * - a DRAFT or WITHDRAWN project is deleted.
 *
 * The solo `/submit/{token}` link is retired in every case.
 */
export async function retireSoloSubmissionForTeamTx(
  tx: Prisma.TransactionClient,
  params: { rsvpId: string; eventId: string; by: "entrant" | "organiser" },
): Promise<SoloToTeamResult> {
  const submission = await tx.submission.findFirst({
    where: { rsvpId: params.rsvpId, eventId: params.eventId },
    select: { id: true, status: true },
  });
  if (submission?.status === SubmissionStatus.SUBMITTED) {
    return {
      ok: false,
      error: params.by === "organiser"
        ? "This person has submitted a project on their own. Ask them to withdraw it, or disqualify it, before moving them into a team."
        : "This registration has already submitted a project on its own. Withdraw that project before joining a team.",
    };
  }
  if (submission?.status === SubmissionStatus.DISQUALIFIED && params.by === "entrant") {
    return { ok: false, error: "This registration's project was disqualified, so it can't join a team. Contact the organisers." };
  }
  if (submission) {
    // Scores, reviews, assignments, and award wins cascade with the row.
    await tx.submission.deleteMany({ where: { id: submission.id, eventId: params.eventId, rsvpId: params.rsvpId } });
  }
  await tx.submissionLink.deleteMany({ where: { rsvpId: params.rsvpId } });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Deletion undo snapshots
// ---------------------------------------------------------------------------

const isoDate = z.string().datetime();

export const submissionSnapshotSchema = z.object({
  id: z.string().min(1).max(128),
  eventId: z.string().min(1).max(128),
  title: z.string().min(1).max(120),
  summary: z.string().max(4000),
  repoUrl: z.string().max(500).nullable(),
  demoUrl: z.string().max(500).nullable(),
  videoUrl: z.string().max(500).nullable(),
  status: z.nativeEnum(SubmissionStatus),
  submittedAt: isoDate.nullable(),
  disqualifiedReason: z.string().max(500).nullable(),
  createdAt: isoDate,
  scores: z.array(z.object({
    judgeUserId: z.string().min(1).max(128),
    criterionId: z.string().min(1).max(128),
    score: z.number().int().min(0).max(10),
    createdAt: isoDate,
  })).max(10_000),
  reviews: z.array(z.object({
    judgeUserId: z.string().min(1).max(128),
    comment: z.string().max(2000),
    submittedAt: isoDate.nullable(),
    createdAt: isoDate,
  })).max(1_000),
  assignments: z.array(z.object({ judgeUserId: z.string().min(1).max(128), createdAt: isoDate })).max(1_000),
  awardWins: z.array(z.object({ awardId: z.string().min(1).max(128), place: z.number().int().min(1).max(1000) })).max(200),
});

export type SubmissionSnapshot = z.infer<typeof submissionSnapshotSchema>;

/**
 * The entrant's submission with its judging record, for an organiser's
 * deletion undo. Null when the entrant has no submission. Read inside the
 * deleting transaction, before the cascade removes it.
 */
export async function captureSubmissionSnapshotTx(
  tx: Prisma.TransactionClient,
  owner: { eventId: string } & ({ teamId: string } | { rsvpId: string }),
): Promise<SubmissionSnapshot | null> {
  const row = await tx.submission.findFirst({
    where: "teamId" in owner ? { eventId: owner.eventId, teamId: owner.teamId } : { eventId: owner.eventId, rsvpId: owner.rsvpId },
    select: {
      id: true,
      eventId: true,
      title: true,
      summary: true,
      repoUrl: true,
      demoUrl: true,
      videoUrl: true,
      status: true,
      submittedAt: true,
      disqualifiedReason: true,
      createdAt: true,
      scores: { select: { judgeUserId: true, criterionId: true, score: true, createdAt: true } },
      reviews: { select: { judgeUserId: true, comment: true, submittedAt: true, createdAt: true } },
      assignments: { select: { judgeUserId: true, createdAt: true } },
      awardWins: { select: { awardId: true, place: true } },
    },
  });
  if (!row) return null;
  return {
    id: row.id,
    eventId: row.eventId,
    title: row.title,
    summary: row.summary,
    repoUrl: row.repoUrl,
    demoUrl: row.demoUrl,
    videoUrl: row.videoUrl,
    status: row.status,
    submittedAt: row.submittedAt?.toISOString() ?? null,
    disqualifiedReason: row.disqualifiedReason,
    createdAt: row.createdAt.toISOString(),
    scores: row.scores.map((score) => ({ ...score, createdAt: score.createdAt.toISOString() })),
    reviews: row.reviews.map((review) => ({ ...review, submittedAt: review.submittedAt?.toISOString() ?? null, createdAt: review.createdAt.toISOString() })),
    assignments: row.assignments.map((assignment) => ({ ...assignment, createdAt: assignment.createdAt.toISOString() })),
    awardWins: row.awardWins,
  };
}

/**
 * Recreate a snapshotted submission for its restored entrant, inside the
 * restoring transaction (Event lock held). Rows whose targets have gone since
 * the deletion (a deleted judge account, criterion, or award; an award place
 * taken meanwhile) are skipped rather than failing the whole undo.
 */
export async function restoreSubmissionSnapshotTx(
  tx: Prisma.TransactionClient,
  snapshot: SubmissionSnapshot,
  owner: { eventId: string } & ({ teamId: string } | { rsvpId: string }),
): Promise<void> {
  if (snapshot.eventId !== owner.eventId) return;
  await tx.submission.create({
    data: {
      id: snapshot.id,
      eventId: owner.eventId,
      ...("teamId" in owner ? { teamId: owner.teamId } : { rsvpId: owner.rsvpId }),
      title: snapshot.title,
      summary: snapshot.summary,
      repoUrl: snapshot.repoUrl,
      demoUrl: snapshot.demoUrl,
      videoUrl: snapshot.videoUrl,
      status: snapshot.status,
      submittedAt: snapshot.submittedAt ? new Date(snapshot.submittedAt) : null,
      disqualifiedReason: snapshot.disqualifiedReason,
      createdAt: new Date(snapshot.createdAt),
    },
  });

  const judgeIds = [...new Set([...snapshot.scores, ...snapshot.reviews, ...snapshot.assignments].map((row) => row.judgeUserId))];
  const [users, criteria, awards] = await Promise.all([
    judgeIds.length > 0 ? tx.user.findMany({ where: { id: { in: judgeIds } }, select: { id: true } }) : Promise.resolve([]),
    tx.judgingCriterion.findMany({ where: { eventId: owner.eventId }, select: { id: true, maxScore: true } }),
    tx.eventAward.findMany({ where: { eventId: owner.eventId }, select: { id: true } }),
  ]);
  const liveUsers = new Set(users.map((user) => user.id));
  const maxScore = new Map(criteria.map((criterion) => [criterion.id, criterion.maxScore]));
  const liveAwards = new Set(awards.map((award) => award.id));

  const scores = snapshot.scores.filter((score) => liveUsers.has(score.judgeUserId) && score.score <= (maxScore.get(score.criterionId) ?? -1));
  if (scores.length > 0) {
    await tx.judgeScore.createMany({
      data: scores.map((score) => ({ submissionId: snapshot.id, judgeUserId: score.judgeUserId, criterionId: score.criterionId, score: score.score, createdAt: new Date(score.createdAt) })),
      skipDuplicates: true,
    });
  }
  const reviews = snapshot.reviews.filter((review) => liveUsers.has(review.judgeUserId));
  if (reviews.length > 0) {
    await tx.judgeReview.createMany({
      data: reviews.map((review) => ({
        submissionId: snapshot.id,
        judgeUserId: review.judgeUserId,
        comment: review.comment,
        submittedAt: review.submittedAt ? new Date(review.submittedAt) : null,
        createdAt: new Date(review.createdAt),
      })),
      skipDuplicates: true,
    });
  }
  const assignments = snapshot.assignments.filter((assignment) => liveUsers.has(assignment.judgeUserId));
  if (assignments.length > 0) {
    await tx.judgeAssignment.createMany({
      data: assignments.map((assignment) => ({ eventId: owner.eventId, judgeUserId: assignment.judgeUserId, submissionId: snapshot.id, createdAt: new Date(assignment.createdAt) })),
      skipDuplicates: true,
    });
  }
  // Only SUBMITTED projects can hold an award; a place someone else took meanwhile stays theirs.
  const wins = snapshot.status === SubmissionStatus.SUBMITTED ? snapshot.awardWins.filter((win) => liveAwards.has(win.awardId)) : [];
  if (wins.length > 0) {
    await tx.eventAwardWinner.createMany({
      data: wins.map((win) => ({ awardId: win.awardId, submissionId: snapshot.id, place: win.place })),
      skipDuplicates: true,
    });
  }
}
