"use client";

import { EventPermission } from "@prisma/client";
import { useState, useTransition } from "react";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Collapse from "@mui/material/Collapse";
import Divider from "@mui/material/Divider";
import FormControlLabel from "@mui/material/FormControlLabel";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useRouter } from "next/navigation";
import {
  createEventCollaboratorInvite,
  revokeEventCollaborator,
  updateEventCollaboratorPermissions,
} from "@/app/actions/event-collaborators";
import { useToast } from "@/components/feedback/ToastProvider";
import { ConfirmationDialog } from "@/components/feedback/ConfirmationDialog";

const options: Array<[EventPermission, string]> = [
  ["EDIT_DETAILS", "Edit event details"],
  ["MANAGE_REGISTRATIONS", "Manage registrations"],
  ["MANAGE_INVITATIONS", "Manage attendee invites"],
  ["CHECK_IN", "Operate check-in"],
  ["PUBLISH_AND_SCHEDULE", "Publish and manage schedule"],
];
type Collaborator = {
  id: string;
  name: string | null;
  email: string | null;
  permissions: EventPermission[];
};
type PendingInvite = { id: string; email: string; expiresAt: string };

function PermissionCheckboxes({
  selected,
  onChange,
}: {
  selected: EventPermission[];
  onChange: (permissions: EventPermission[]) => void;
}) {
  return (
    <Stack>
      {options.map(([permission, label]) => (
        <FormControlLabel
          key={permission}
          label={label}
          control={
            <Checkbox
              checked={selected.includes(permission)}
              onChange={(_, checked) =>
                onChange(
                  checked
                    ? [...selected, permission]
                    : selected.filter((value) => value !== permission),
                )
              }
            />
          }
        />
      ))}
    </Stack>
  );
}

export function CollaboratorInvitePanel({
  organisationSlug,
  eventId,
  collaborators,
  pendingInvites,
}: {
  organisationSlug: string;
  eventId: string;
  collaborators: Collaborator[];
  pendingInvites: PendingInvite[];
}) {
  const [email, setEmail] = useState("");
  const [selected, setSelected] = useState<EventPermission[]>(["EDIT_DETAILS"]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editedPermissions, setEditedPermissions] = useState<EventPermission[]>(
    [],
  );
  const [pending, startTransition] = useTransition();
  const [revokeTarget, setRevokeTarget] = useState<Collaborator | null>(null);
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
      refreshAfter("Co-organizer invite email queued");
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
      refreshAfter("Co-organizer access removed");
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
      refreshAfter("Co-organizer permissions updated");
    });
  const startEditing = (collaborator: Collaborator) => {
    setEditingId(collaborator.id);
    setEditedPermissions(collaborator.permissions);
  };
  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack spacing={2}>
        <Stack spacing={0.5}>
          <Typography variant="h6">Co-organizers</Typography>
          <Typography variant="body2" color="text.secondary">
            Invite someone to manage only this event. They do not become an
            organisation member.
          </Typography>
        </Stack>
        <Stack spacing={1}>
          <Typography variant="subtitle2">
            Active co-organizers ({collaborators.length})
          </Typography>
          {collaborators.length ? (
            collaborators.map((collaborator) => (
              <Stack key={collaborator.id} spacing={1} sx={{ py: 0.5 }}>
                <Stack
                  direction={{ xs: "column", sm: "row" }}
                  spacing={1}
                  sx={{
                    justifyContent: "space-between",
                    alignItems: { sm: "center" },
                  }}
                >
                  <Stack spacing={0.25}>
                    <Typography>
                      {collaborator.name ||
                        collaborator.email ||
                        "Co-organizer"}
                    </Typography>
                    {collaborator.name && collaborator.email ? (
                      <Typography variant="caption" color="text.secondary">
                        {collaborator.email}
                      </Typography>
                    ) : null}
                    <Typography variant="caption" color="text.secondary">
                      {collaborator.permissions
                        .map(
                          (permission) =>
                            options.find(
                              ([value]) => value === permission,
                            )?.[1] ?? permission,
                        )
                        .join(" · ")}
                    </Typography>
                  </Stack>
                  <Stack direction="row" spacing={0.5}>
                    <Button
                      size="small"
                      onClick={() => startEditing(collaborator)}
                      disabled={pending}
                    >
                      Edit permissions
                    </Button>
                    <Button
                      size="small"
                      color="error"
                      onClick={() => setRevokeTarget(collaborator)}
                      disabled={pending}
                    >
                      Remove
                    </Button>
                  </Stack>
                </Stack>
                <Collapse in={editingId === collaborator.id}>
                  <Stack spacing={1} sx={{ pt: 1 }}>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      Permissions
                    </Typography>
                    <PermissionCheckboxes
                      selected={editedPermissions}
                      onChange={setEditedPermissions}
                    />
                    <Stack direction="row" spacing={1}>
                      <Button
                        size="small"
                        variant="contained"
                        onClick={() => savePermissions(collaborator.id)}
                        disabled={pending || editedPermissions.length === 0}
                      >
                        Save permissions
                      </Button>
                      <Button
                        size="small"
                        onClick={() => setEditingId(null)}
                        disabled={pending}
                      >
                        Cancel
                      </Button>
                    </Stack>
                  </Stack>
                </Collapse>
              </Stack>
            ))
          ) : (
            <Typography variant="body2" color="text.secondary">
              No active co-organizers yet.
            </Typography>
          )}
        </Stack>
        <Stack spacing={1}>
          <Typography variant="subtitle2">
            Pending invitations ({pendingInvites.length})
          </Typography>
          {pendingInvites.length ? (
            pendingInvites.map((invite) => (
              <Stack key={invite.id} spacing={0.25}>
                <Typography variant="body2">{invite.email}</Typography>
                <Typography variant="caption" color="text.secondary">
                  Expires {new Date(invite.expiresAt).toLocaleDateString()}
                </Typography>
              </Stack>
            ))
          ) : (
            <Typography variant="body2" color="text.secondary">
              No pending invitations.
            </Typography>
          )}
        </Stack>
        <Divider />
        <Stack spacing={1}>
          <Typography variant="subtitle2">Invite a co-organizer</Typography>
          <TextField
            label="Email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <PermissionCheckboxes selected={selected} onChange={setSelected} />
          <Button
            disabled={pending || !email || selected.length === 0}
            variant="outlined"
            onClick={invite}
          >
            Invite co-organizer
          </Button>
        </Stack>
      </Stack>
      <ConfirmationDialog
        open={Boolean(revokeTarget)}
        title="Remove co-organizer?"
        message={`${revokeTarget?.name || revokeTarget?.email || "This co-organizer"} will immediately lose access to this event.`}
        confirmLabel="Remove access"
        loading={pending}
        onCancel={() => setRevokeTarget(null)}
        onConfirm={() => revokeTarget && revoke(revokeTarget.id)}
      />
    </Paper>
  );
}
