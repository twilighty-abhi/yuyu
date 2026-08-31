"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
import Paper from "@mui/material/Paper";
import IconButton from "@mui/material/IconButton";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemText from "@mui/material/ListItemText";
import DeleteOutlineOutlinedIcon from "@mui/icons-material/DeleteOutlineOutlined";
import { addEventInvite, removeEventInvite } from "@/app/actions/invites";
import { useToast } from "@/components/feedback/ToastProvider";
import { ConfirmationDialog } from "@/components/feedback/ConfirmationDialog";

export function EventInvitePanel(props: {
  organisationSlug: string;
  eventId: string;
  eventHasEnded: boolean;
  invites: { id: string; email: string; createdAt: string }[];
}) {
  const { organisationSlug, eventId, eventHasEnded, invites } = props;
  const router = useRouter();
  const { showToast } = useToast();
  const [email, setEmail] = useState("");
  const [pending, startTransition] = useTransition();
  const [removeTarget, setRemoveTarget] = useState<{
    id: string;
    email: string;
  } | null>(null);

  return (
    <Stack spacing={2}>
      <Typography variant="body2" color="text.secondary">
        {eventHasEnded
          ? "This event has ended, so no new invites can be sent."
          : "Required for invite-only events. Emails are matched case-insensitively."}
      </Typography>
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={2}
        component="form"
        onSubmit={(e) => {
          e.preventDefault();
          startTransition(async () => {
            const res = await addEventInvite({
              organisationSlug,
              eventId,
              email,
            });
            if (!res.ok) {
              showToast(res.error, "error");
              return;
            }
            setEmail("");
            showToast("Invite added", "success");
            router.refresh();
          });
        }}
      >
        <TextField
          label="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          disabled={eventHasEnded || pending}
          fullWidth
          size="small"
        />
        <Button
          type="submit"
          variant="contained"
          disabled={eventHasEnded || pending}
        >
          Add
        </Button>
      </Stack>
      {invites.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 3 }}>
          <Typography color="text.secondary">No invites yet.</Typography>
        </Paper>
      ) : (
        <List dense>
          {invites.map((inv) => (
            <ListItem
              key={inv.id}
              secondaryAction={
                <IconButton
                  edge="end"
                  aria-label="Remove"
                  disabled={pending}
                  onClick={() => setRemoveTarget(inv)}
                >
                  <DeleteOutlineOutlinedIcon />
                </IconButton>
              }
            >
              <ListItemText
                primary={inv.email}
                secondary={new Date(inv.createdAt).toLocaleString()}
              />
            </ListItem>
          ))}
        </List>
      )}
      <ConfirmationDialog
        open={Boolean(removeTarget)}
        title="Remove event invite?"
        message={`Remove ${removeTarget?.email ?? "this email"} from the event allowlist?`}
        confirmLabel="Remove invite"
        loading={pending}
        onCancel={() => setRemoveTarget(null)}
        onConfirm={() => {
          if (!removeTarget) return;
          startTransition(async () => {
            const res = await removeEventInvite({
              organisationSlug,
              eventId,
              inviteId: removeTarget.id,
            });
            if (!res.ok) return showToast(res.error, "error");
            setRemoveTarget(null);
            showToast("Invite removed", "success");
            router.refresh();
          });
        }}
      />
    </Stack>
  );
}
