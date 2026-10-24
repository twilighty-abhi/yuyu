import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, MapPin, UsersRound, Video } from "lucide-react";
import { EventStatus, RegistrationMode, RsvpStatus } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { resolvePublicEventAccess } from "@/lib/publicEventAccess";
import { loadJoinPageTeam } from "@/lib/core/teams";
import { isTeamTokenShape } from "@/lib/teamToken";
import { publicTeamRegistrationConfig } from "@/lib/publicTeamConfig";
import { isRegistrationClosed } from "@/lib/registrationCutoff";
import { toFieldDefinition } from "@/lib/registrationFields";
import { safeTimeZone } from "@/lib/timeZone";
import { accentStyle } from "@/lib/theme/accent";
import { formatDateBlock, formatDayLong, formatTimeRange } from "@/lib/format/datetime";
import { RsvpForm } from "@/components/rsvp/RsvpForm";
import {
  JoinWithAccountRegistration,
  JoinWithSavedTicket,
  type JoinPageRegistration,
} from "@/components/team/JoinTeamWithRegistration";
import { Button } from "@/components/ui/button";
import { Callout, Chip, DateBlock } from "@/components/ui/display";

type Props = { params: Promise<{ orgSlug: string; eventSlug: string; joinToken: string }> };

// The join token is a capability: never cache or index this page, and keep
// its URL out of Referer headers.
export const dynamic = "force-dynamic";

/** Deliberately generic: metadata never reveals the event or the team. */
export async function generateMetadata(): Promise<Metadata> {
  return {
    title: "Join a team",
    robots: { index: false, follow: false },
    referrer: "no-referrer",
  };
}

/**
 * Team join link (docs/TEAMS.md): `/{orgSlug}/{eventSlug}/team/{joinToken}`.
 * Access is resolved exactly as on the event page (publication, website
 * release, privacy and invite-only, organiser preview), so the link never
 * reveals an event its holder could not otherwise see. Unknown, retired and
 * other events' tokens share the same 404. The page shows only the team's
 * name, size and maximum size, never its members.
 *
 * Someone already registered can join with that registration instead of
 * registering again: a signed-in person's own registration is detected here,
 * and a guest's ticket remembered by this browser on the client. Guests can
 * also paste the link on their ticket page.
 */
