import { EventPrivacyType, EventStatus } from "@prisma/client";

export function isEventPublished(status: EventStatus): boolean {
  return status === EventStatus.PUBLISHED;
}

/** Listed on /discover and org public page (standalone events). */
export function isDiscoverableEvent(
  status: EventStatus,
  privacyType: EventPrivacyType,
): boolean {
  return status === EventStatus.PUBLISHED && privacyType === EventPrivacyType.PUBLIC;
}

/** Search engines: index only fully public published content. */
export function shouldIndexPublicEvent(
  status: EventStatus,
  privacyType: EventPrivacyType,
): boolean {
  return isDiscoverableEvent(status, privacyType);
}

export function isDiscoverableSeries(
  status: EventStatus,
  privacyType: EventPrivacyType,
): boolean {
  return isDiscoverableEvent(status, privacyType);
}
