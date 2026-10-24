import { notFound } from "next/navigation";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { DotFace } from "@/components/brand/DotFace";
import { ArrowLeft, ArrowUpRight, CalendarPlus, Check } from "lucide-react";
import { prisma } from "@/lib/db";
import { TicketQrPanel } from "@/components/ticket/TicketQrPanel";
import { CancelRsvpButton } from "@/components/ticket/CancelRsvpButton";
import { TicketDownloadButton } from "@/components/ticket/TicketDownloadButton";
import { TicketStatusStorageSync } from "@/components/ticket/TicketStatusStorageSync";
import { HideAfterLiveCheckIn, LiveCheckedInChip, LiveTicketCard, LiveTicketProvider } from "@/components/ticket/LiveTicket";
import { safeTimeZone } from "@/lib/timeZone";
import { safeHttpUrl } from "@/lib/safeHttpUrl";
import { googleCalendarEventUrl, type CalendarEvent } from "@/lib/calendarInvite";
import { accentStyle, INK_ACCENT } from "@/lib/theme/accent";
import { formatDayShort, formatTime, formatTimeZoneName } from "@/lib/format/datetime";
import { Button } from "@/components/ui/button";
import { Callout, Chip, type ChipTone } from "@/components/ui/display";
import { RegistrationMode, SoloPolicy } from "@prisma/client";
import { auth } from "@/lib/auth";
import {
  listSeekersForSeeker,
  listTeamsLookingForMembers,
  loadMemberTeamView,
  loadSeekerView,
  type TicketHolder,
} from "@/lib/core/teams";
import { TicketSeekerPanel, TicketTeamCard } from "@/components/team/TicketTeamSection";

type Props = {
  params: Promise<{ token: string }>;
};

export const dynamic = "force-dynamic";

function validToken(value: string | undefined) {
  const token = value?.trim() ?? "";
  return /^[A-Za-z0-9_-]{8,128}$/.test(token) ? token : null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { token } = await params;
  const safeToken = validToken(token);
  if (!safeToken) return { title: "Your Ticket", robots: { index: false, follow: false }, referrer: "no-referrer" };
  const rsvp = await prisma.rSVP.findUnique({
    where: { checkInToken: safeToken },
    select: {
      event: { select: { title: true } },
      eventInstance: { select: { series: { select: { title: true } } } },
    },
  });
  const title = rsvp?.event?.title ?? rsvp?.eventInstance?.series?.title;
  return {
    title: title ? `Ticket · ${title}` : "Your Ticket",
    robots: { index: false, follow: false },
    referrer: "no-referrer",
  };
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
      return { label: "Confirmed", tone: "success" as ChipTone };
    case "WAITLISTED":
      return { label: "Waitlisted", tone: "warning" as ChipTone };
    case "PENDING_APPROVAL":
      return { label: "Pending approval", tone: "warning" as ChipTone };
    case "REJECTED":
      return { label: "Rejected", tone: "danger" as ChipTone };
    default:
      return { label: status, tone: "neutral" as ChipTone };
  }
}

