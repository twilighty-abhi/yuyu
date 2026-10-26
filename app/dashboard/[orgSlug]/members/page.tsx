import Link from "next/link";
import { headers } from "next/headers";
import type { MembershipRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { isOrgAdmin, requireOrgMembership } from "@/lib/permissions";
import { formatRelativeTime } from "@/lib/format/datetime";
import { OrgPageHeader } from "@/components/dashboard/org/OrgPageHeader";
import { OrgInviteLinkPanel } from "@/components/members/OrgInviteLinkPanel";
import { MemberStat, RolesCard } from "@/components/members/MemberSections";
import { TeamList } from "@/components/members/TeamList";
import { firstName, roleBreakdown, roleDots, type RoleCounts, type TeamMemberRow } from "@/components/members/memberSummary";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/display";
import { cn } from "@/lib/cn";

import type { Metadata } from "next";
import { HelpLink } from "@/components/help/HelpLink";

type Props = { params: Promise<{ orgSlug: string }>; searchParams: Promise<{ page?: string }> };
const MEMBERS_PAGE_SIZE = 100;
const RECENT_DAYS = 30;
/** Member join dates and invite ages carry no event context; show them in UTC so every viewer sees the same label. */
const DISPLAY_TIME_ZONE = "UTC";

export const metadata: Metadata = {
  title: "Members",
  description: "Organisation members and roles.",
};

const joinedFormatter = new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric", timeZone: DISPLAY_TIME_ZONE });

export default async function OrgMembersPage({ params, searchParams }: Props) {
  const { orgSlug } = await params;
  const requestedPage = Math.max(1, Number.parseInt((await searchParams).page ?? "1", 10) || 1);
  const { organisation, membership } = await requireOrgMembership(orgSlug);
  const adminView = isOrgAdmin(membership.role);
  const h = await headers();
  const now = new Date();
  const recentSince = new Date(now.getTime() - RECENT_DAYS * 86_400_000);
  const where = { organisationId: organisation.id };

  const [profile, memberCount, roleGroups, recentCount, latestJoiner] = await Promise.all([
    prisma.organisation.findUniqueOrThrow({ where: { id: organisation.id }, select: { logoUrl: true } }),
    prisma.membership.count({ where }),
    prisma.membership.groupBy({ by: ["role"], where, _count: { _all: true } }),
    prisma.membership.count({ where: { ...where, createdAt: { gte: recentSince } } }),
    prisma.membership.findFirst({
      where,
      orderBy: { createdAt: "desc" },
      select: { userId: true, createdAt: true, user: { select: { name: true } } },
    }),
  ]);

  const memberPages = Math.max(1, Math.ceil(memberCount / MEMBERS_PAGE_SIZE));
  const memberPage = Math.min(requestedPage, memberPages);
  // Emails are only selected for OWNER/ADMIN viewers so they never reach a plain member's browser.
  const members = await prisma.membership.findMany({
    where,
    select: { id: true, userId: true, role: true, createdAt: true, user: { select: { name: true, email: adminView } } },
    orderBy: { createdAt: "asc" },
    skip: (memberPage - 1) * MEMBERS_PAGE_SIZE,
    take: MEMBERS_PAGE_SIZE,
  });

  const openInviteWhere = {
    organisationId: organisation.id,
    usedAt: null,
    OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
  };
  const [invites, openInviteCount] = adminView
    ? await Promise.all([
        prisma.organisationInvite.findMany({
          where: openInviteWhere,
          orderBy: { createdAt: "desc" },
          take: 8,
          select: { id: true, token: true, createdAt: true },
        }),
        prisma.organisationInvite.count({ where: openInviteWhere }),
      ])
    : [[], 0];

  const baseUrl: string =
    process.env.NEXT_PUBLIC_BASE_URL ??
    (() => {
      const proto = h.get("x-forwarded-proto") ?? "http";
      const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
      return `${proto}://${host}`;
    })();

  const roleCounts: RoleCounts = { OWNER: 0, ADMIN: 0, MEMBER: 0 };
  for (const group of roleGroups) roleCounts[group.role as MembershipRole] = group._count._all;

  const latestName =
    latestJoiner == null
      ? null
      : latestJoiner.userId === membership.userId
        ? "you"
        : (firstName(latestJoiner.user.name) ?? "someone new");
  const recentHint = latestJoiner
    ? `Latest: ${latestName}, ${formatRelativeTime(latestJoiner.createdAt, DISPLAY_TIME_ZONE, now).replace(/^(Just now|Yesterday)$/, (word) => word.toLowerCase())}`
    : "No one has joined yet";

  const rows: TeamMemberRow[] = members.map((m) => ({
    id: m.id,
    userId: m.userId,
    name: m.user.name,
    ...(adminView ? { email: m.user.email ?? null } : {}),
    role: m.role,
    joinedLabel: joinedFormatter.format(m.createdAt),
    isYou: m.userId === membership.userId,
  }));

  return (
    <div className="flex flex-col gap-7 pb-4">
      <OrgPageHeader
        organisation={{ name: organisation.name, slug: organisation.slug, logoUrl: profile.logoUrl }}
        title="Members"
        description={`The people who run ${organisation.name}, and what each of them can do.`}
        actions={<HelpLink article="organisations/roles">Roles explained</HelpLink>}
      />

      <section aria-label="Team at a glance" className={cn("grid grid-cols-1 gap-4", adminView ? "sm:grid-cols-3" : "sm:grid-cols-2")}>
        <MemberStat label="People" value={memberCount} hint={roleBreakdown(roleCounts)} dots={roleDots(roleCounts)} />
        <MemberStat label={`Joined in the last ${RECENT_DAYS} days`} value={recentCount} hint={recentHint} />
        {adminView ? <MemberStat label="Open invite links" value={openInviteCount} hint="Each link works once" /> : null}
      </section>

      <div className="grid gap-7 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
        <div className="flex min-w-0 flex-col gap-4">
          {rows.length === 0 ? (
            <EmptyState mood="sleepy">No members found.</EmptyState>
          ) : (
            <TeamList organisationSlug={organisation.slug} actorRole={membership.role} rows={rows} showEmail={adminView} />
          )}
          {memberPages > 1 ? (
            <nav aria-label="Member pages" className="flex flex-wrap items-center justify-end gap-2">
              <p className="text-sm text-ink-muted">Page {memberPage} of {memberPages}</p>
              {memberPage <= 1 ? (
                <Button size="sm" variant="secondary" disabled>Previous</Button>
              ) : (
                <Button asChild size="sm" variant="secondary"><Link href={`?page=${memberPage - 1}`}>Previous</Link></Button>
              )}
              {memberPage >= memberPages ? (
                <Button size="sm" variant="secondary" disabled>Next</Button>
              ) : (
                <Button asChild size="sm" variant="secondary"><Link href={`?page=${memberPage + 1}`}>Next</Link></Button>
              )}
            </nav>
          ) : null}
        </div>

        <aside className="flex min-w-0 flex-col gap-5">
          {adminView ? (
            <OrgInviteLinkPanel
              organisationSlug={organisation.slug}
              baseUrl={baseUrl}
              invites={invites.map((invite) => ({
                id: invite.id,
                token: invite.token,
                createdLabel: formatRelativeTime(invite.createdAt, DISPLAY_TIME_ZONE, now),
              }))}
            />
          ) : null}
          <RolesCard />
        </aside>
      </div>
    </div>
  );
}
