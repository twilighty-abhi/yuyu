import type { Event } from "@prisma/client";

/** Event data that is safe to serialize into browser component props. */
export type EventClientDto = Omit<Event,
  "checkInStationPinHash" | "checkInStationPinEncrypted" | "checkInStationSecretVersion"
>;

export function toEventClientDto(event: Event): EventClientDto {
  return {
    id: event.id,
    organisationId: event.organisationId,
    title: event.title,
    slug: event.slug,
    description: event.description,
    tags: event.tags,
    showRegistrationCount: event.showRegistrationCount,
    coverImageUrl: event.coverImageUrl,
    startDateTime: event.startDateTime,
    endDateTime: event.endDateTime,
    timezone: event.timezone,
    location: event.location,
    mapLinkUrl: event.mapLinkUrl,
    isOnline: event.isOnline,
    capacity: event.capacity,
    status: event.status,
    privacyType: event.privacyType,
    registrationClosesAt: event.registrationClosesAt,
    registrationLeadMinutes: event.registrationLeadMinutes,
    createdAt: event.createdAt,
  };
}
