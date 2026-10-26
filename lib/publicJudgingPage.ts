import "server-only";

import { cache } from "react";
import type { Metadata } from "next";
import { EventPrivacyType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { isEventPublished, shouldIndexPublicEvent } from "@/lib/eventVisibility";
import { resolvePublicEventAccess } from "@/lib/publicEventAccess";
import { isProjectGalleryVisible } from "@/lib/core/judging";

/*
 * Shared loading for the public hackathon pages (`/{org}/{event}/projects`
 * and `/{org}/{event}/results`, docs/HACKATHON.md). Both apply exactly the
 * event page's visibility, publication, and invite rules first; the judging
 * loaders then decide whether the gallery or results themselves exist.
 */

const loadEvent = cache(async (orgSlug: string, eventSlug: string) => {
  const org = await prisma.organisation.findUnique({ where: { slug: orgSlug }, select: { id: true, slug: true, name: true } });
  if (!org) return null;
  const event = await prisma.event.findUnique({
    where: { organisationId_slug: { organisationId: org.id, slug: eventSlug } },
    select: {
      id: true,
      slug: true,
      title: true,
      status: true,
      privacyType: true,
      listedPublicly: true,
      timezone: true,
      submissionsEnabled: true,
      submissionsCloseAt: true,
      projectGalleryPublic: true,
      resultsPublishedAt: true,
      page: { select: { isPublished: true, accentColor: true } },
    },
  });
  if (!event) return null;
  return { org, event };
});

export type PublicJudgingEvent = NonNullable<Awaited<ReturnType<typeof loadEvent>>>;

/** The event and organisation when the viewer may see the event page; null means a real 404. */
export async function resolvePublicJudgingEvent(orgSlug: string, eventSlug: string): Promise<(PublicJudgingEvent & { preview: boolean }) | null> {
  const loaded = await loadEvent(orgSlug, eventSlug);
  if (!loaded) return null;
  const { org, event } = loaded;
  const access = await resolvePublicEventAccess({
    organisationId: org.id,
    eventId: event.id,
    status: event.status,
    privacyType: event.privacyType,
    websiteReleased: event.page?.isPublished ?? false,
  });
  if (!access.allowed) return null;
  return { org, event, preview: access.preview };
}

/**
 * Metadata for a public judging page, following the event page's rules:
 * nothing about an unreleased, unpublished, or invite-only event, and no
 * indexing unless the event itself may be indexed.
 */
export async function publicJudgingMetadata(
  orgSlug: string,
  eventSlug: string,
  kind: "projects" | "results",
  /**
   * The gallery's page number (each page of the plain gallery is its own
   * canonical URL), and whether a search, filter, or non-default order is
   * applied (on either page). Filtered views point their canonical URL at the
   * plain page, without filter params, and are not indexed.
   */
  listing: { page?: number; filtered?: boolean } = {},
): Promise<Metadata> {
  const label = kind === "projects" ? "Projects" : "Results";
  const loaded = await loadEvent(orgSlug, eventSlug);
  const event = loaded?.event;
  const available = event
    ? kind === "projects"
      ? isProjectGalleryVisible(event)
      : event.submissionsEnabled && event.resultsPublishedAt != null
    : false;
  if (
    !loaded ||
    !event ||
    !available ||
    !event.page?.isPublished ||
    !isEventPublished(event.status) ||
    event.privacyType === EventPrivacyType.INVITE_ONLY
  ) {
    return { title: label, robots: { index: false, follow: false } };
  }
  const title = `${label} · ${event.title}`;
  const description =
    kind === "projects"
      ? `Projects submitted to ${event.title}.`
      : `Awards and winning projects from ${event.title}.`;
  const page = kind === "projects" && listing.page && listing.page > 1 ? Math.floor(listing.page) : 1;
  const canonicalPage = listing.filtered ? 1 : page;
  const indexable = shouldIndexPublicEvent(event.status, event.privacyType, event.listedPublicly);
  return {
    title: page > 1 ? `${title} · Page ${page}` : title,
    description,
    // Searched, filtered, and re-sorted views point at the plain page and are not indexed.
    alternates: { canonical: `/${loaded.org.slug}/${event.slug}/${kind}${canonicalPage > 1 ? `?page=${canonicalPage}` : ""}` },
    robots: !indexable ? { index: false, follow: false } : listing.filtered ? { index: false, follow: true } : undefined,
    // No `openGraph` key here: setting one would replace the event's share
    // image inherited from the parent segment. Next fills the Open Graph
    // title and description from the values above.
  };
}