export default async function TeamJoinPage({ params }: Props) {
  const { orgSlug, eventSlug, joinToken } = await params;
  if (!isTeamTokenShape(joinToken)) notFound();
  const org = await prisma.organisation.findUnique({
    where: { slug: orgSlug },
  });
  if (!org) notFound();
  const event = await prisma.event.findUnique({
    where: { organisationId_slug: { organisationId: org.id, slug: eventSlug } },
  });
  if (!event) notFound();
  const release = await prisma.eventPage.findUnique({
    where: { eventId: event.id },
    select: { isPublished: true, accentColor: true },
  });
  const access = await resolvePublicEventAccess({
    organisationId: org.id,
    eventId: event.id,
    status: event.status,
    privacyType: event.privacyType,
    websiteReleased: release?.isPublished ?? false,
  });
  if (!access.allowed) notFound();
  if (event.registrationMode !== RegistrationMode.TEAM) notFound();
  const team = await loadJoinPageTeam(event.id, joinToken);
  if (!team) notFound();
  const registration = await signedInRegistration(event.id, joinToken);
  const teamConfig = publicTeamRegistrationConfig(event);
  if (!teamConfig) notFound();

  const form = await prisma.eventRegistrationForm.findUnique({
    where: { eventId: event.id },
    include: { fields: { orderBy: { sortOrder: "asc" } } },
  });

  const registrationOpen =
    event.status === EventStatus.PUBLISHED &&
    event.endDateTime > new Date() &&
    !isRegistrationClosed(event);
  const teamFull = team.maxSize != null && team.size >= team.maxSize;
  // Only promise "register below" when the form is actually shown.
  const showsForm = event.status !== EventStatus.CANCELLED && !registration && registrationOpen && !teamFull;
  const existingRegistrationHint = (
    <p className="text-caption text-ink-muted">
      Already registered on your own? Open your ticket page (the link is in your confirmation email) and paste this team link under <span className="font-semibold">Join a team</span>.
    </p>
  );
  const timeZone = safeTimeZone(event.timezone);
  const dateBlock = formatDateBlock(event.startDateTime, timeZone);
  const eventHref = `/${org.slug}/${event.slug}`;

  return (
    <div style={accentStyle(release?.accentColor)} className="yy-accent-scope grid gap-10 md:grid-cols-[minmax(0,1fr)_400px] md:gap-14">
      <article className="flex min-w-0 flex-col gap-5">
        <Link href={eventHref} className="inline-flex items-center gap-1.5 text-overline text-ink-muted hover:text-ink">
          <ArrowLeft aria-hidden className="size-4" />
          {org.name}
        </Link>
        <div className="flex flex-wrap gap-1.5">
          <Chip tone="accent" size="sm" icon={<UsersRound aria-hidden className="size-3.5" />}>Team invitation</Chip>
          {access.preview && event.status !== EventStatus.PUBLISHED ? <Chip tone="warning" size="sm">Draft preview</Chip> : null}
          {event.status === EventStatus.CANCELLED ? <Chip tone="danger" size="sm">Cancelled</Chip> : null}
        </div>
        <h1 className="text-display-l break-words text-ink">{event.title}</h1>
        <div className="flex items-center gap-4">
          <DateBlock month={dateBlock.month} day={dateBlock.day} />
          <div>
            <p className="text-[17px] font-bold text-ink">{formatDayLong(event.startDateTime, timeZone)}</p>
            <p className="text-body-ui text-ink-secondary">{formatTimeRange(event.startDateTime, event.endDateTime, timeZone, { withZone: true })}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span aria-hidden className="flex size-10 items-center justify-center rounded-md bg-muted text-ink">
            {event.isOnline ? <Video className="size-5" /> : <MapPin className="size-5" />}
          </span>
          <p className="text-[15px] font-semibold text-ink">{event.isOnline ? "Online event" : event.location || "Venue details coming soon"}</p>
        </div>
        <p className="max-w-[640px] text-body-l text-ink-secondary">
          You’ve been invited to join <span className="font-semibold text-ink">{team.name}</span> for this event.{showsForm ? " Register below and you’ll be on the team straight away." : null}
        </p>
        <div>
          <Button asChild variant="secondary">
            <Link href={eventHref}>View the event page</Link>
          </Button>
        </div>
      </article>

      <aside>
        <section aria-labelledby="team-join-title" className="flex flex-col gap-4 rounded-xl border border-line bg-canvas p-5 shadow-raised md:sticky md:top-24">
          <h2 id="team-join-title" className="text-h3 text-ink">Join {team.name}</h2>
          {event.status === EventStatus.CANCELLED ? (
            <Callout tone="danger" title="Event cancelled" />
          ) : registration ? (
            // Moving an existing registration into a team adds no place, so it
            // doesn't depend on new registrations being open.
            <JoinWithAccountRegistration registration={registration} joinToken={joinToken} teamName={team.name} />
          ) : !registrationOpen ? (
            <>
              <p className="text-body-ui text-ink-muted">Registration is closed.</p>
              {/* Moving an existing registration into the team still works after registration closes (docs/TEAMS.md). */}
              {event.endDateTime > new Date() && !teamFull ? existingRegistrationHint : null}
            </>
          ) : teamFull ? (
            <Callout tone="warning" title="This team is full">
              Ask the team leader to make room, then open this link again.
            </Callout>
          ) : (
            <>
              <JoinWithSavedTicket orgSlug={org.slug} eventSlug={event.slug} joinToken={joinToken} teamName={team.name} />
              <RsvpForm
                orgSlug={org.slug}
                eventSlug={event.slug}
                registrationFields={(form?.fields ?? []).map(toFieldDefinition)}
                team={{ ...teamConfig, joinTeam: { joinToken, name: team.name, size: team.size, maxSize: team.maxSize } }}
              />
              {existingRegistrationHint}
            </>
          )}
        </section>
      </aside>
    </div>
  );
}

/**
 * The signed-in person's own registration for this event, if any, and how it
 * relates to the team behind this join link. Only their own ticket token is
 * returned, never anyone else's.
 */
async function signedInRegistration(eventId: string, joinToken: string): Promise<JoinPageRegistration | null> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return null;
  const rsvp = await prisma.rSVP.findFirst({
    where: { eventId, userId },
    select: { checkInToken: true, status: true, teamId: true, team: { select: { joinToken: true } } },
    orderBy: { createdAt: "asc" },
  });
  if (!rsvp) return null;
  const ticketToken = rsvp.checkInToken;
  if (rsvp.teamId) return { state: rsvp.team?.joinToken === joinToken ? "this-team" : "other-team", ticketToken };
  if (rsvp.status === RsvpStatus.REJECTED) return { state: "declined", ticketToken };
  return { state: "solo", ticketToken };
}
