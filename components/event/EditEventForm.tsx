"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  EventPrivacyType,
  EventStatus,
  type Event,
} from "@prisma/client";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import MenuItem from "@mui/material/MenuItem";
import Switch from "@mui/material/Switch";
import Alert from "@mui/material/Alert";
import Stack from "@mui/material/Stack";
import Paper from "@mui/material/Paper";
import Box from "@mui/material/Box";
import Divider from "@mui/material/Divider";
import Grid from "@mui/material/Grid";
import Chip from "@mui/material/Chip";
import Typography from "@mui/material/Typography";
import Link from "next/link";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import ImageOutlinedIcon from "@mui/icons-material/ImageOutlined";
import AccessTimeOutlinedIcon from "@mui/icons-material/AccessTimeOutlined";
import PlaceOutlinedIcon from "@mui/icons-material/PlaceOutlined";
import PublicOutlinedIcon from "@mui/icons-material/PublicOutlined";
import { updateEvent, uploadEventCoverImage } from "@/app/actions/event";
import { CoverImagePicker } from "@/components/event/CoverImagePicker";
import { useToast } from "@/components/feedback/ToastProvider";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";
import { AdapterDateFns } from "@mui/x-date-pickers/AdapterDateFns";
import { DateTimePicker } from "@mui/x-date-pickers/DateTimePicker";

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

