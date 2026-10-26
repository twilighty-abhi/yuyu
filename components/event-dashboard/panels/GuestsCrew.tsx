"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, ExternalLink, Pencil, Plus, Trash2, Utensils } from "lucide-react";
import { deleteCrewMember, reorderCrewMember, setCrewMemberShown } from "@/app/actions/crew";
import { ConfirmationDialog } from "@/components/feedback/ConfirmationDialog";
import { useToast } from "@/components/feedback/ToastProvider";
import { Button, IconButton } from "@/components/ui/button";
import { Switch } from "@/components/ui/choice";
import { Avatar, Callout, Card, CardHeader, Chip, EmptyState } from "@/components/ui/display";
import { CrewJoinLinkCard } from "@/components/event-dashboard/crew/CrewJoinLinkCard";
import { CrewMemberDialog } from "@/components/event-dashboard/crew/CrewMemberDialog";
import type { OrganiserCrewMember } from "@/lib/core/crew";
import type { DashboardCrew } from "@/lib/eventDashboard/crew";

type Result = { ok: true } | { ok: false; error: string };

/**
 * Guests → Crew (docs/CREW.md): the event's organising team. Each member has
 * a crew ticket for check-in that counts as going but never uses an attendee
 * place. Every change goes through app/actions/crew.ts, which re-checks
 * MANAGE_REGISTRATIONS; this view only decides what to offer.
 */
