import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ContentVisibility, EventPermission, EventPrivacyType } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { canAccessEvent } from "@/lib/eventAccess";
import { isEventPublished, shouldIndexPublicEvent } from "@/lib/eventVisibility";
import { countConfirmedForEvent } from "@/lib/rsvpCapacity";
import { EventWebsiteShell } from "@/components/event/EventWebsiteShell";
import { effectiveEventProgram } from "@/lib/eventProgram";

type Props = { params: Promise<{ orgSlug: string; eventSlug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { orgSlug, eventSlug } = await params;
  const org = await prisma.organisation.findUnique({ where: { slug: orgSlug } });
  const event = org ? await prisma.event.findUnique({ where: { organisationId_slug: { organisationId: org.id, slug: eventSlug } } }) : null;
  const page = event ? await prisma.eventPage.findUnique({ where: { eventId: event.id }, select: { isPublished: true } }) : null;
  if (!event || !page?.isPublished || !isEventPublished(event.status) || event.privacyType === EventPrivacyType.INVITE_ONLY) return { title: "Event", robots: { index: false, follow: false } };
  const description = event.description.slice(0, 160) || event.title;
  return { title: event.title, description, alternates: { canonical: `/${org!.slug}/${event.slug}` }, robots: shouldIndexPublicEvent(event.status, event.privacyType) ? undefined : { index: false, follow: false }, openGraph: { title: event.title, description, type: "website", images: event.coverImageUrl ? [{ url: event.coverImageUrl }] : undefined } };
}

export default async function EventPage({ params }: Props) {
  const { orgSlug, eventSlug } = await params;
  const org = await prisma.organisation.findUnique({ where: { slug: orgSlug } });
  if (!org) notFound();
  const event = await prisma.event.findUnique({ where: { organisationId_slug: { organisationId: org.id, slug: eventSlug } } });
  if (!event) notFound();
  const release = await prisma.eventPage.findUnique({ where: { eventId: event.id }, select: { isPublished: true } });
  const userId = (await auth())?.user?.id;
  const preview = Boolean(userId && ((await canAccessEvent({ userId, organisationId: org.id, eventId: event.id, permission: EventPermission.EDIT_DETAILS })) || (await canAccessEvent({ userId, organisationId: org.id, eventId: event.id, permission: EventPermission.PUBLISH_AND_SCHEDULE }))));
  if ((!isEventPublished(event.status) || !release?.isPublished) && !preview) notFound();
  if (event.privacyType === EventPrivacyType.INVITE_ONLY && !preview) {
    const email = (await auth())?.user?.email?.trim().toLowerCase();
    if (!email || !(await prisma.eventInvite.findUnique({ where: { eventId_email: { eventId: event.id, email } }, select: { id: true } }))) notFound();
  }
  const published = preview ? {} : { visibility: ContentVisibility.PUBLISHED };
  const [page, highlights, sessions, speakers, sponsors, faqs, resources, form, confirmed] = await Promise.all([
    prisma.eventPage.findUnique({ where: { eventId: event.id }, include: { sections: { orderBy: { sortOrder: "asc" } } } }),
    prisma.eventHighlight.findMany({ where: { eventId: event.id, ...published }, orderBy: { sortOrder: "asc" } }),
    prisma.eventSession.findMany({ where: { eventId: event.id, ...published }, include: { room: true, speakers: { include: { speaker: true } } }, orderBy: [{ startDateTime: "asc" }, { sortOrder: "asc" }] }),
    prisma.eventSpeaker.findMany({ where: { eventId: event.id, ...published }, orderBy: { sortOrder: "asc" } }),
    prisma.eventSponsor.findMany({ where: { eventId: event.id, ...published }, orderBy: { sortOrder: "asc" } }),
    prisma.eventFaq.findMany({ where: { eventId: event.id, ...published }, orderBy: { sortOrder: "asc" } }),
    prisma.eventResource.findMany({ where: { eventId: event.id, ...published, externalUrl: { not: null } }, orderBy: { sortOrder: "asc" } }),
    prisma.eventRegistrationForm.findUnique({ where: { eventId: event.id }, include: { fields: { orderBy: { sortOrder: "asc" } } } }),
    countConfirmedForEvent(event.id),
  ]);
  const defaults = ["HERO", "ABOUT", "HIGHLIGHTS", "SCHEDULE", "SPEAKERS", "SPONSORS", "VENUE", "FAQ", "RESOURCES"].map((type) => ({ type, isVisible: true }));
  return <EventWebsiteShell
    orgSlug={org.slug} preview={preview}
    event={{ slug: event.slug, title: event.title, coverImageUrl: event.coverImageUrl, location: event.location, isOnline: event.isOnline, status: event.status, start: event.startDateTime.toISOString(), end: event.endDateTime.toISOString(), timezone: event.timezone, capacity: event.capacity }}
    page={{ tagline: page?.tagline ?? "", logoUrl: page?.logoUrl ?? null, accentColor: page?.accentColor ?? null, aboutHtml: page?.aboutHtml || event.description, sections: page?.sections ?? defaults }}
    highlights={highlights}
    sessions={effectiveEventProgram(sessions).map((session) => ({ id: session.id, slug: session.slug, title: session.title, start: session.effectiveStartDateTime.toISOString(), type: session.type, room: session.room?.name ?? null, speakers: session.speakers.map((speaker) => ({ slug: speaker.speaker.slug, name: speaker.speaker.name })) }))}
    speakers={speakers} sponsors={sponsors} venue={event.location || event.mapLinkUrl ? { location: event.location, mapLinkUrl: event.mapLinkUrl } : null}
    faqs={faqs} resources={resources.map((resource) => ({ id: resource.id, title: resource.title, description: resource.description, href: resource.externalUrl! }))}
    registrationFields={(form?.fields ?? []).map((field) => ({ key: field.key, label: field.label, type: field.type, required: field.required, options: Array.isArray(field.options) ? field.options.filter((value): value is string => typeof value === "string") : [] }))}
    confirmedCount={event.showRegistrationCount ? confirmed : null}
  />;
}
