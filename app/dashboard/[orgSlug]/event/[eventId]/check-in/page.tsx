import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Typography from "@mui/material/Typography";
import Stack from "@mui/material/Stack";
import { prisma } from "@/lib/db";
import { requireOrgRole } from "@/lib/permissions";
import { EventCheckInClient } from "@/components/checkin/EventCheckInClient";
import { CheckInStationSettings } from "@/components/checkin/CheckInStationSettings";
import { getRequestOrigin } from "@/lib/publicUrl";

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
  const { organisation, membership } = await requireOrgRole(orgSlug, "MEMBER");

  const [event, organisationBrand] = await Promise.all([
    prisma.event.findFirst({
      where: { id: eventId, organisationId: organisation.id },
    }),
    prisma.organisation.findUnique({
      where: { id: organisation.id },
      select: { logoUrl: true },
    }),
  ]);
  if (!event) notFound();

  const [confirmed, checkedInCount, recentRsvps, registrationForm] = await Promise.all([
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
    prisma.eventRegistrationForm.findUnique({
      where: { eventId: event.id },
      select: {
        fields: {
          select: { key: true, label: true },
          orderBy: { sortOrder: "asc" },
        },
      },
    }),
  ]);

  const recent = recentRsvps.map((r) => ({
    rsvpId: r.id,
    displayName: labelAttendee(r),
    email: r.user?.email ?? r.guestEmail,
    checkedInAt: r.checkedInAt!.toISOString(),
  }));

  const origin = await getRequestOrigin();
  const stationUrl = `${origin}/${organisation.slug}/${event.slug}/check-in`;
  return (
    <Stack spacing={2}>
      <Typography variant="h5" component="h1" sx={{ fontWeight: 600 }}>
        Check-in · {event.title}
      </Typography>
      <EventCheckInClient
        organisationSlug={organisation.slug}
        organisationName={organisation.name}
        organisationLogoUrl={organisationBrand?.logoUrl ?? null}
        eventId={event.id}
        eventTitle={event.title}
        registrationFields={registrationForm?.fields ?? []}
        stats={{ confirmed, checkedIn: checkedInCount }}
        recent={recent}
      />
      {membership.role === "OWNER" || membership.role === "ADMIN" ? <CheckInStationSettings organisationSlug={organisation.slug} eventId={event.id} stationUrl={stationUrl} enabled={Boolean(event.checkInStationPinHash)} /> : null}
    </Stack>
  );
}
