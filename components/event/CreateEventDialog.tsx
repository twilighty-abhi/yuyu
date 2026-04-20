"use client";

import { useState, useTransition } from "react";
import { EventStatus } from "@prisma/client";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import TextField from "@mui/material/TextField";
import MenuItem from "@mui/material/MenuItem";
import FormControlLabel from "@mui/material/FormControlLabel";
import Switch from "@mui/material/Switch";
import Alert from "@mui/material/Alert";
import Stack from "@mui/material/Stack";
import { createEvent } from "@/app/actions/event";

const timezones = [
  "UTC",
  "America/New_York",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Paris",
  "Asia/Kolkata",
  "Asia/Tokyo",
  "Australia/Sydney",
];

export function CreateEventDialog(props: {
  organisationSlug: string;
  canPublish: boolean;
}) {
  const { organisationSlug, canPublish } = props;
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = e.currentTarget;
    const fd = new FormData(form);
    const capacityRaw = String(fd.get("capacity") ?? "").trim();
    const status =
      canPublish && fd.get("status") === "PUBLISHED"
        ? EventStatus.PUBLISHED
        : EventStatus.DRAFT;

    startTransition(async () => {
      const res = await createEvent({
        organisationSlug,
        title: String(fd.get("title") ?? ""),
        description: String(fd.get("description") ?? ""),
        coverImageUrl: String(fd.get("coverImageUrl") ?? ""),
        startDateTime: String(fd.get("startDateTime") ?? ""),
        endDateTime: String(fd.get("endDateTime") ?? ""),
        timezone: String(fd.get("timezone") ?? "UTC"),
        location: String(fd.get("location") ?? ""),
        isOnline: fd.get("isOnline") === "on",
        capacity: capacityRaw,
        status,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setOpen(false);
      form.reset();
    });
  }

  return (
    <>
      <Button variant="contained" onClick={() => setOpen(true)}>
        New event
      </Button>
      <Dialog
        open={open}
        onClose={() => !pending && setOpen(false)}
        fullWidth
        maxWidth="sm"
      >
        <form onSubmit={onSubmit}>
          <DialogTitle>Create event</DialogTitle>
          <DialogContent>
            <Stack spacing={2} sx={{ mt: 1 }}>
              {error ? <Alert severity="error">{error}</Alert> : null}
              <TextField
                name="title"
                label="Title"
                required
                fullWidth
                autoFocus
              />
              <TextField
                name="description"
                label="Description"
                fullWidth
                multiline
                minRows={3}
              />
              <TextField
                name="coverImageUrl"
                label="Cover image URL"
                fullWidth
                type="url"
              />
              <TextField
                name="startDateTime"
                label="Start"
                type="datetime-local"
                required
                fullWidth
                slotProps={{ inputLabel: { shrink: true } }}
              />
              <TextField
                name="endDateTime"
                label="End"
                type="datetime-local"
                required
                fullWidth
                slotProps={{ inputLabel: { shrink: true } }}
              />
              <TextField
                name="timezone"
                label="Timezone"
                select
                required
                fullWidth
                defaultValue="UTC"
              >
                {timezones.map((tz) => (
                  <MenuItem key={tz} value={tz}>
                    {tz}
                  </MenuItem>
                ))}
              </TextField>
              <TextField name="location" label="Location" fullWidth />
              <FormControlLabel
                control={<Switch name="isOnline" />}
                label="Online event"
              />
              <TextField
                name="capacity"
                label="Capacity (optional)"
                type="number"
                fullWidth
                slotProps={{ htmlInput: { min: 1 } }}
              />
              {canPublish ? (
                <TextField
                  name="status"
                  label="Visibility"
                  select
                  fullWidth
                  defaultValue={EventStatus.DRAFT}
                >
                  <MenuItem value={EventStatus.DRAFT}>Draft</MenuItem>
                  <MenuItem value={EventStatus.PUBLISHED}>Published</MenuItem>
                </TextField>
              ) : (
                <Alert severity="info">
                  Events you create stay as drafts until an owner or admin
                  publishes them.
                </Alert>
              )}
            </Stack>
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 2 }}>
            <Button
              type="button"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button type="submit" variant="contained" disabled={pending}>
              Create
            </Button>
          </DialogActions>
        </form>
      </Dialog>
    </>
  );
}
