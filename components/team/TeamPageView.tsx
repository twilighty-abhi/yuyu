import "server-only";

import { notFound } from "next/navigation";
import { SoloPolicy } from "@prisma/client";
import { prisma } from "@/lib/db";
import { listSeekersForLeader, loadTeamPage, type TeamLeaderAuth } from "@/lib/core/teams";
import { formatDayShort, formatTime, formatTimeZoneName } from "@/lib/format/datetime";
import { safeTimeZone } from "@/lib/timeZone";
import { accentStyle } from "@/lib/theme/accent";
import type { TeamRef } from "@/app/actions/teams";
import { TeamManager } from "./TeamManager";

/**
 * Shared body of the leader's team page, reached by management token
 * (`/team/{token}`) or by a signed-in leader (`/account/teams/{teamId}`).
 * Callers resolve `auth` first; this re-checks it while loading and 404s on
 * any mismatch so a stale or foreign link reveals nothing.
 */
export async function TeamPageView({ auth, teamRef, tokenPage }: { auth: TeamLeaderAuth; teamRef: TeamRef; tokenPage: boolean }) {
  const [page, seekers, accent] = await Promise.all([
    loadTeamPage(auth),
    listSeekersForLeader(auth),
    prisma.event.findUnique({ where: { id: auth.eventId }, select: { page: { select: { accentColor: true } } } }),
  ]);
  if (!page) notFound();

  const timeZone = safeTimeZone(page.event.timezone);
  const start = page.event.startDateTime;
  const whenLabel = `${formatDayShort(start, timeZone)} · ${formatTime(start, timeZone)} ${formatTimeZoneName(start, timeZone)}`;

  return (
    <div style={accentStyle(accent?.page?.accentColor)} className="yy-accent-scope mx-auto flex w-full max-w-[640px] flex-col py-2 sm:py-6">
      <TeamManager
        teamRef={teamRef}
        tokenPage={tokenPage}
        baseUrl={(process.env.NEXT_PUBLIC_BASE_URL ?? "").replace(/\/+$/, "")}
        team={page.team}
        event={{
          title: page.event.title,
          href: `/${page.event.orgSlug}/${page.event.eventSlug}`,
          whenLabel,
          registrationOpen: page.event.registrationOpen,
          matching: page.event.soloPolicy === SoloPolicy.SOLO_WITH_MATCHING,
          inviteOnly: page.event.inviteOnly,
        }}
        members={page.members}
        pendingRequests={page.pendingRequests}
        seekers={seekers}
      />
    </div>
  );
}