export function GuestsCrew({ organisationSlug, eventId, origin, crew }: { organisationSlug: string; eventId: string; origin: string; crew: DashboardCrew }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editing, setEditing] = useState<OrganiserCrewMember | "new" | null>(null);
  const [removing, setRemoving] = useState<OrganiserCrewMember | null>(null);
  const scope = { organisationSlug, eventId };
  const { members, food } = crew;
  const joinUrl = crew.joinPath ? `${origin}${crew.joinPath}` : null;
  const awaitingReview = members.filter((member) => member.joinedViaLink && !member.showOnPage).length;

  function run(id: string, action: () => Promise<Result>, success?: string) {
    setBusyId(id);
    startTransition(async () => {
      const res = await action();
      setBusyId(null);
      if (!res.ok) {
        showToast(res.error, "error");
        return;
      }
      if (success) showToast(success, "success");
      router.refresh();
    });
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-h4 text-ink">Crew</h2>
          <p className="text-caption text-ink-muted">
            {members.length === 1 ? "1 crew member" : `${members.length} crew members`}. Crew are counted as going but don&apos;t use up attendee places.
          </p>
        </div>
        <Button variant="primary" startIcon={<Plus />} onClick={() => setEditing("new")}>
          Add crew member
        </Button>
      </div>

      {awaitingReview > 0 ? (
        <Callout tone="info" role="status">
          {awaitingReview === 1 ? "1 person" : `${awaitingReview} people`} joined with the sign-up link and {awaitingReview === 1 ? "is" : "are"} hidden on the event page. Review their details, then switch on &ldquo;Show on event page&rdquo;.
        </Callout>
      ) : null}

      {members.length === 0 ? (
        <EmptyState mood="sleepy" title="No crew yet.">
          Add the people running the event. They get a ticket for check-in, and you can show them on the event page.
        </EmptyState>
      ) : (
        <ul aria-label="Crew members" aria-busy={pending || undefined} className="flex flex-col gap-2.5">
          {members.map((member, index) => (
            <CrewRow
              key={member.id}
              member={member}
              first={index === 0}
              last={index === members.length - 1}
              busy={pending && busyId === member.id}
              disabled={pending}
              onToggleShown={(shown) =>
                run(member.id, () => setCrewMemberShown({ ...scope, memberId: member.id, showOnPage: shown }), shown ? `${member.name} is shown on the event page` : `${member.name} is hidden on the event page`)
              }
              onMove={(direction) => run(member.id, () => reorderCrewMember({ ...scope, memberId: member.id, direction }))}
              onEdit={() => setEditing(member)}
              onRemove={() => setRemoving(member)}
            />
          ))}
        </ul>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card as="section" aria-labelledby="crew-food-title">
          <CardHeader
            title={<span id="crew-food-title">Food for crew</span>}
            titleAs="h3"
            description={members.length === 0 ? "Food preferences appear here once you add crew." : `For ${members.length === 1 ? "1 crew member" : `${members.length} crew members`}. Attendee food answers are not included.`}
          />
          {food.length > 0 ? (
            <ul aria-label="Crew food preferences" className="flex flex-wrap gap-1.5">
              {food.map((entry) => (
                <li key={entry.label}>
                  <Chip size="sm" tone={entry.label === "Not given" ? "outline" : "neutral"} icon={<Utensils />}>
                    {entry.label} {entry.count}
                  </Chip>
                </li>
              ))}
            </ul>
          ) : null}
        </Card>
        <CrewJoinLinkCard organisationSlug={organisationSlug} eventId={eventId} joinUrl={joinUrl} />
      </div>

      <p className="text-caption text-ink-muted">
        To show the crew on your public event page, switch on the Crew section in Event page → Sections. Only members with &ldquo;Show on event page&rdquo; on appear there, without their email or food preference.
      </p>

      <ConfirmationDialog
        open={removing != null}
        title="Remove from the crew?"
        message={`${removing?.name ?? "This person"} will be removed from the crew and their crew ticket will be cancelled, including any check-in.`}
        confirmLabel="Remove"
        loading={pending}
        onCancel={() => setRemoving(null)}
        onConfirm={() => {
          if (!removing) return;
          const member = removing;
          setRemoving(null);
          run(member.id, () => deleteCrewMember({ ...scope, memberId: member.id }), `${member.name} removed from the crew`);
        }}
      />

      {editing ? (
        <CrewMemberDialog
          organisationSlug={organisationSlug}
          eventId={eventId}
          member={editing === "new" ? null : editing}
          foodSuggestions={crew.foodSuggestions}
          onClose={() => setEditing(null)}
          onSaved={(message) => {
            setEditing(null);
            showToast(message, "success");
            router.refresh();
          }}
        />
      ) : null}
    </div>
  );
}

function CrewRow({
  member,
  first,
  last,
  busy,
  disabled,
  onToggleShown,
  onMove,
  onEdit,
  onRemove,
}: {
  member: OrganiserCrewMember;
  first: boolean;
  last: boolean;
  busy: boolean;
  disabled: boolean;
  onToggleShown: (shown: boolean) => void;
  onMove: (direction: -1 | 1) => void;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const switchId = useId();
  const checkedIn = Boolean(member.checkedInAt);
  return (
    <li aria-busy={busy || undefined} className="flex min-w-0 flex-wrap items-center gap-x-3.5 gap-y-2.5 rounded-xl border border-line bg-canvas px-4 py-3">
      <Avatar name={member.name} src={member.photoUrl} size="md" tone={checkedIn ? "success" : "neutral"} />
      <div className="flex min-w-0 flex-[1_1_220px] flex-col">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate font-bold text-ink">{member.name}</span>
          {member.linkedinUrl ? (
            <a href={member.linkedinUrl} target="_blank" rel="noopener noreferrer" className="shrink-0 text-ink-muted hover:text-ink" aria-label={`${member.name} on LinkedIn (opens in a new tab)`}>
              <ExternalLink aria-hidden className="size-3.5" />
            </a>
          ) : null}
        </span>
        <span className="truncate text-caption text-ink-secondary">{member.role || "No role set"}</span>
        <span className="truncate text-caption text-ink-muted">
          {member.email}
          <span aria-hidden> · </span>
          <span className="sr-only">, food preference: </span>
          {member.foodPreference || "Food not given"}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Chip size="sm" tone={checkedIn ? "success" : "outline"}>{checkedIn ? "Checked in" : "Not checked in"}</Chip>
        {member.joinedViaLink && !member.showOnPage ? <Chip size="sm" tone="accent">Joined via link</Chip> : null}
      </div>
      <div className="ml-auto flex flex-wrap items-center justify-end gap-x-3 gap-y-1.5">
        <div className="flex items-center gap-2">
          <label htmlFor={switchId} className="cursor-pointer text-caption font-semibold text-ink-secondary">
            Show on event page
          </label>
          <Switch id={switchId} checked={member.showOnPage} disabled={disabled} onCheckedChange={onToggleShown} />
        </div>
        <div className="flex items-center gap-0.5">
          <IconButton size="sm" label={`Move ${member.name} up`} disabled={disabled || first} onClick={() => onMove(-1)}>
            <ArrowUp />
          </IconButton>
          <IconButton size="sm" label={`Move ${member.name} down`} disabled={disabled || last} onClick={() => onMove(1)}>
            <ArrowDown />
          </IconButton>
          <IconButton size="sm" label={`Edit ${member.name}`} disabled={disabled} onClick={onEdit}>
            <Pencil />
          </IconButton>
          <IconButton size="sm" variant="danger" label={`Remove ${member.name} from the crew`} disabled={disabled} onClick={onRemove}>
            <Trash2 />
          </IconButton>
        </div>
      </div>
    </li>
  );
}
