import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Typography from "@mui/material/Typography";
import Stack from "@mui/material/Stack";
import Chip from "@mui/material/Chip";
import { prisma } from "@/lib/db";
import { getRequestOrigin } from "@/lib/publicUrl";
import { TicketQrPanel } from "@/components/ticket/TicketQrPanel";
import { CancelRsvpButton } from "@/components/ticket/CancelRsvpButton";

type Props = {
  params: Promise<{ token: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { token } = await params;
  const rsvp = await prisma.rSVP.findUnique({
    where: { checkInToken: token?.trim() || "" },
    select: {
      event: { select: { title: true } },
      eventInstance: { select: { series: { select: { title: true } } } },
    },
  });
  const title = rsvp?.event?.title ?? rsvp?.eventInstance?.series?.title;
  return { title: title ? `Ticket · ${title}` : "Your Ticket" };
}

function displayName(r: {
  user: { name: string | null } | null;
  guestName?: string | null;
  guestEmail: string | null;
}) {
  const n = r.user?.name?.trim();
  if (n) return n;
  const gn = r.guestName?.trim();
  if (gn) return gn;
  if (r.guestEmail) return r.guestEmail.split("@")[0] ?? "Guest";
  return "Guest";
}

function statusLabel(status: string) {
  switch (status) {
    case "CONFIRMED":
      return { label: "Confirmed", color: "success" as const };
    case "WAITLISTED":
      return { label: "Waitlisted", color: "warning" as const };
    case "PENDING_APPROVAL":
      return { label: "Pending Approval", color: "info" as const };
    case "REJECTED":
      return { label: "Rejected", color: "error" as const };
    default:
      return { label: status, color: "default" as const };
  }
}

export default async function TicketPage({ params }: Props) {
  const { token } = await params;
  if (!token?.trim()) notFound();

  const rsvp = await prisma.rSVP.findUnique({
    where: { checkInToken: token.trim() },
    include: {
      user: { select: { name: true } },
      event: {
        select: {
          title: true,
          startDateTime: true,
          endDateTime: true,
          timezone: true,
          location: true,
          slug: true,
          organisation: { select: { slug: true, name: true } },
        },
      },
      eventInstance: {
        select: {
          startDateTime: true,
          endDateTime: true,
          series: {
            select: {
              title: true,
              timezone: true,
              organisation: { select: { slug: true, name: true } },
            },
          },
        },
      },
    },
  });

  if (!rsvp) notFound();

  const origin = await getRequestOrigin();

  let orgName: string;
  let orgSlug: string;
  let eventSlug: string | null = null;
  let title: string;
  let when: string;
  let locationLine: string;

  if (rsvp.eventId && rsvp.event) {
    const ev = rsvp.event;
    orgName = ev.organisation.name;
    orgSlug = ev.organisation.slug;
    eventSlug = ev.slug;
    title = ev.title;
    when = ev.startDateTime.toLocaleString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: ev.timezone,
      timeZoneName: "short",
    });
    locationLine = ev.location ? ` · ${ev.location}` : "";
  } else if (rsvp.eventInstanceId && rsvp.eventInstance) {
    const inst = rsvp.eventInstance;
    const tz = inst.series.timezone;
    orgName = inst.series.organisation.name;
    orgSlug = inst.series.organisation.slug;
    title = inst.series.title;
    when = inst.startDateTime.toLocaleString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: tz,
      timeZoneName: "short",
    });
    locationLine = "";
  } else {
    notFound();
  }

  const status = statusLabel(rsvp.status);
  const isCheckedIn = Boolean(rsvp.checkedInAt);

  return (
    <Stack
      spacing={3}
      sx={{
        maxWidth: 440,
        mx: "auto",
        py: { xs: 3, sm: 5 },
        px: 2,
      }}
    >
      <Typography variant="overline" color="text.secondary">
        {orgName}
      </Typography>
      <Typography variant="h5" component="h1" sx={{ fontWeight: 700 }}>
        {title}
      </Typography>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
        <Chip label={status.label} color={status.color} size="small" variant="outlined" />
        {isCheckedIn ? (
          <Chip label="Checked In" color="success" size="small" />
        ) : null}
      </Stack>
      <Typography variant="body1" color="text.secondary">
        {when}
        {locationLine}
      </Typography>
      <Typography variant="body2">
        {displayName(rsvp)}
      </Typography>

      <TicketQrPanel token={rsvp.checkInToken} />

      <Typography variant="caption" color="text.secondary" sx={{ wordBreak: "break-all" }}>
        Ticket link: {origin}/ticket/{rsvp.checkInToken}
      </Typography>

      {!isCheckedIn && rsvp.status !== "REJECTED" ? (
        <CancelRsvpButton
          checkInToken={rsvp.checkInToken}
          eventPageHref={eventSlug ? `/${orgSlug}/${eventSlug}` : `/${orgSlug}`}
        />
      ) : null}
    </Stack>
  );
}
