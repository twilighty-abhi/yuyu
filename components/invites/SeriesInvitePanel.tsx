"use client";

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
import { addSeriesInvite, removeSeriesInvite } from "@/app/actions/invites";
import { useToast } from "@/components/feedback/ToastProvider";

export function SeriesInvitePanel(props: {
  organisationSlug: string;
  eventSeriesId: string;
  invites: { id: string; email: string; createdAt: string }[];
}) {
  const { organisationSlug, eventSeriesId, invites } = props;
  const router = useRouter();
  const { showToast } = useToast();
  const [email, setEmail] = useState("");
  const [pending, startTransition] = useTransition();

  return (
    <Stack spacing={2}>
      <Typography variant="body2" color="text.secondary">
        For invite-only series. Emails are matched case-insensitively.
      </Typography>
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={2}
        component="form"
        onSubmit={(e) => {
          e.preventDefault();
          startTransition(async () => {
            const res = await addSeriesInvite({
              organisationSlug,
              eventSeriesId,
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
          fullWidth
          size="small"
        />
        <Button type="submit" variant="contained" disabled={pending}>
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
                  onClick={() => {
                    startTransition(async () => {
                      const res = await removeSeriesInvite({
                        organisationSlug,
                        eventSeriesId,
                        inviteId: inv.id,
                      });
                      if (!res.ok) {
                        showToast(res.error, "error");
                        return;
                      }
                      showToast("Removed", "success");
                      router.refresh();
                    });
                  }}
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
    </Stack>
  );
}
