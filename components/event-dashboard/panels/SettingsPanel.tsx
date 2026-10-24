import { prisma } from "@/lib/db";
import { toEventClientDto } from "@/lib/eventDto";
import type { EventDashboardContext } from "@/lib/eventDashboard/context";
import { CollaboratorInvitePanel } from "@/components/event/CollaboratorInvitePanel";
import { EventManageMore } from "@/components/dashboard/EventManageMore";
import { loadJudgingSettingsCard } from "@/lib/eventDashboard/judging";
import { JudgingSettingsCard } from "./JudgingPanelSetup";

/**
 * `judgingInUse`: whether the dashboard shows the Judging tab. While it does
 * not, owners and admins turn hackathon submissions on from here
 * (docs/HACKATHON.md); once on, the settings move to the Judging tab.
 */
export async function SettingsPanel({ ctx, judgingInUse = false }: { ctx: EventDashboardContext; judgingInUse?: boolean }) {
  const { event, permissions, organisation } = ctx;
  const judgingCard = !judgingInUse && permissions.canManageJudging ? await loadJudgingSettingsCard(ctx) : null;
  const [collaborators, pending] = permissions.canManageCollaborators
    ? await Promise.all([
        prisma.eventCollaborator.findMany({ where: { eventId: event.id }, include: { user: { select: { name: true, email: true } } }, orderBy: { createdAt: "asc" } }),
        prisma.eventCollaboratorInvite.findMany({ where: { eventId: event.id, usedAt: null, expiresAt: { gt: ctx.now } }, select: { id: true, email: true, expiresAt: true, permissions: true }, orderBy: { createdAt: "desc" } }),
      ])
    : [[], []];
  return (
    <div className="flex flex-col gap-5">
      {permissions.canManageCollaborators ? (
        <CollaboratorInvitePanel
          organisationSlug={organisation.slug}
          organisationName={organisation.name}
          eventId={event.id}
          now={ctx.now.toISOString()}
          collaborators={collaborators.map((c) => ({ id: c.id, name: c.user.name, email: c.user.email, permissions: c.permissions }))}
          pendingInvites={pending.map((invite) => ({ id: invite.id, email: invite.email, expiresAt: invite.expiresAt.toISOString(), permissions: invite.permissions }))}
        />
      ) : null}
      {judgingCard ? <JudgingSettingsCard scope={judgingCard.scope} settings={judgingCard.settings} now={ctx.now.toISOString()} /> : null}
      <EventManageMore organisationSlug={organisation.slug} event={toEventClientDto(event)} />
    </div>
  );
}
