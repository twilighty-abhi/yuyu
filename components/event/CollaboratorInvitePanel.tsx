"use client";

import type { EventPermission } from "@prisma/client";
import { useState, useTransition } from "react";
import { Check, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { FilterChip } from "@/components/ui/choice";
import { Avatar, Chip } from "@/components/ui/display";
import { Field, Input } from "@/components/ui/field";
import {
  createEventCollaboratorInvite,
  cancelEventCollaboratorInvite,
  revokeEventCollaborator,
  updateEventCollaboratorPermissions,
} from "@/app/actions/event-collaborators";
import { useToast } from "@/components/feedback/ToastProvider";
import { ConfirmationDialog } from "@/components/feedback/ConfirmationDialog";
import {
  PERMISSION_OPTIONS,
  inviteExpiryLabel,
  permissionChipLabels,
  togglePermission,
} from "@/components/event-dashboard/settings/helpers";
import { HelpLink } from "@/components/help/HelpLink";

type Collaborator = {
  id: string;
  name: string | null;
  email: string | null;
  permissions: EventPermission[];
};
type PendingInvite = { id: string; email: string; expiresAt: string; permissions?: EventPermission[] };

/** Toggle chips (aria-pressed) for choosing what a co-organiser can do. */
function PermissionToggles({
  selected,
  onChange,
  label,
  disabled,
}: {
  selected: EventPermission[];
  onChange: (permissions: EventPermission[]) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
      {PERMISSION_OPTIONS.map((option) => {
        const on = selected.includes(option.value);
        return (
          <FilterChip
            key={option.value}
            selected={on}
            title={option.description}
            disabled={disabled}
            onClick={() => onChange(togglePermission(selected, option.value))}
          >
            {on ? <Check aria-hidden /> : <Plus aria-hidden />}
            {option.label}
          </FilterChip>
        );
      })}
    </div>
  );
}

function PermissionChips({ permissions }: { permissions: readonly string[] }) {
  const labels = permissionChipLabels(permissions);
  if (labels.length === 0) return null;
  return (
    <ul aria-label="Permissions" className="flex flex-wrap gap-1.5">
      {labels.map((label) => (
        <li key={label}><Chip size="sm">{label}</Chip></li>
      ))}
    </ul>
  );
}

export function CollaboratorInvitePanel({
  organisationSlug,
  organisationName,
  eventId,
  collaborators,
  pendingInvites,
  now,
}: {
  organisationSlug: string;
  organisationName?: string;
  eventId: string;
  collaborators: Collaborator[];
  pendingInvites: PendingInvite[];
  /** Server time (ISO) so invite expiry text matches between server and browser. */
  now?: string;
}) {
  const [email, setEmail] = useState("");
  const [selected, setSelected] = useState<EventPermission[]>(["EDIT_DETAILS"]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editedPermissions, setEditedPermissions] = useState<EventPermission[]>([]);
  const [pending, startTransition] = useTransition();
  const [revokeTarget, setRevokeTarget] = useState<Collaborator | null>(null);
  const [cancelTarget, setCancelTarget] = useState<PendingInvite | null>(null);
  const { showToast } = useToast();
  const router = useRouter();
  const refreshAfter = (message: string) => {
    showToast(message, "success");
    router.refresh();
  };
  const invite = () =>
    startTransition(async () => {
      const result = await createEventCollaboratorInvite({
        organisationSlug,
        eventId,
        email,
        permissions: selected,
      });
      if (!result.ok) return showToast(result.error, "error");
      setEmail("");
      refreshAfter("Co-organiser invite email queued");
    });
  const revoke = (collaboratorId: string) =>
    startTransition(async () => {
      const result = await revokeEventCollaborator({
        organisationSlug,
        eventId,
        collaboratorId,
      });
      if (!result.ok) return showToast(result.error, "error");
      setRevokeTarget(null);
      refreshAfter("Co-organiser access removed");
    });
  const cancelInvite = (inviteId: string) =>
    startTransition(async () => {
      const result = await cancelEventCollaboratorInvite({ organisationSlug, eventId, inviteId });
      if (!result.ok) return showToast(result.error, "error");
      setCancelTarget(null);
      refreshAfter("Invite cancelled");
    });
  const savePermissions = (collaboratorId: string) =>
    startTransition(async () => {
      const result = await updateEventCollaboratorPermissions({
        organisationSlug,
        eventId,
        collaboratorId,
        permissions: editedPermissions,
      });
      if (!result.ok) return showToast(result.error, "error");
      setEditingId(null);
      refreshAfter("Co-organiser permissions updated");
    });
  const startEditing = (collaborator: Collaborator) => {
    setEditingId(collaborator.id);
    setEditedPermissions(collaborator.permissions);
  };
  const empty = collaborators.length === 0 && pendingInvites.length === 0;

  return (
    <section aria-labelledby="co-organisers-title" className="flex flex-col gap-4 rounded-2xl border border-line bg-canvas p-5 sm:p-6">
      <div>
        <div className="flex items-center gap-1">
          <h2 id="co-organisers-title" className="text-h4 text-ink">Co-organisers</h2>
          <HelpLink article="organisations/co-organisers" />
        </div>
        <p className="mt-0.5 text-body-ui text-ink-muted">
          People who help with just this event. They don&apos;t join {organisationName ?? "your organisation"}.
        </p>
      </div>

      {empty ? (
        <p className="text-body-ui text-ink-muted">No co-organisers yet. Invite someone below.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {collaborators.map((collaborator) => {
            const display = collaborator.name || collaborator.email || "Co-organiser";
            const editing = editingId === collaborator.id;
            return (
              <li key={collaborator.id} className="rounded-xl border border-line px-3.5 py-3">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <Avatar name={display} size="md" />
                  <div className="min-w-0 flex-[1_1_160px]">
                    <p className="truncate font-bold text-ink">{display}</p>
                    {collaborator.name && collaborator.email ? <p className="truncate text-[13px] text-ink-muted">{collaborator.email}</p> : null}
                  </div>
                  <PermissionChips permissions={collaborator.permissions} />
                  <Chip size="sm" tone="success">Active</Chip>
                  <div className="flex shrink-0 gap-1">
                    <Button size="sm" variant="quiet" aria-expanded={editing} aria-label={`Edit permissions for ${display}`} onClick={() => (editing ? setEditingId(null) : startEditing(collaborator))} disabled={pending}>
                      Edit
                    </Button>
                    <Button size="sm" variant="dangerQuiet" aria-label={`Remove ${display}`} onClick={() => setRevokeTarget(collaborator)} disabled={pending}>
                      Remove
                    </Button>
                  </div>
                </div>
                {editing ? (
                  <div className="mt-3 flex flex-col gap-3 rounded-xl bg-subtle p-3.5">
                    <PermissionToggles label={`What ${display} can do`} selected={editedPermissions} onChange={setEditedPermissions} disabled={pending} />
                    {editedPermissions.length === 0 ? <p className="text-caption text-ink-muted">Choose at least one permission.</p> : null}
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="primary" onClick={() => savePermissions(collaborator.id)} disabled={pending || editedPermissions.length === 0}>
                        Save permissions
                      </Button>
                      <Button size="sm" variant="quiet" onClick={() => setEditingId(null)} disabled={pending}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : null}
              </li>
            );
          })}
          {pendingInvites.map((pendingInvite) => (
            <li key={pendingInvite.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-line px-3.5 py-3">
              <Avatar name={pendingInvite.email} size="md" />
              <div className="min-w-0 flex-[1_1_160px]">
                <p className="truncate font-bold text-ink">{pendingInvite.email}</p>
                <p className="text-[13px] text-ink-muted">{inviteExpiryLabel(pendingInvite.expiresAt, now)}</p>
              </div>
              {pendingInvite.permissions ? <PermissionChips permissions={pendingInvite.permissions} /> : null}
              <Chip size="sm" tone="warning">Invited</Chip>
              <Button size="sm" variant="dangerQuiet" aria-label={`Cancel the invite for ${pendingInvite.email}`} onClick={() => setCancelTarget(pendingInvite)} disabled={pending}>
                Cancel invite
              </Button>
            </li>
          ))}
        </ul>
      )}

      <form
        className="flex flex-col gap-3 rounded-xl bg-subtle p-4"
        aria-labelledby="co-organiser-invite-title"
        onSubmit={(event) => {
          event.preventDefault();
          if (!pending && email && selected.length > 0) invite();
        }}
      >
        <h3 id="co-organiser-invite-title" className="text-label text-ink">Invite someone</h3>
        <div className="flex flex-wrap items-start gap-2">
          <Field label="Email" hideLabel className="min-w-0 flex-[1_1_240px]">
            <Input type="email" placeholder="name@example.org" autoComplete="off" value={email} onChange={(event) => setEmail(event.target.value)} />
          </Field>
          <Button type="submit" variant="primary" disabled={pending || !email || selected.length === 0}>
            Send invite
          </Button>
        </div>
        <PermissionToggles label="What they can do" selected={selected} onChange={setSelected} disabled={pending} />
        {selected.length === 0 ? <p className="text-caption text-ink-muted">Choose at least one permission.</p> : null}
      </form>

      <ConfirmationDialog
        open={Boolean(revokeTarget)}
        title="Remove co-organiser?"
        message={`${revokeTarget?.name || revokeTarget?.email || "This co-organiser"} will immediately lose access to this event.`}
        confirmLabel="Remove access"
        loading={pending}
        onCancel={() => setRevokeTarget(null)}
        onConfirm={() => revokeTarget && revoke(revokeTarget.id)}
      />
      <ConfirmationDialog
        open={Boolean(cancelTarget)}
        title="Cancel invite?"
        message={`The invite link sent to ${cancelTarget?.email ?? "this person"} will stop working.`}
        confirmLabel="Cancel invite"
        loading={pending}
        onCancel={() => setCancelTarget(null)}
        onConfirm={() => cancelTarget && cancelInvite(cancelTarget.id)}
      />
    </section>
  );
}
