import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { EventPrivacyType, EventStatus } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { canManageEvents, getMembership } from "@/lib/permissions";
import { isEventPublished, shouldIndexPublicEvent } from "@/lib/eventVisibility";
import { countConfirmedForEvent } from "@/lib/rsvpCapacity";
import { EventPublicShell } from "@/components/event/EventPublicShell";
import { safeTimeZone } from "@/lib/timeZone";
import { isRegistrationClosed } from "@/lib/registrationCutoff";

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
  if (!event) return { title: "Event" };

  const noindex = { index: false, follow: false } as const;

  if (!isEventPublished(event.status)) {
    return { title: "Event", robots: noindex };
  }

  if (event.privacyType === EventPrivacyType.INVITE_ONLY) {
    return { title: "Event", robots: noindex };
  }

  if (!shouldIndexPublicEvent(event.status, event.privacyType)) {
    const description =
      event.description.slice(0, 160) || `${event.title} · ${org.name}`;
    return {
      title: event.title,
      description,
      robots: noindex,
      openGraph: {
        title: event.title,
        description,
        type: "website",
      },
    };
  }

  const description =
    event.description.slice(0, 160) || `${event.title} · ${org.name}`;
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

function formatDateHeading(start: Date, timeZone: string) {
  return start.toLocaleString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone,
  });
}

function formatTimeRange(start: Date, end: Date, timeZone: string) {
  const tOpts: Intl.DateTimeFormatOptions = {
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  };
  return `${start.toLocaleString(undefined, tOpts)} – ${end.toLocaleString(undefined, tOpts)}`;
}

function formatTzLabel(timeZone: string) {
  try {
    const s = new Date().toLocaleString("en-US", {
      timeZone,
      timeZoneName: "short",
    });
    const m = s.match(/GMT[+-][\d:]+|[A-Z]{3,4}(?:\+[\d:]+)?$/);
    return m?.[0] ?? timeZone;
  } catch {
    return timeZone;
  }
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
  });
  if (!event) notFound();

  const session = await auth();
  const membership = session?.user?.id
    ? await getMembership(session.user.id, org.id)
    : null;
  const canPreviewDraft = canManageEvents(membership);
  const canManage = canManageEvents(membership);

  if (!isEventPublished(event.status) && !canPreviewDraft) notFound();
  if (event.privacyType === EventPrivacyType.INVITE_ONLY && !canManage) {
    const email = session?.user?.email?.trim().toLowerCase();
    if (!email) notFound();
    const invite = await prisma.eventInvite.findUnique({
      where: { eventId_email: { eventId: event.id, email } },
      select: { id: true },
    });
    if (!invite) notFound();
  }

  const registrationForm = await prisma.eventRegistrationForm.findUnique({
    where: { eventId: event.id },
    include: { fields: { orderBy: { sortOrder: "asc" } } },
  });
  const registrationFields = (registrationForm?.fields ?? []).map((f) => ({
    key: f.key,
    label: f.label,
    type: f.type,
    required: f.required,
    options: Array.isArray(f.options)
      ? f.options.filter((x): x is string => typeof x === "string")
      : [],
  }));

  const isPast = event.endDateTime <= new Date();
  const showRsvp = event.status === EventStatus.PUBLISHED && !isPast && !isRegistrationClosed(event);
  const confirmedCount = await countConfirmedForEvent(event.id);
  const spotsLeft =
    event.capacity != null
      ? Math.max(0, event.capacity - confirmedCount)
      : null;
  const full = spotsLeft !== null && spotsLeft <= 0;

  // Attendance is private by default. Public pages expose only the aggregate
  // count when the organiser has enabled it, never attendee names or images.
  const avatars: never[] = [];
  const attendeeSummary = event.showRegistrationCount && confirmedCount > 0 ? `${confirmedCount} going` : "";
  const timeZone = safeTimeZone(event.timezone);
  const datePrimary = formatDateHeading(event.startDateTime, timeZone);
  const timeRange = formatTimeRange(
    event.startDateTime,
    event.endDateTime,
    timeZone,
  );
  const tzLabel = formatTzLabel(timeZone);

  return (
    <EventPublicShell
      orgSlug={org.slug}
      orgName={org.name}
      orgDescription={org.description}
      event={{
        id: event.id,
        slug: event.slug,
        title: event.title,
        description: event.description,
        coverImageUrl: event.coverImageUrl,
        location: event.location,
        mapLinkUrl:
          (event as typeof event & { mapLinkUrl?: string | null }).mapLinkUrl ?? null,
        isOnline: event.isOnline,
        timezone: event.timezone,
        status: event.status,
        privacyType: event.privacyType,
        capacity: event.capacity,
        showRegistrationCount:
          (event as typeof event & { showRegistrationCount?: boolean })
            .showRegistrationCount ?? true,
      }}
      confirmedCount={event.showRegistrationCount ? confirmedCount : null}
      showRsvp={showRsvp}
      full={full}
      canManage={canManage}
      isPast={isPast}
      datePrimary={datePrimary}
      timeRange={timeRange}
      tzLabel={tzLabel}
      attendeeSummary={attendeeSummary}
      avatars={avatars}
      registrationFields={registrationFields}
      scheduleUrl={`/${org.slug}/${event.slug}/schedule`}
    />
  );
}
