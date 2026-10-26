import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { CHECK_IN_STATION_COOKIE, hasValidCheckInStationProof } from "@/lib/checkInStation";
import { EventCheckInClient } from "@/components/checkin/EventCheckInClient";
import { CheckInStationUnlock } from "@/components/checkin/CheckInStationUnlock";
import { listRecentCheckIns } from "@/lib/checkInRecent";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Venue check-in", robots: { index: false, follow: false }, referrer: "no-referrer" };

type Props = { params: Promise<{ orgSlug: string; eventSlug: string }> };

export default async function VenueCheckInStationPage({ params }: Props) {
  const { orgSlug, eventSlug } = await params;
  const event = await prisma.event.findFirst({ where: { slug: eventSlug, organisation: { slug: orgSlug } }, include: { organisation: { select: { slug: true, name: true, logoUrl: true } } } });
  // A disabled/missing station deliberately looks identical to an unknown URL.
  if (!event?.checkInStationPinHash) notFound();
  const proof = (await cookies()).get(CHECK_IN_STATION_COOKIE)?.value;
  if (!hasValidCheckInStationProof(proof, event.id, event.checkInStationSecretVersion, event.startDateTime, event.endDateTime)) return <StationFrame><CheckInStationUnlock organisationSlug={orgSlug} eventSlug={eventSlug} /></StationFrame>;
  const [confirmed, checkedIn, recent, form] = await Promise.all([
    prisma.rSVP.count({ where: { eventId: event.id, status: "CONFIRMED" } }),
    prisma.rSVP.count({ where: { eventId: event.id, checkedInAt: { not: null } } }),
    listRecentCheckIns(event.id),
    prisma.eventRegistrationForm.findUnique({ where: { eventId: event.id }, select: { fields: { select: { key: true, label: true }, orderBy: { sortOrder: "asc" } } } }),
  ]);
  return <StationFrame><EventCheckInClient stationMode eventSlug={event.slug} organisationSlug={event.organisation.slug} organisationName={event.organisation.name} organisationLogoUrl={event.organisation.logoUrl} eventId={event.id} eventTitle={event.title} registrationFields={form?.fields ?? []} teamEvent={event.registrationMode === "TEAM"} stats={{ confirmed, checkedIn }} recent={recent.rows} recentNextCursor={recent.nextCursor} attendeeExportHref={null} /></StationFrame>;
}

/** The kiosk has no site chrome (components/chrome/OrganiserChrome.tsx), so the page brings its own gutter. */
function StationFrame({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto w-full max-w-[1160px] px-4 py-6 sm:px-6 sm:py-8">{children}</div>;
}