export default async function TicketPage({ params }: Props) {
  const { token } = await params;
  const safeToken = validToken(token);
  if (!safeToken) notFound();

  const rsvp = await prisma.rSVP.findUnique({
    where: { checkInToken: safeToken },
    include: {
      user: { select: { name: true } },
      event: {
        select: {
          title: true,
          startDateTime: true,
          endDateTime: true,
          timezone: true,
          location: true,
          mapLinkUrl: true,
          isOnline: true,
          slug: true,
          organisationId: true,
          registrationMode: true,
          soloPolicy: true,
          page: { select: { accentColor: true } },
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

  let orgName: string;
  let orgSlug: string;
  let eventSlug: string | null = null;
  let title: string;
  let start: Date;
  let timeZone: string;
  let location: string | null = null;
  let mapHref: string | null = null;
  let accent: string | null | undefined;
  let calendarEvent: CalendarEvent;

  if (rsvp.eventId && rsvp.event) {
    const ev = rsvp.event;
    orgName = ev.organisation.name;
    orgSlug = ev.organisation.slug;
    eventSlug = ev.slug;
    title = ev.title;
    start = ev.startDateTime;
    timeZone = safeTimeZone(ev.timezone);
    location = ev.location || null;
    mapHref = ev.isOnline ? null : safeHttpUrl(ev.mapLinkUrl);
    accent = ev.page?.accentColor;
    calendarEvent = {
      title: ev.title,
      startDateTime: ev.startDateTime,
      endDateTime: ev.endDateTime,
      timezone: ev.timezone,
      location: ev.location,
    };
  } else if (rsvp.eventInstanceId && rsvp.eventInstance) {
    const inst = rsvp.eventInstance;
    orgName = inst.series.organisation.name;
    orgSlug = inst.series.organisation.slug;
    title = inst.series.title;
    start = inst.startDateTime;
    timeZone = safeTimeZone(inst.series.timezone);
    accent = INK_ACCENT;
    calendarEvent = {
      title: inst.series.title,
      startDateTime: inst.startDateTime,
      endDateTime: inst.endDateTime,
      timezone: inst.series.timezone,
    };
  } else {
    notFound();
  }

  const status = statusLabel(rsvp.status);
  const isCheckedIn = Boolean(rsvp.checkedInAt);

  const confirmed = rsvp.status === "CONFIRMED";
  const name = displayName(rsvp);
  const eventPageHref = eventSlug ? `/${orgSlug}/${eventSlug}` : `/${orgSlug}`;

  // Team section (docs/TEAMS.md). The ticket token identifies a member for
  // viewing their team and for their own leave and seeker actions only; it
  // never grants team management. Like cancellation, an account-owned
  // registration needs that account signed in before anything can change,
  // and the private seeker lists are only shown to someone who can act.
  const teamEvent = rsvp.event?.registrationMode === RegistrationMode.TEAM && rsvp.eventId ? rsvp.event : null;
  let teamSection: ReactNode = null;
  if (teamEvent && rsvp.eventId) {
    const session = await auth();
    const viewerId = session?.user?.id ?? null;
    const canAct = !rsvp.userId || rsvp.userId === viewerId;
    const holder: TicketHolder = {
      rsvpId: rsvp.id,
      eventId: rsvp.eventId,
      organisationId: teamEvent.organisationId,
      userId: rsvp.userId,
      teamId: rsvp.teamId,
    };
    if (rsvp.teamId) {
      const team = await loadMemberTeamView(holder);
      if (team) {
        teamSection = (
          <TicketTeamCard
            ticketToken={rsvp.checkInToken}
            team={team}
            manageHref={team.isLeader && rsvp.userId && rsvp.userId === viewerId ? `/account/teams/${rsvp.teamId}` : null}
            canLeave={canAct && !isCheckedIn && rsvp.status !== "REJECTED"}
            eventPageHref={eventPageHref}
          />
        );
      }
    } else if (teamEvent.soloPolicy === SoloPolicy.SOLO_WITH_MATCHING && rsvp.status !== "REJECTED") {
      if (canAct) {
        const [seekerView, seekers, teams] = await Promise.all([
          loadSeekerView(holder),
          listSeekersForSeeker(holder),
          listTeamsLookingForMembers(holder),
        ]);
        if (seekerView) {
          teamSection = (
            <TicketSeekerPanel
              ticketToken={rsvp.checkInToken}
              profile={seekerView.profile}
              invites={seekerView.invites}
              requests={seekerView.requests}
              seekers={seekers}
              teams={teams}
            />
          );
        }
      } else {
        teamSection = <Callout tone="info">Sign in to the account you registered with to find a team.</Callout>;
      }
    }
  }

  const ticketMain = (
    <>
      <header className="bg-accent px-6 py-5 text-on-accent">
        <p className="text-sm font-semibold opacity-90">{orgName}</p>
        <h1 className="mt-1 break-words font-display text-[26px] font-extrabold leading-tight tracking-[-0.02em] text-on-accent">{title}</h1>
      </header>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 px-6 py-5">
        <div>
          <dt className="text-overline text-ink-muted">Date</dt>
          <dd className="text-[15px] font-bold text-ink">{formatDayShort(start, timeZone)}</dd>
        </div>
        <div>
          <dt className="text-overline text-ink-muted">Time</dt>
          <dd className="text-[15px] font-bold text-ink">{formatTime(start, timeZone)} {formatTimeZoneName(start, timeZone)}</dd>
        </div>
        {location ? (
          <div className="col-span-2">
            <dt className="text-overline text-ink-muted">Venue</dt>
            <dd className="break-words text-[15px] font-bold text-ink">
              {mapHref ? (
                <a
                  href={mapHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline-offset-4 decoration-accent hover:underline focus-visible:underline"
                >
                  {location}
                  <ArrowUpRight aria-hidden className="ml-0.5 inline-block size-4 align-[-2px] text-ink-muted" />
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
              ) : (
                location
              )}
            </dd>
          </div>
        ) : null}
        <div className="col-span-2">
          <dt className="text-overline text-ink-muted">Guest</dt>
          <dd className="break-words text-[15px] font-bold text-ink">{name}</dd>
        </div>
      </dl>
    </>
  );

  return (
    <LiveTicketProvider
      token={rsvp.checkInToken}
      initialCheckedIn={isCheckedIn}
      initialCheckedInAt={rsvp.checkedInAt?.toISOString() ?? null}
      enabled={confirmed && !isCheckedIn}
    >
      <TicketStatusStorageSync checkInToken={rsvp.checkInToken} status={rsvp.status} />
      <div style={accentStyle(accent)} className="yy-accent-scope mx-auto flex w-full max-w-[400px] flex-col gap-4 py-2 sm:py-6">
        <div className="flex items-center justify-between gap-3">
          <Link href={eventPageHref} className="inline-flex min-h-10 items-center gap-1.5 text-[15px] font-semibold text-ink-secondary hover:text-ink">
            <ArrowLeft aria-hidden className="size-4" />
            Event page
          </Link>
          <div className="flex flex-wrap justify-end gap-1.5">
            {isCheckedIn ? <Chip tone="success" icon={<Check />}>Checked in</Chip> : <LiveCheckedInChip />}
            <Chip tone={status.tone} icon={confirmed ? <Check /> : undefined}>{status.label}</Chip>
          </div>
        </div>
        {confirmed ? (
          <div className="flex items-center gap-4">
            <DotFace mood="cheering" size={64} />
            <p className="text-display-m break-words text-ink">You&apos;re in, {name}!</p>
          </div>
        ) : rsvp.status === "WAITLISTED" ? (
          <DotFace mood="waiting" size={64} />
        ) : null}

        {confirmed ? (
          // Once checked in, the QR is never rendered again: the card shows its torn, checked-in state.
          <LiveTicketCard main={ticketMain} stub={isCheckedIn ? null : <TicketQrPanel token={rsvp.checkInToken} />} timeZone={timeZone} />
        ) : (
          <article className="overflow-hidden rounded-xl border border-line bg-canvas shadow-raised">
            {ticketMain}
            <div className="px-6 pb-6">
              <Callout tone={rsvp.status === "REJECTED" ? "danger" : "info"}>
                A scannable ticket will be available after this registration is confirmed.
              </Callout>
            </div>
          </article>
        )}

        {confirmed ? (
          <div className="grid grid-cols-2 gap-3">
            <Button asChild variant="primary" size="lg" fullWidth>
              <a href={googleCalendarEventUrl(calendarEvent)} target="_blank" rel="noreferrer" aria-label={`Add ${title} to Google Calendar`}>
                <CalendarPlus aria-hidden className="size-[18px]" />
                Add to calendar
              </a>
            </Button>
            <TicketDownloadButton downloadUrl={`/api/ticket/${rsvp.checkInToken}/download`} />
          </div>
        ) : null}

        {teamSection}

        {!isCheckedIn && rsvp.status !== "REJECTED" && !rsvp.teamId ? (
          <HideAfterLiveCheckIn>
            <CancelRsvpButton checkInToken={rsvp.checkInToken} eventPageHref={eventPageHref} />
          </HideAfterLiveCheckIn>
        ) : null}
      </div>
    </LiveTicketProvider>
  );
}
