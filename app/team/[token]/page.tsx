import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { resolveTeamByManageToken } from "@/lib/core/teams";
import { isTeamTokenShape } from "@/lib/teamToken";
import { TeamPageView } from "@/components/team/TeamPageView";

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
  return <TeamPageView auth={leader} teamRef={{ manageToken: raw }} tokenPage />;
}
