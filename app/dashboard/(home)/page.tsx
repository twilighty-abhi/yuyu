import Link from "next/link";
import { Clock3, Plus } from "lucide-react";
import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getDashboardHome, type HomeEventRow } from "@/lib/dashboardHome";
import { formatDateBlock, formatDayShort, formatTime } from "@/lib/format/datetime";
import { DotFace } from "@/components/brand/DotFace";
import { CreateEventDialog } from "@/components/event/CreateEventDialog";
import { Button } from "@/components/ui/button";
import { HomeGreeting } from "@/components/dashboard/home/HomeGreeting";
import { HomeEventsPanel, type HomeEventRowView } from "@/components/dashboard/home/HomeEventsPanel";
import { ActivityFeed, FirstRunSetup, LiveEventPanel, NextUpCard, OrganisationCards, StatRow } from "@/components/dashboard/home/HomeSections";

export const metadata: Metadata = {
  title: "Dashboard",
  description: "Manage your organisations, events, and RSVPs.",
};

function toView(row: HomeEventRow, now: Date, showOrganisation: boolean): HomeEventRowView {
  const { month, day } = formatDateBlock(row.dateBlock.start, row.dateBlock.timezone);
  const when = `${formatDayShort(row.dateBlock.start, row.dateBlock.timezone, now)} · ${formatTime(row.dateBlock.start, row.dateBlock.timezone)}`;
  return {
    key: row.key,
    href: row.href,
    title: row.title,
    month,
    day,
    meta: row.isDraft ? `Draft · ${when}` : `${when} · ${row.meta}`,
    organisationName: showOrganisation ? row.organisationName : null,
    accent: row.accent,
    isSeries: row.isSeries,
    isDraft: row.isDraft,
    status: row.status,
    fill: row.fill,
  };
}

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user?.id) return null;
  const userId = session.user.id;
  const now = new Date();

  const [home, collaboratorGrants] = await Promise.all([
    getDashboardHome(userId, now),
    prisma.eventCollaborator.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      include: {
        event: { select: { id: true, title: true, organisation: { select: { id: true, name: true, slug: true } } } },
        series: { select: { id: true, title: true, organisation: { select: { id: true, name: true, slug: true } } } },
      },
    }),
  ]);

  const membershipOrganisationIds = new Set(home.organisations.map((organisation) => organisation.id));
  const coOrganizedEvents = collaboratorGrants.flatMap((grant) => {
    const item = grant.event
      ? { id: grant.event.id, title: grant.event.title, organisation: grant.event.organisation, href: `/dashboard/${grant.event.organisation.slug}/event/${grant.event.id}`, label: "Event" }
      : grant.series
        ? { id: grant.series.id, title: grant.series.title, organisation: grant.series.organisation, href: `/dashboard/${grant.series.organisation.slug}/series/${grant.series.id}`, label: "Series" }
        : null;
    return item && !membershipOrganisationIds.has(item.organisation.id) ? [{ ...item, permissions: grant.permissions }] : [];
  });

  const fullName = session.user.name?.trim() || "there";
  const firstName = fullName.split(/\s+/)[0];
  const hasOrganisations = home.organisations.length > 0;
  const showOrganisationOnRows = home.organisations.length > 1;
  const singleAdminOrg = home.adminOrganisations.length === 1 ? home.adminOrganisations[0] : null;
  const firstRunOnly = home.setup !== null && !home.setup.hasEvent;

  const coOrganized = coOrganizedEvents.length ? (
    <section aria-labelledby="co-organized-title" className="flex flex-col gap-3">
      <div>
        <h2 id="co-organized-title" className="text-h4 text-ink">Co-organized events</h2>
        <p className="mt-1 text-body-ui text-ink-muted">Events you can manage without organisation membership</p>
      </div>
      <ul className="grid gap-3 md:grid-cols-2">
        {coOrganizedEvents.map((item) => (
          <li key={`${item.label}-${item.id}`}>
            <Link href={item.href} className="flex h-full flex-col gap-1 rounded-lg border border-line bg-canvas p-5 transition-colors hover:bg-subtle">
              <span className="text-caption text-ink-muted">{item.label} · {item.organisation.name}</span>
              <span className="text-[17px] font-bold text-ink">{item.title}</span>
              <span className="text-caption text-ink-muted">{item.permissions.map((permission) => permission.replaceAll("_", " ").toLowerCase()).join(" · ")}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  ) : null;

  // Brand-new organiser: the setup checklist is the whole page.
  if (firstRunOnly && home.setup) {
    return (
      <div className="flex flex-col gap-10">
        <FirstRunSetup setup={home.setup} name={firstName} />
        {coOrganized}
        {hasOrganisations ? <OrganisationCards organisations={home.organisations} /> : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-5 md:flex-row md:items-center">
        <DotFace mood={home.mood} size={64} className="shrink-0" />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <HomeGreeting name={firstName} />
          <p className="text-body-ui text-ink-secondary">{home.summary}</p>
        </div>
        <div className="flex flex-wrap gap-2.5">
          {singleAdminOrg ? (
            <>
              <Button asChild variant="secondary">
                <Link href="/dashboard/org/new">New organisation</Link>
              </Button>
              <CreateEventDialog organisationSlug={singleAdminOrg.slug} />
            </>
          ) : (
            <Button asChild variant="primary">
              <Link href="/dashboard/org/new">
                <Plus aria-hidden className="size-[18px]" />
                New organisation
              </Link>
            </Button>
          )}
        </div>
      </header>

      {home.needsYou ? (
        <div role="status" className="flex flex-col gap-3 rounded-lg bg-warning-bg px-4 py-3.5 text-warning-fg sm:flex-row sm:items-center">
          <Clock3 aria-hidden className="hidden size-5 shrink-0 sm:block" />
          <p className="min-w-0 flex-1 text-body-ui">
            {home.needsYou.pendingApprovals > 0 ? (
              <strong>{home.needsYou.pendingApprovals === 1 ? "1 person is" : `${home.needsYou.pendingApprovals} people are`} waiting for approval.</strong>
            ) : null}
            {home.needsYou.pendingApprovals > 0 && home.needsYou.drafts > 0 ? " " : null}
            {home.needsYou.drafts > 0 ? <span>{home.needsYou.drafts === 1 ? "1 event is" : `${home.needsYou.drafts} events are`} still a draft.</span> : null}
          </p>
          <span className="flex shrink-0 flex-wrap gap-x-4 gap-y-1 text-sm font-bold">
            {home.needsYou.approvalsHref ? <Link href={home.needsYou.approvalsHref} className="underline underline-offset-4">Review approvals</Link> : null}
            {home.needsYou.draftHref ? <Link href={home.needsYou.draftHref} className="underline underline-offset-4">Finish draft</Link> : null}
          </span>
        </div>
      ) : null}

      {home.setup ? <FirstRunSetup setup={home.setup} name={firstName} compact /> : null}

      {home.live ? <LiveEventPanel live={home.live} now={now} /> : home.next ? <NextUpCard next={home.next} now={now} /> : null}

      {hasOrganisations ? <StatRow stats={home.stats} /> : null}

      {hasOrganisations ? (
        <div className="grid gap-7 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
          <HomeEventsPanel
            upcoming={home.upcoming.map((row) => toView(row, now, showOrganisationOnRows))}
            drafts={home.drafts.map((row) => toView(row, now, showOrganisationOnRows))}
            past={home.past.map((row) => toView(row, now, showOrganisationOnRows))}
            counts={home.counts}
            showDrafts={home.adminOrganisations.length > 0}
          />
          <ActivityFeed activity={home.activity} now={now} />
        </div>
      ) : null}

      {coOrganized}

      {hasOrganisations ? <OrganisationCards organisations={home.organisations} /> : null}
    </div>
  );
}
