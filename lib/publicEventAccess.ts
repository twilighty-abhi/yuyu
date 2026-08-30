import "server-only";

import { EventPermission, EventPrivacyType, EventStatus } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { canAccessEvent } from "@/lib/eventAccess";

type Target =
  | { organisationId: string; eventId: string; eventSeriesId?: never }
  | { organisationId: string; eventId?: never; eventSeriesId: string };

type Visibility = Target & {
  status: EventStatus;
  privacyType: EventPrivacyType;
  websiteReleased?: boolean;
};

/** Resolve page access from current database state; URL knowledge is not an invite. */
export async function resolvePublicEventAccess(input: Visibility) {
  const session = await auth();
  const userId = session?.user?.id;
  const eventTarget = input.eventId ? { eventId: input.eventId } : { eventSeriesId: input.eventSeriesId };
  const canPreview = Boolean(userId && (
    await canAccessEvent({
      userId,
      organisationId: input.organisationId,
      ...eventTarget,
      permission: EventPermission.EDIT_DETAILS,
    }) || await canAccessEvent({
      userId,
      organisationId: input.organisationId,
      ...eventTarget,
      permission: EventPermission.PUBLISH_AND_SCHEDULE,
    })
  ));

  const released = input.websiteReleased ?? true;
  if ((input.status !== EventStatus.PUBLISHED || !released) && !canPreview) {
    return { allowed: false, preview: false } as const;
  }

  if (input.privacyType !== EventPrivacyType.INVITE_ONLY || canPreview) {
    return { allowed: true, preview: canPreview } as const;
  }

  if (!userId) return { allowed: false, preview: false } as const;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, emailVerified: true },
  });
  const email = user?.emailVerified ? user.email?.trim().toLowerCase() : null;
  if (!email) return { allowed: false, preview: false } as const;

  const invited = typeof input.eventId === "string"
    ? await prisma.eventInvite.findUnique({
        where: { eventId_email: { eventId: input.eventId, email } },
        select: { id: true },
      })
    : input.eventSeriesId
      ? await prisma.seriesInvite.findUnique({
          where: { eventSeriesId_email: { eventSeriesId: input.eventSeriesId, email } },
          select: { id: true },
        })
      : null;
  return { allowed: Boolean(invited), preview: false } as const;
}
