"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { EventPrivacyType, EventStatus } from "@prisma/client";
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
import Fab from "@mui/material/Fab";
import AddIcon from "@mui/icons-material/Add";
import { createEvent } from "@/app/actions/event";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";
import { AdapterDateFns } from "@mui/x-date-pickers/AdapterDateFns";
import { DateTimePicker } from "@mui/x-date-pickers/DateTimePicker";
import Chip from "@mui/material/Chip";

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

function toDatetimeLocalValue(d: Date) {
  const t = new Date(d);
  const off = t.getTimezoneOffset() * 60000;
  return new Date(t.getTime() - off).toISOString().slice(0, 16);
}

export function CreateEventDialog(props: {
  organisationSlug: string;
  canPublish: boolean;
  variant?: "button" | "fab";
}) {
  const { organisationSlug, canPublish, variant = "button" } = props;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [start, setStart] = useState<Date | null>(null);
  const [end, setEnd] = useState<Date | null>(null);
  const [tagsPreview, setTagsPreview] = useState<string[]>([]);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = e.currentTarget;
    const fd = new FormData(form);
    const capacityRaw = String(fd.get("capacity") ?? "").trim();
    let status: EventStatus = EventStatus.DRAFT;
    if (canPublish) {
      const raw = String(fd.get("status") ?? "");
      if (raw === EventStatus.PUBLISHED) status = EventStatus.PUBLISHED;
    }
    const privacyType = String(
      fd.get("privacyType") ?? EventPrivacyType.PUBLIC,
    ) as EventPrivacyType;

    startTransition(async () => {
      const res = await createEvent({
        organisationSlug,
        title: String(fd.get("title") ?? ""),
        description: String(fd.get("description") ?? ""),
        tags: String(fd.get("tags") ?? ""),
        coverImageUrl: String(fd.get("coverImageUrl") ?? ""),
        startDateTime: String(fd.get("startDateTime") ?? ""),
        endDateTime: String(fd.get("endDateTime") ?? ""),
        timezone: String(fd.get("timezone") ?? "Asia/Kolkata"),
        location: String(fd.get("location") ?? ""),
        mapLinkUrl: String(fd.get("mapLinkUrl") ?? ""),
        isOnline: fd.get("isOnline") === "on",
        capacity: capacityRaw,
        status,
        privacyType,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setOpen(false);
      form.reset();
      setTagsPreview([]);
      router.refresh();
    });
  }

  return (
    <>
      {variant === "fab" ? (
        <Fab
          color="primary"
          aria-label="Create event"
          onClick={() => {
            const now = new Date();
            const base = new Date(now);
            base.setMinutes(0, 0, 0);
            base.setHours(base.getHours() + 1);
            setStart(base);
            const e = new Date(base);
            e.setHours(e.getHours() + 1);
            setEnd(e);
            setOpen(true);
          }}
        >
          <AddIcon />
        </Fab>
      ) : (
        <Button
          variant="contained"
          onClick={() => {
            const now = new Date();
            const base = new Date(now);
            base.setMinutes(0, 0, 0);
            base.setHours(base.getHours() + 1);
            setStart(base);
            const e = new Date(base);
            e.setHours(e.getHours() + 1);
            setEnd(e);
            setOpen(true);
          }}
        >
          New event
        </Button>
      )}
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
                name="tags"
                label="Tags"
                fullWidth
                onChange={(e) => {
                  const parts = e.currentTarget.value
                    .split(/[,\n]/g)
                    .map((s) => s.trim().toLowerCase())
                    .map((s) => s.replace(/\s+/g, " "))
                    .filter(Boolean)
                    .slice(0, 12);
                  setTagsPreview(Array.from(new Set(parts)));
                }}
                helperText="Comma-separated (eg: workshop, meetup, ai). Used in global search."
              />
              {tagsPreview.length > 0 ? (
                <Stack
                  direction="row"
                  useFlexGap
                  sx={{ flexWrap: "wrap", columnGap: 0.75, rowGap: 0.75 }}
                >
                  {tagsPreview.slice(0, 12).map((t) => (
                    <Chip key={t} size="small" label={t} variant="outlined" />
                  ))}
                </Stack>
              ) : null}
              <TextField
                name="coverImageUrl"
                label="Cover image URL"
                fullWidth
                type="url"
              />
              <LocalizationProvider dateAdapter={AdapterDateFns}>
                <DateTimePicker
                  label="Start"
                  value={start}
                  onChange={(v) => setStart(v)}
                  slotProps={{
                    textField: {
                      required: true,
                      fullWidth: true,
                      helperText: "Pick date and time",
                    },
                  }}
                />
                <DateTimePicker
                  label="End"
                  value={end}
                  onChange={(v) => setEnd(v)}
                  minDateTime={start ?? undefined}
                  slotProps={{
                    textField: {
                      required: true,
                      fullWidth: true,
                      helperText: "Must be after start",
                    },
                  }}
                />
              </LocalizationProvider>
              <input
                type="hidden"
                name="startDateTime"
                value={start ? toDatetimeLocalValue(start) : ""}
              />
              <input
                type="hidden"
                name="endDateTime"
                value={end ? toDatetimeLocalValue(end) : ""}
              />
              <TextField
                name="timezone"
                label="Timezone"
                select
                required
                fullWidth
                defaultValue="Asia/Kolkata"
              >
                {timezones.map((tz) => (
                  <MenuItem key={tz} value={tz}>
                    {tz}
                  </MenuItem>
                ))}
              </TextField>
              <TextField name="location" label="Location" fullWidth />
              <TextField
                name="mapLinkUrl"
                label="Map link (optional)"
                fullWidth
                type="url"
                helperText="Paste a Google Maps link for directions (physical events only)."
              />
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
                <>
                  <TextField
                    name="status"
                    label="Status"
                    select
                    fullWidth
                    defaultValue={EventStatus.DRAFT}
                  >
                    <MenuItem value={EventStatus.DRAFT}>Draft</MenuItem>
                    <MenuItem value={EventStatus.PUBLISHED}>Published</MenuItem>
                  </TextField>
                  <TextField
                    name="privacyType"
                    label="Audience"
                    select
                    fullWidth
                    defaultValue={EventPrivacyType.PUBLIC}
                  >
                    <MenuItem value={EventPrivacyType.PUBLIC}>
                      Public (discoverable)
                    </MenuItem>
                    <MenuItem value={EventPrivacyType.HIDDEN_LINK}>
                      Hidden link
                    </MenuItem>
                    <MenuItem value={EventPrivacyType.APPROVAL_REQUIRED}>
                      Approval required
                    </MenuItem>
                    <MenuItem value={EventPrivacyType.INVITE_ONLY}>
                      Invite only
                    </MenuItem>
                  </TextField>
                </>
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
