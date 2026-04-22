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
import Alert from "@mui/material/Alert";
import Stack from "@mui/material/Stack";
import { createEventSeries } from "@/app/actions/series";

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

export function CreateSeriesDialog(props: {
  organisationSlug: string;
  canPublish: boolean;
}) {
  const { organisationSlug, canPublish } = props;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <>
      <Button variant="outlined" onClick={() => setOpen(true)}>
        New series
      </Button>
      <Dialog
        open={open}
        onClose={() => !pending && setOpen(false)}
        fullWidth
        maxWidth="sm"
      >
        <form
          onSubmit={(e) => {
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
              const res = await createEventSeries({
                organisationSlug,
                title: String(fd.get("title") ?? ""),
                description: String(fd.get("description") ?? ""),
                anchorStartDateTime: String(fd.get("anchorStartDateTime") ?? ""),
                anchorEndDateTime: String(fd.get("anchorEndDateTime") ?? ""),
                rruleLine: String(fd.get("rruleLine") ?? ""),
                timezone: String(fd.get("timezone") ?? "UTC"),
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
              router.refresh();
              if (res.ok && res.data) {
                router.push(
                  `/dashboard/${organisationSlug}/series/${res.data.id}`,
                );
              }
            });
          }}
        >
          <DialogTitle>Create event series</DialogTitle>
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
                minRows={2}
              />
              <TextField
                name="anchorStartDateTime"
                label="First occurrence start"
                type="datetime-local"
                required
                fullWidth
                slotProps={{ inputLabel: { shrink: true } }}
              />
              <TextField
                name="anchorEndDateTime"
                label="First occurrence end"
                type="datetime-local"
                required
                fullWidth
                slotProps={{ inputLabel: { shrink: true } }}
              />
              <TextField
                name="rruleLine"
                label="Recurrence (RRULE)"
                required
                fullWidth
                placeholder="FREQ=WEEKLY;BYDAY=MO;COUNT=12"
                helperText="RFC 5545 RRULE line without the RRULE: prefix."
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
              <TextField
                name="capacity"
                label="Capacity per occurrence (optional)"
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
                    <MenuItem value={EventPrivacyType.PUBLIC}>Public</MenuItem>
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
              ) : null}
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
