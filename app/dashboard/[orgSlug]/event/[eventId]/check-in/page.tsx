import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Typography from "@mui/material/Typography";
import Stack from "@mui/material/Stack";
import { prisma } from "@/lib/db";
import { requireOrgRole } from "@/lib/permissions";
import { EventCheckInClient } from "@/components/checkin/EventCheckInClient";

type Props = {
  params: Promise<{ orgSlug: string; eventId: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { eventId } = await params;
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { title: true },
  });
  return { title: event ? `Check-in · ${event.title}` : "Check-in" };
}

function labelAttendee(r: {
  user: { name: string | null; email: string | null } | null;
  guestEmail: string | null;
}) {
  const name = r.user?.name?.trim();
  if (name) return name;
  const email = r.user?.email ?? r.guestEmail;
  return email ?? "Guest";
}

export default async function EventCheckInPage({ params }: Props) {
  const { orgSlug, eventId } = await params;
  const { organisation } = await requireOrgRole(orgSlug, "MEMBER");

  const event = await prisma.event.findFirst({
    where: { id: eventId, organisationId: organisation.id },
  });
  if (!event) notFound();

  const [confirmed, checkedInCount, recentRsvps] = await Promise.all([
    prisma.rSVP.count({
      where: { eventId: event.id, status: "CONFIRMED" },
    }),
    prisma.rSVP.count({
      where: { eventId: event.id, checkedInAt: { not: null } },
    }),
    prisma.rSVP.findMany({
      where: { eventId: event.id, checkedInAt: { not: null } },
      orderBy: { checkedInAt: "desc" },
      take: 200,
      include: { user: { select: { name: true, email: true } } },
    }),
  ]);

  const recent = recentRsvps.map((r) => ({
    rsvpId: r.id,
    displayName: labelAttendee(r),
    email: r.user?.email ?? r.guestEmail,
    checkedInAt: r.checkedInAt!.toISOString(),
  }));

  return (
    <Stack spacing={2}>
      <Typography variant="h5" component="h1" sx={{ fontWeight: 600 }}>
        Check-in · {event.title}
      </Typography>
      <EventCheckInClient
        organisationSlug={organisation.slug}
        eventId={event.id}
        eventTitle={event.title}
        stats={{ confirmed, checkedIn: checkedInCount }}
        recent={recent}
      />
    </Stack>
  );
}
