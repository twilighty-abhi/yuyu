import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Typography from "@mui/material/Typography";
import Stack from "@mui/material/Stack";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import Paper from "@mui/material/Paper";
import { EventPrivacyType, EventStatus } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { canManageEvents, getMembership } from "@/lib/permissions";
import { RsvpForm } from "@/components/rsvp/RsvpForm";
import { shouldIndexPublicEvent } from "@/lib/eventVisibility";
import { countConfirmedForInstance } from "@/lib/rsvpCapacity";

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
  if (series.status === EventStatus.DRAFT) {
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

function formatLongDate(start: Date, end: Date, timeZone: string) {
  const dOpts: Intl.DateTimeFormatOptions = {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone,
  };
  const tOpts: Intl.DateTimeFormatOptions = {
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  };
  return `${start.toLocaleString(undefined, dOpts)} · ${start.toLocaleString(undefined, tOpts)} – ${end.toLocaleString(undefined, tOpts)}`;
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
  const session = await auth();
  const membership = session?.user?.id
    ? await getMembership(session.user.id, org.id)
    : null;
  const canPreviewDraft = canManageEvents(membership);

  if (series.status === EventStatus.DRAFT && !canPreviewDraft) notFound();

  const showRsvp = series.status === EventStatus.PUBLISHED;
  const confirmedCount = await countConfirmedForInstance(instance.id);
  const spotsLeft =
    series.capacity != null
      ? Math.max(0, series.capacity - confirmedCount)
      : null;
  const full = spotsLeft !== null && spotsLeft <= 0;

  return (
    <Stack spacing={3} sx={{ py: 2, maxWidth: 720 }}>
      <Typography variant="overline" color="primary">
        {org.name}
      </Typography>
      <Typography variant="h3" component="h1">
        {series.title}
      </Typography>
      <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap" }}>
        <Chip label="Recurring" size="small" variant="outlined" />
        {series.status === EventStatus.DRAFT ? (
          <Chip label="Draft preview" color="warning" />
        ) : null}
        {series.privacyType === EventPrivacyType.HIDDEN_LINK ? (
          <Chip label="Hidden link" size="small" />
        ) : null}
        {series.privacyType === EventPrivacyType.INVITE_ONLY ? (
          <Chip label="Invite only" size="small" />
        ) : null}
        {series.privacyType === EventPrivacyType.APPROVAL_REQUIRED ? (
          <Chip label="Approval required" size="small" />
        ) : null}
      </Stack>
      <Typography variant="body1" color="text.secondary">
        {formatLongDate(
          instance.startDateTime,
          instance.endDateTime,
          series.timezone,
        )}
      </Typography>
      {series.description ? (
        <Typography variant="body1" sx={{ whiteSpace: "pre-wrap" }}>
          {series.description}
        </Typography>
      ) : null}
      <Divider />
      {showRsvp ? (
        <Paper variant="outlined" sx={{ p: 3 }}>
          <Typography variant="h6" gutterBottom>
            RSVP
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {series.capacity != null
              ? `${confirmedCount} / ${series.capacity} confirmed`
              : `${confirmedCount} going`}
            {full ? " · Join waitlist below." : ""}
          </Typography>
          <RsvpForm orgSlug={org.slug} eventInstanceId={instance.id} />
        </Paper>
      ) : (
        <Typography color="text.secondary">
          RSVP opens when the series is published.
        </Typography>
      )}
    </Stack>
  );
}
