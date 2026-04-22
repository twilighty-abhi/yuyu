"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { EventSeries } from "@prisma/client";
import { EventPrivacyType, EventStatus } from "@prisma/client";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import MenuItem from "@mui/material/MenuItem";
import Alert from "@mui/material/Alert";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { updateEventSeriesMeta, deleteEventSeries } from "@/app/actions/series";
import { useToast } from "@/components/feedback/ToastProvider";

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

export function EditSeriesForm(props: {
  organisationSlug: string;
  series: EventSeries;
}) {
  const { organisationSlug, series } = props;
  const router = useRouter();
  const { showToast } = useToast();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        const fd = new FormData(e.currentTarget);
        const capacityRaw = String(fd.get("capacity") ?? "").trim();
        startTransition(async () => {
          const res = await updateEventSeriesMeta({
            organisationSlug,
            eventSeriesId: series.id,
            title: String(fd.get("title") ?? ""),
            description: String(fd.get("description") ?? ""),
            timezone: String(fd.get("timezone") ?? "UTC"),
            capacity: capacityRaw,
            status: String(fd.get("status") ?? EventStatus.DRAFT) as EventStatus,
            privacyType: String(
              fd.get("privacyType") ?? EventPrivacyType.PUBLIC,
            ) as EventPrivacyType,
          });
          if (!res.ok) {
            setError(res.error);
            showToast(res.error, "error");
            return;
          }
          showToast("Series saved", "success");
          router.refresh();
        });
      }}
    >
      <Stack spacing={2}>
        <Typography variant="body2" color="text.secondary">
          Recurrence is fixed at creation. RRULE:{" "}
          <code style={{ wordBreak: "break-all" }}>{series.recurrenceRule}</code>
        </Typography>
        {error ? <Alert severity="error">{error}</Alert> : null}
        <TextField
          name="title"
          label="Title"
          required
          fullWidth
          defaultValue={series.title}
        />
        <TextField
          name="description"
          label="Description"
          fullWidth
          multiline
          minRows={2}
          defaultValue={series.description}
        />
        <TextField
          name="timezone"
          label="Timezone"
          select
          required
          fullWidth
          defaultValue={series.timezone}
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
          defaultValue={series.capacity ?? ""}
        />
        <TextField
          name="status"
          label="Status"
          select
          fullWidth
          defaultValue={series.status}
        >
          <MenuItem value={EventStatus.DRAFT}>Draft</MenuItem>
          <MenuItem value={EventStatus.PUBLISHED}>Published</MenuItem>
        </TextField>
        <TextField
          name="privacyType"
          label="Audience"
          select
          fullWidth
          defaultValue={series.privacyType}
        >
          <MenuItem value={EventPrivacyType.PUBLIC}>Public</MenuItem>
          <MenuItem value={EventPrivacyType.HIDDEN_LINK}>Hidden link</MenuItem>
          <MenuItem value={EventPrivacyType.APPROVAL_REQUIRED}>
            Approval required
          </MenuItem>
          <MenuItem value={EventPrivacyType.INVITE_ONLY}>Invite only</MenuItem>
        </TextField>
        <Stack direction="row" spacing={2}>
          <Button type="submit" variant="contained" disabled={pending}>
            Save
          </Button>
          <Button
            type="button"
            color="error"
            variant="outlined"
            disabled={pending}
            onClick={() => {
              startTransition(async () => {
                const res = await deleteEventSeries({
                  organisationSlug,
                  eventSeriesId: series.id,
                });
                if (!res.ok) {
                  showToast(res.error, "error");
                  return;
                }
                showToast("Series deleted", "success");
                router.push(`/dashboard/${organisationSlug}`);
              });
            }}
          >
            Delete series
          </Button>
        </Stack>
      </Stack>
    </form>
  );
}
