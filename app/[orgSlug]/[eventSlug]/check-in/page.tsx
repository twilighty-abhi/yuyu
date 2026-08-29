import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import Stack from "@mui/material/Stack";
import { prisma } from "@/lib/db";
import { CHECK_IN_STATION_COOKIE, hasValidCheckInStationProof } from "@/lib/checkInStation";
import { EventCheckInClient } from "@/components/checkin/EventCheckInClient";
import { CheckInStationUnlock } from "@/components/checkin/CheckInStationUnlock";

type Props = { params: Promise<{ orgSlug: string; eventSlug: string }> };
function label(r: { user: { name: string | null; email: string | null } | null; guestEmail: string | null }) { return r.user?.name?.trim() || r.user?.email || r.guestEmail || "Guest"; }

export default async function VenueCheckInStationPage({ params }: Props) {
  const { orgSlug, eventSlug } = await params;
  const event = await prisma.event.findFirst({ where: { slug: eventSlug, organisation: { slug: orgSlug } }, include: { organisation: { select: { slug: true, name: true, logoUrl: true } } } });
  // A disabled/missing station deliberately looks identical to an unknown URL.
  if (!event?.checkInStationPinHash) notFound();
  const proof = (await cookies()).get(CHECK_IN_STATION_COOKIE)?.value;
  if (!hasValidCheckInStationProof(proof, event.id, event.checkInStationSecretVersion, event.endDateTime)) return <CheckInStationUnlock organisationSlug={orgSlug} eventSlug={eventSlug} />;
  const [confirmed, checkedIn, recentRsvps, form] = await Promise.all([
    prisma.rSVP.count({ where: { eventId: event.id, status: "CONFIRMED" } }),
    prisma.rSVP.count({ where: { eventId: event.id, checkedInAt: { not: null } } }),
    prisma.rSVP.findMany({ where: { eventId: event.id, checkedInAt: { not: null } }, orderBy: { checkedInAt: "desc" }, take: 200, include: { user: { select: { name: true, email: true } } } }),
    prisma.eventRegistrationForm.findUnique({ where: { eventId: event.id }, select: { fields: { select: { key: true, label: true }, orderBy: { sortOrder: "asc" } } } }),
  ]);
  return <Stack spacing={2}><EventCheckInClient stationMode eventSlug={event.slug} organisationSlug={event.organisation.slug} organisationName={event.organisation.name} organisationLogoUrl={event.organisation.logoUrl} eventId={event.id} eventTitle={event.title} registrationFields={form?.fields ?? []} stats={{ confirmed, checkedIn }} recent={recentRsvps.map((r) => ({ rsvpId: r.id, displayName: label(r), email: r.user?.email ?? r.guestEmail, checkedInAt: r.checkedInAt!.toISOString() }))} /></Stack>;
}
