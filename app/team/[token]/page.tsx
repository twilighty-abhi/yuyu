import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { resolveTeamByManageToken } from "@/lib/core/teams";
import { isTeamTokenShape } from "@/lib/teamToken";
import { resolveEntrantByTeamManageToken } from "@/lib/core/judging";
import { TeamPageView } from "@/components/team/TeamPageView";
import { SubmissionSection } from "@/components/submission/SubmissionSection";

type Props = {
  params: Promise<{ token: string }>;
};

// The management token is a bearer capability: render per request, never
// cache (dynamic pages are sent `private, no-store`), never index, and never
// leak the address through Referer.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Your team",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function TeamManagePage({ params }: Props) {
  const { token } = await params;
  const raw = token?.trim() ?? "";
  if (!isTeamTokenShape(raw)) notFound();
  const leader = await resolveTeamByManageToken(raw);
  if (!leader) notFound();
  // The same management link edits the team's hackathon submission (docs/HACKATHON.md).
  const entrant = await resolveEntrantByTeamManageToken(raw);
  const submission = entrant ? <SubmissionSection auth={entrant} submissionRef={{ manageToken: raw }} /> : null;
  return <TeamPageView auth={leader} teamRef={{ manageToken: raw }} tokenPage submission={submission} />;
}
