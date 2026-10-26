import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowRight, Clock } from "lucide-react";
import { EventPrivacyType, EventStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { RsvpForm } from "@/components/rsvp/RsvpForm";
import { isEventPublished, shouldIndexPublicEvent } from "@/lib/eventVisibility";
import { countConfirmedForInstance } from "@/lib/rsvpCapacity";
import { safeTimeZone } from "@/lib/timeZone";
import Link from "next/link";
import { resolvePublicEventAccess } from "@/lib/publicEventAccess";
import { accentStyle, INK_ACCENT } from "@/lib/theme/accent";
import { formatDateBlock, formatDayLong, formatTimeRange, formatDayShort } from "@/lib/format/datetime";
import { recurrenceChip } from "@/lib/format/recurrence";
import { Button } from "@/components/ui/button";
import { Chip, DateBlock, ProgressBar } from "@/components/ui/display";

type Props = { params: Promise<{ orgSlug: string; instanceId: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { orgSlug, instanceId } = await params;
  const org = await prisma.organisation.findUnique({
    where: { slug: orgSlug },
  });
  if (!org) return { title: "Event" };
  const instance = await prisma.eventInstance.findFirst({
    where: {
      id: instanceId,
      series: { organisationId: org.id },
    },
    include: { series: true },
  });
  if (!instance) return { title: "Event" };
  const series = instance.series;
  const noindex = { index: false, follow: false } as const;
  if (!isEventPublished(series.status)) {
    return { title: "Event", robots: noindex };
  }
  if (series.privacyType === EventPrivacyType.INVITE_ONLY) {
    return { title: "Event", robots: noindex };
  }
  if (!shouldIndexPublicEvent(series.status, series.privacyType)) {
    return {
      title: series.title,
      description: series.description.slice(0, 160) || `${series.title} · ${org.name}`,
      robots: noindex,
    };
  }
  const description =
    series.description.slice(0, 160) || `${series.title} · ${org.name}`;
  return {
    title: series.title,
    description,
    openGraph: { title: series.title, description, type: "website" },
  };
}

export default async function InstanceEventPage({ params }: Props) {
  const { orgSlug, instanceId } = await params;
  const org = await prisma.organisation.findUnique({
    where: { slug: orgSlug },
  });
  if (!org) notFound();

  const instance = await prisma.eventInstance.findFirst({
    where: {
      id: instanceId,
      series: { organisationId: org.id },
    },
    include: {
      series: true,
    },
  });
  if (!instance) notFound();

  const series = instance.series;
  const access = await resolvePublicEventAccess({ organisationId: org.id, eventSeriesId: series.id, status: series.status, privacyType: series.privacyType });
  if (!access.allowed) notFound();

  const isPast = instance.endDateTime <= new Date();
  const showRsvp = series.status === EventStatus.PUBLISHED && !isPast;
  const confirmedCount = await countConfirmedForInstance(instance.id);
  const spotsLeft =
    series.capacity != null
      ? Math.max(0, series.capacity - confirmedCount)
      : null;
  const full = spotsLeft !== null && spotsLeft <= 0;
  const timeZone = safeTimeZone(series.timezone);
  const dateBlock = formatDateBlock(instance.startDateTime, timeZone);

  return (
    <div style={accentStyle(INK_ACCENT)} className="yy-accent-scope grid gap-10 md:grid-cols-[minmax(0,1fr)_360px] md:gap-14">
      <article className="flex min-w-0 flex-col gap-5">
        <Link href={`/${org.slug}`} className="text-overline text-ink-muted hover:text-ink">{org.name}</Link>
        <div className="flex flex-wrap gap-1.5">
          <Chip tone="ink" size="sm">{recurrenceChip(series.recurrenceRule)}</Chip>
          {access.preview && series.status !== EventStatus.PUBLISHED ? <Chip tone="warning" size="sm">Draft preview</Chip> : null}
          {series.privacyType === EventPrivacyType.HIDDEN_LINK ? <Chip size="sm">Hidden link</Chip> : null}
          {series.privacyType === EventPrivacyType.INVITE_ONLY ? <Chip size="sm">Invite only</Chip> : null}
          {series.privacyType === EventPrivacyType.APPROVAL_REQUIRED ? <Chip size="sm">Approval required</Chip> : null}
        </div>
        <h1 className="text-display-l break-words text-ink">{series.title}</h1>
        <div className="flex items-center gap-4">
          <DateBlock month={dateBlock.month} day={dateBlock.day} tone="ink" series />
          <div>
            <p className="text-[17px] font-bold text-ink">{formatDayLong(instance.startDateTime, timeZone)}</p>
            <p className="text-body-ui text-ink-secondary">{formatTimeRange(instance.startDateTime, instance.endDateTime, timeZone, { withZone: true })}</p>
          </div>
        </div>
        <div>
          <Button asChild variant="secondary">
            <Link href={`/${org.slug}/i/${instance.id}/schedule`}>
              <Clock aria-hidden className="size-[18px]" />
              View live schedule
              <ArrowRight aria-hidden className="size-4" />
            </Link>
          </Button>
        </div>
        {series.description ? (
          <section aria-labelledby="about-title" className="mt-2">
            <h2 id="about-title" className="mb-2 text-h2 text-ink">About</h2>
            <p className="max-w-[640px] whitespace-pre-wrap text-body-l text-ink-secondary">{series.description}</p>
          </section>
        ) : null}
      </article>

      <aside>
        <section aria-labelledby="join-title" className="flex flex-col gap-4 rounded-xl border border-line bg-canvas p-5 shadow-raised md:sticky md:top-24">
          <div className="flex items-center justify-between gap-2">
            <h2 id="join-title" className="text-h3 text-ink">Join on {formatDayShort(instance.startDateTime, timeZone)}</h2>
            {showRsvp && full ? <Chip tone="warning">Full</Chip> : null}
          </div>
          {showRsvp ? (
            <>
              <div className="flex flex-col gap-2">
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="font-semibold text-ink">{series.capacity != null ? `${confirmedCount} / ${series.capacity} confirmed` : `${confirmedCount} going`}</span>
                  {spotsLeft != null ? <span className="text-ink-muted">{spotsLeft} {spotsLeft === 1 ? "spot" : "spots"} left</span> : null}
                </div>
                {series.capacity != null ? <ProgressBar value={confirmedCount} max={series.capacity} tone="ink" label="Places taken" /> : null}
                {full ? <p className="text-caption text-ink-muted">Join the waitlist below.</p> : null}
              </div>
              <RsvpForm orgSlug={org.slug} eventInstanceId={instance.id} refreshPageOnSave />
            </>
          ) : (
            <p className="text-body-ui text-ink-muted">
              {isPast ? "Registration for this occurrence has ended." : "RSVP opens when the series is published."}
            </p>
          )}
        </section>
      </aside>
    </div>
  );
}
