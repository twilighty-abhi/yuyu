import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Typography from "@mui/material/Typography";
import Stack from "@mui/material/Stack";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import Paper from "@mui/material/Paper";
import Box from "@mui/material/Box";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getMembership } from "@/lib/permissions";
import { RsvpForm } from "@/components/rsvp/RsvpForm";

type Props = { params: Promise<{ orgSlug: string; eventSlug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { orgSlug, eventSlug } = await params;
  const org = await prisma.organisation.findUnique({
    where: { slug: orgSlug },
  });
  if (!org) return { title: "Event" };
  const event = await prisma.event.findUnique({
    where: {
      organisationId_slug: { organisationId: org.id, slug: eventSlug },
    },
  });
  if (!event || event.status !== "PUBLISHED") {
    return { title: "Event", robots: { index: false, follow: false } };
  }
  const description =
    event.description.slice(0, 160) ||
    `${event.title} · ${org.name}`;
  return {
    title: event.title,
    description,
    openGraph: {
      title: event.title,
      description,
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title: event.title,
      description,
    },
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

export default async function EventPage({ params }: Props) {
  const { orgSlug, eventSlug } = await params;
  const org = await prisma.organisation.findUnique({
    where: { slug: orgSlug },
  });
  if (!org) notFound();

  const event = await prisma.event.findUnique({
    where: {
      organisationId_slug: { organisationId: org.id, slug: eventSlug },
    },
    include: {
      _count: { select: { rsvps: true } },
    },
  });
  if (!event) notFound();

  const session = await auth();
  const membership = session?.user?.id
    ? await getMembership(session.user.id, org.id)
    : null;
  const isMember = membership != null;

  if (event.status !== "PUBLISHED" && !isMember) notFound();

  const showRsvp = event.status === "PUBLISHED";
  const spotsLeft =
    event.capacity != null
      ? Math.max(0, event.capacity - event._count.rsvps)
      : null;
  const full = spotsLeft !== null && spotsLeft <= 0;

  return (
    <Stack spacing={3} sx={{ py: 2, maxWidth: 720 }}>
      {event.coverImageUrl ? (
        <Box
          component="img"
          src={event.coverImageUrl}
          alt=""
          sx={{
            width: "100%",
            maxHeight: 320,
            objectFit: "cover",
            borderRadius: 2,
          }}
        />
      ) : null}
      <Typography variant="overline" color="primary">
        {org.name}
      </Typography>
      <Typography variant="h3" component="h1">
        {event.title}
      </Typography>
      <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap" }}>
        {event.isOnline ? <Chip label="Online" /> : null}
        {event.status === "DRAFT" ? (
          <Chip label="Draft (members only)" color="warning" />
        ) : null}
      </Stack>
      <Typography variant="body1" color="text.secondary">
        {formatLongDate(
          event.startDateTime,
          event.endDateTime,
          event.timezone,
        )}
      </Typography>
      {!event.isOnline && event.location ? (
        <Typography variant="body1">{event.location}</Typography>
      ) : null}
      {event.description ? (
        <Typography variant="body1" sx={{ whiteSpace: "pre-wrap" }}>
          {event.description}
        </Typography>
      ) : null}
      <Divider />
      {showRsvp ? (
        <Paper variant="outlined" sx={{ p: 3 }}>
          <Typography variant="h6" gutterBottom>
            RSVP
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {event.capacity != null
              ? `${event._count.rsvps} / ${event.capacity} registered`
              : `${event._count.rsvps} going`}
          </Typography>
          {full ? (
            <Typography color="error">This event is at capacity.</Typography>
          ) : (
            <RsvpForm orgSlug={org.slug} eventSlug={event.slug} />
          )}
        </Paper>
      ) : (
        <Typography color="text.secondary">
          RSVP opens when the event is published.
        </Typography>
      )}
    </Stack>
  );
}
