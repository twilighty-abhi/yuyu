import type { RsvpStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { EventDashboardContext } from "@/lib/eventDashboard/context";
import { loadRsvpStatusCounts } from "@/lib/eventDashboard/data";
import { formatRelativeTime } from "@/lib/format/datetime";
import { EventBroadcastPanel } from "@/components/broadcasts/EventBroadcastPanel";
import { loadEventBroadcastDraftForUser } from "@/lib/core/broadcasts";
import { NoPermission } from "./shared";
import { DEFAULT_BROADCAST_DESIGN, isBroadcastDesign } from "@/lib/email/broadcastDesigns";

export async function EmailsPanel({ ctx }: { ctx: EventDashboardContext }) {
  const { event, permissions, organisation, now, userId } = ctx;
  if (!permissions.canSendEmails) return <NoPermission>You do not have permission to email attendees.</NoPermission>;
  const [records, counts, branding, savedDraft] = await Promise.all([
    prisma.eventBroadcast.findMany({
      where: { eventId: event.id },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { id: true, subject: true, body: true, design: true, statuses: true, attendance: true, recipientCount: true, createdAt: true, createdBy: { select: { name: true } } },
    }),
    loadRsvpStatusCounts(event.id),
    prisma.event.findUnique({ where: { id: event.id }, select: { coverImageUrl: true, page: { select: { accentColor: true } } } }),
    // Only the signed-in organiser's own draft, through the composer's own access check.
    loadEventBroadcastDraftForUser(userId, { organisationSlug: organisation.slug, eventId: event.id }),
  ]);
  const brand = { accentColor: branding?.page?.accentColor ?? null, coverImageUrl: branding?.coverImageUrl ?? null };
  const statusCounts: Record<RsvpStatus, number> = {
    CONFIRMED: counts.confirmed,
    WAITLISTED: counts.waitlisted,
    PENDING_APPROVAL: counts.pendingApproval,
    REJECTED: counts.rejected,
  };
  return (
    <EventBroadcastPanel
      organisationSlug={organisation.slug}
      eventId={event.id}
      statusCounts={statusCounts}
      brand={brand}
      draft={savedDraft.ok ? (savedDraft.data?.draft ?? null) : null}
      history={records.map((row) => ({
        id: row.id,
        subject: row.subject,
        body: row.body,
        statuses: row.statuses,
        attendance: row.attendance,
        design: isBroadcastDesign(row.design) ? row.design : DEFAULT_BROADCAST_DESIGN,
        recipientCount: row.recipientCount,
        createdAt: row.createdAt.toISOString(),
        sentLabel: formatRelativeTime(row.createdAt, event.timezone, now),
        createdByName: row.createdBy?.name ?? null,
      }))}
    />
  );
}
