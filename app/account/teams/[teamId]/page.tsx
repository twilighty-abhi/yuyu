import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireAuth } from "@/lib/permissions";
import { resolveLeaderForUser } from "@/lib/core/teams";
import { resolveEntrantForUser } from "@/lib/core/judging";
import { TeamPageView } from "@/components/team/TeamPageView";
import { SubmissionSection } from "@/components/submission/SubmissionSection";

type Props = {
  params: Promise<{ teamId: string }>;
};

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Your team",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

/**
 * A signed-in leader's team page, linked from Account → Registrations. The
 * team id alone grants nothing: it resolves only while this account owns the
 * team's leader registration, and anything else is a plain 404.
 */
export default async function AccountTeamPage({ params }: Props) {
  // The page authenticates itself; the account layout is not an authorization boundary.
  const session = await requireAuth();
  const { teamId } = await params;
  const leader = await resolveLeaderForUser(session.user.id, teamId);
  if (!leader) notFound();
  // The signed-in leader edits the team's submission as a member of the team (docs/HACKATHON.md).
  const entrant = await resolveEntrantForUser(session.user.id, leader.eventId);
  const submission = entrant ? <SubmissionSection auth={entrant} submissionRef={{ eventId: leader.eventId }} /> : null;
  return <TeamPageView auth={leader} teamRef={{ teamId: leader.teamId }} tokenPage={false} submission={submission} />;
}
