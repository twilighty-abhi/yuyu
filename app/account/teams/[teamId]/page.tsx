import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireAuth } from "@/lib/permissions";
import { resolveLeaderForUser } from "@/lib/core/teams";
import { TeamPageView } from "@/components/team/TeamPageView";

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
  return <TeamPageView auth={leader} teamRef={{ teamId: leader.teamId }} tokenPage={false} />;
}