export function EditEventForm(props: {
  organisationSlug: string;
  event: Event;
}) {
  const { organisationSlug, event } = props;
  const router = useRouter();
  const { showToast } = useToast();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [coverPreviewUrl, setCoverPreviewUrl] = useState(event.coverImageUrl ?? "");
  const [coverImageFile, setCoverImageFile] = useState<File | null>(null);
  const [isOnlinePreview, setIsOnlinePreview] = useState(event.isOnline);
  const [mapLinkPreviewUrl, setMapLinkPreviewUrl] = useState(
    (event as Event & { mapLinkUrl?: string | null }).mapLinkUrl ?? "",
  );
  const [tagsPreview, setTagsPreview] = useState(
    Array.isArray((event as Event & { tags?: string[] }).tags)
      ? ((event as Event & { tags?: string[] }).tags ?? [])
      : [],
  );
  const [showRegistrationCountPreview, setShowRegistrationCountPreview] = useState(
    (event as Event & { showRegistrationCount?: boolean }).showRegistrationCount ??
      true,
  );
  const [start, setStart] = useState<Date | null>(
    event.startDateTime instanceof Date ? event.startDateTime : new Date(event.startDateTime),
  );
  const [end, setEnd] = useState<Date | null>(
    event.endDateTime instanceof Date ? event.endDateTime : new Date(event.endDateTime),
  );

  const [status, setStatus] = useState<EventStatus>(
    event.status === EventStatus.HIDDEN
      ? EventStatus.PUBLISHED
      : event.status
  );
  const [privacyType, setPrivacyType] = useState<EventPrivacyType>(
    event.privacyType
  );

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!start || start < new Date()) {
      setError("Start time must be now or in the future.");
      return;
    }
    if (!end || end <= start) {
      setError("End time must be after start time.");
      return;
    }
    const form = e.currentTarget;
    const fd = new FormData(form);
    const capacityRaw = String(fd.get("capacity") ?? "").trim();
    const status = String(fd.get("status") ?? EventStatus.DRAFT) as EventStatus;
    const privacyType = String(
      fd.get("privacyType") ?? EventPrivacyType.PUBLIC,
    ) as EventPrivacyType;

    startTransition(async () => {
      let coverImageUrl = coverPreviewUrl;
      if (coverImageFile) {
        const uploadData = new FormData();
        uploadData.set("organisationSlug", organisationSlug);
        uploadData.set("file", coverImageFile);
        const upload = await uploadEventCoverImage(uploadData);
        if (!upload.ok) {
          setError(upload.error);
          showToast(upload.error, "error");
          return;
        }
        coverImageUrl = upload.data!.url;
      }
      const res = await updateEvent({
        organisationSlug,
        eventId: event.id,
        title: String(fd.get("title") ?? ""),
        description: String(fd.get("description") ?? ""),
        tags: String(fd.get("tags") ?? ""),
        coverImageUrl,
        showRegistrationCount: fd.get("showRegistrationCount") === "on",
        startDateTime: String(fd.get("startDateTime") ?? ""),
        endDateTime: String(fd.get("endDateTime") ?? ""),
        timezone: String(fd.get("timezone") ?? "UTC"),
        location: String(fd.get("location") ?? ""),
        mapLinkUrl: String(fd.get("mapLinkUrl") ?? ""),
        isOnline: fd.get("isOnline") === "on",
        capacity: capacityRaw,
        status,
        privacyType,
      });
      if (!res.ok) {
        setError(res.error);
        showToast(res.error, "error");
        return;
      }
      showToast("Event saved", "success");
      router.refresh();
    });
  }

  return (
    <>
      <Paper
        variant="outlined"
        sx={{
          p: 2,
          mb: 2,
          display: "flex",
          alignItems: { xs: "stretch", sm: "center" },
          justifyContent: "space-between",
          flexDirection: { xs: "column", sm: "row" },
          gap: 1.5,
        }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="caption" color="text.secondary">
            Public URL
          </Typography>
          <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
            <Link href={`/${organisationSlug}/${event.slug}`}>
              /{organisationSlug}/{event.slug}
            </Link>
          </Typography>
        </Box>
        <Button
          component={Link}
          href={`/${organisationSlug}/${event.slug}`}
          variant="outlined"
          size="small"
          endIcon={<OpenInNewIcon />}
          sx={{ flexShrink: 0, alignSelf: { xs: "flex-start", sm: "center" } }}
        >
          Open event page
        </Button>
      </Paper>
      <form onSubmit={onSubmit}>
        <Stack spacing={2.5}>
          {error ? <Alert severity="error">{error}</Alert> : null}

          <Paper variant="outlined" sx={{ p: 2.5 }}>
            <Stack spacing={2}>
              <Stack
                direction="row"
                spacing={1}
                sx={{ alignItems: "center", justifyContent: "space-between" }}
              >
                <Box>
                  <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                    Basics
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                    Update the public-facing title and description.
                  </Typography>
                </Box>
                <Chip
                  size="small"
                  variant="outlined"
                  color={event.status === EventStatus.DRAFT ? "default" : "success"}
                  label={event.status === EventStatus.DRAFT ? "Draft" : "Published"}
                />
              </Stack>
              <Divider />
              <Grid container spacing={2}>
                <Grid size={{ xs: 12 }}>
                  <TextField
                    name="title"
                    label="Title"
                    required
                    fullWidth
                    defaultValue={event.title}
                  />
                </Grid>
                <Grid size={{ xs: 12 }}>
                  <TextField
                    name="description"
                    label="Description"
                    fullWidth
                    multiline
                    minRows={4}
                    defaultValue={event.description}
                    helperText="A short summary shown on the event page."
                  />
                </Grid>
                <Grid size={{ xs: 12 }}>
                  <TextField
                    name="tags"
                    label="Tags"
                    fullWidth
                    defaultValue={tagsPreview.join(", ")}
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
                      sx={{
                        flexWrap: "wrap",
                        columnGap: 0.75,
                        rowGap: 0.75,
                        pt: 1,
                      }}
                    >
                      {tagsPreview.slice(0, 12).map((t) => (
                        <Chip key={t} size="small" label={t} variant="outlined" />
                      ))}
                    </Stack>
                  ) : null}
                </Grid>
              </Grid>
            </Stack>
          </Paper>

          <Paper variant="outlined" sx={{ p: 2.5 }}>
            <Stack spacing={2}>
              <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                <ImageOutlinedIcon sx={{ color: "text.secondary" }} />
                <Box>
                  <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                    Cover image
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                    Add a visual to make your event page stand out.
                  </Typography>
                </Box>
              </Stack>
              <Divider />
              <CoverImagePicker
                initialUrl={event.coverImageUrl}
                disabled={pending}
                onChange={(file, previewUrl) => {
                  setCoverImageFile(file);
                  setCoverPreviewUrl(previewUrl);
                }}
              />
            </Stack>
          </Paper>

          <Paper variant="outlined" sx={{ p: 2.5 }}>
            <Stack spacing={2}>
              <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                <AccessTimeOutlinedIcon sx={{ color: "text.secondary" }} />
                <Box>
                  <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                    Schedule
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                    Set the date, time, and timezone for guests.
                  </Typography>
                </Box>
              </Stack>
              <Divider />
              <LocalizationProvider dateAdapter={AdapterDateFns}>
                <Grid container spacing={2}>
                  <Grid size={{ xs: 12, md: 4 }}>
                    <DateTimePicker
                      label="Start"
                      value={start}
                      onChange={(v) => setStart(v)}
                      minDateTime={new Date()}
                      slotProps={{
                        textField: {
                          required: true,
                          fullWidth: true,
                        },
                      }}
                    />
                  </Grid>
                  <Grid size={{ xs: 12, md: 4 }}>
                    <DateTimePicker
                      label="End"
                      value={end}
                      onChange={(v) => setEnd(v)}
                      minDateTime={start ?? undefined}
                      slotProps={{
                        textField: {
                          required: true,
                          fullWidth: true,
                        },
                      }}
                    />
                  </Grid>
                  <Grid size={{ xs: 12, md: 4 }}>
                    <TextField
                      name="timezone"
                      label="Timezone"
                      select
                      required
                      fullWidth
                      defaultValue={event.timezone}
                    >
                      {timezones.map((tz) => (
                        <MenuItem key={tz} value={tz}>
                          {tz}
                        </MenuItem>
                      ))}
                    </TextField>
                  </Grid>
                </Grid>
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
            </Stack>
          </Paper>

          <Paper variant="outlined" sx={{ p: 2.5 }}>
            <Stack spacing={2}>
              <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                <PlaceOutlinedIcon sx={{ color: "text.secondary" }} />
                <Box>
                  <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                    Location
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                    Choose whether this is online and what guests should see.
                  </Typography>
                </Box>
              </Stack>
              <Divider />
              <Grid container spacing={2} sx={{ alignItems: "center" }}>
                <Grid size={{ xs: 12, md: 8 }}>
                  <TextField
                    name="location"
                    label={isOnlinePreview ? "Online meeting link" : "Location"}
                    fullWidth
                    required
                    type={isOnlinePreview ? "url" : "text"}
                    defaultValue={event.location}
                    helperText={
                      isOnlinePreview
                        ? "Enter a valid HTTP(S) meeting URL."
                        : "Eg: Samagatha Foundation, Bengaluru"
                    }
                  />
                </Grid>
                <Grid size={{ xs: 12, md: 4 }}>
                  <Paper
                    variant="outlined"
                    sx={{
                      p: 1.5,
                      height: "100%",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 1,
                    }}
                  >
                    <Box>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        Online event
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        Guests will see “Online event”.
                      </Typography>
                    </Box>
                    <Switch
                      name="isOnline"
                      checked={isOnlinePreview}
                      onChange={(_, checked) => setIsOnlinePreview(checked)}
                      slotProps={{ input: { name: "isOnline" } }}
                    />
                  </Paper>
                </Grid>
                <Grid size={{ xs: 12 }}>
                  <TextField
                    name="mapLinkUrl"
                    label="Map link (optional)"
                    fullWidth
                    type="url"
                    defaultValue={
                      (event as Event & { mapLinkUrl?: string | null }).mapLinkUrl ?? ""
                    }
                    disabled={isOnlinePreview}
                    onChange={(e) => setMapLinkPreviewUrl(e.target.value)}
                    helperText={
                      isOnlinePreview
                        ? "Available only for physical events."
                        : "Paste a Google Maps link so guests can open directions."
                    }
                  />
                  {!isOnlinePreview && mapLinkPreviewUrl.trim() ? (
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ display: "block", mt: 0.75 }}
                    >
                      Tip: Use a share link so it opens cleanly on mobile.
                    </Typography>
                  ) : null}
                </Grid>
              </Grid>
            </Stack>
          </Paper>

          <Paper variant="outlined" sx={{ p: 2.5 }}>
            <Stack spacing={2}>
              <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                <PublicOutlinedIcon sx={{ color: "text.secondary" }} />
                <Box>
                  <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                    Publishing
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                    Control visibility, audience, and RSVP limits.
                  </Typography>
                </Box>
              </Stack>
              <Divider />
              <Grid container spacing={2}>
                <Grid size={{ xs: 12, md: 4 }}>
                  <TextField
                    name="status"
                    label="Status"
                    select
                    fullWidth
                    value={status}
                    onChange={(e) => setStatus(e.target.value as EventStatus)}
                    helperText="Drafts are not visible to guests."
                  >
                    <MenuItem value={EventStatus.DRAFT}>Draft</MenuItem>
                    <MenuItem value={EventStatus.PUBLISHED}>Published</MenuItem>
                  </TextField>
                </Grid>
                <Grid size={{ xs: 12, md: 4 }}>
                  <TextField
                    name="privacyType"
                    label="Audience"
                    select
                    fullWidth
                    value={privacyType}
                    onChange={(e) => setPrivacyType(e.target.value as EventPrivacyType)}
                    helperText="Applies when the event is published."
                  >
                    <MenuItem value={EventPrivacyType.PUBLIC}>
                      Public (discoverable)
                    </MenuItem>
                    <MenuItem value={EventPrivacyType.HIDDEN_LINK}>
                      Hidden link (not listed)
                    </MenuItem>
                    <MenuItem value={EventPrivacyType.APPROVAL_REQUIRED}>
                      Approval required
                    </MenuItem>
                    <MenuItem value={EventPrivacyType.INVITE_ONLY}>Invite only</MenuItem>
                  </TextField>
                </Grid>
                <Grid size={{ xs: 12, md: 4 }}>
                  <TextField
                    name="capacity"
                    label="Capacity (optional)"
                    type="number"
                    fullWidth
                    slotProps={{ htmlInput: { min: 1 } }}
                    defaultValue={event.capacity ?? ""}
                    helperText="Leave empty for unlimited RSVPs."
                  />
                </Grid>
                <Grid size={{ xs: 12 }}>
                  <Paper
                    variant="outlined"
                    sx={{
                      p: 1.5,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 1,
                    }}
                  >
                    <Box>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        Show registration count on public page
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        Displays confirmed and total responses to guests.
                      </Typography>
                    </Box>
                    <Switch
                      name="showRegistrationCount"
                      checked={showRegistrationCountPreview}
                      onChange={(_, checked) =>
                        setShowRegistrationCountPreview(checked)
                      }
                      slotProps={{ input: { name: "showRegistrationCount" } }}
                    />
                  </Paper>
                </Grid>
              </Grid>
              <Stack sx={{ alignItems: "flex-start", pt: 0.5 }}>
                <Button type="submit" variant="contained" disabled={pending}>
                  Save changes
                </Button>
              </Stack>
            </Stack>
          </Paper>
        </Stack>
      </form>
    </>
  );
}
