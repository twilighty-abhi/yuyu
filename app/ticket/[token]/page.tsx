import { notFound } from "next/navigation";
import Typography from "@mui/material/Typography";
import Stack from "@mui/material/Stack";
import { prisma } from "@/lib/db";
import { getRequestOrigin } from "@/lib/publicUrl";
import { TicketQrPanel } from "@/components/ticket/TicketQrPanel";

type Props = {
  params: Promise<{ token: string }>;
};

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
  let title: string;
  let when: string;
  let locationLine: string;

  if (rsvp.eventId && rsvp.event) {
    const ev = rsvp.event;
    orgName = ev.organisation.name;
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
    </Stack>
  );
}
