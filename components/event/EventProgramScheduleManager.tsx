"use client";

import { useState, useTransition, type FormEvent } from "react";
import {
  Alert,
  Autocomplete,
  Button,
  Divider,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useRouter } from "next/navigation";
import {
  deleteWebsiteContent,
  saveSession,
  setEventSessionDelay,
} from "@/app/actions/event-website";
import { ConfirmationDialog } from "@/components/feedback/ConfirmationDialog";

export type ProgramScheduleRow = {
  id: string;
  title: string;
  startDateTime: string;
  endDateTime: string;
  effectiveStartDateTime: string;
  effectiveEndDateTime: string;
  type: string;
  track: string | null;
  roomId: string | null;
  visibility: string;
  sortOrder: number;
  speakerIds: string[];
  speakerNames?: string[];
  delayMinutes: number;
  cumulativeDelayMinutes: number;
};
const types = [
  "KEYNOTE",
  "TALK",
  "PANEL",
  "WORKSHOP",
  "FIRESIDE_CHAT",
  "NETWORKING",
  "BREAK",
  "OTHER",
];

function localValue(iso: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const get = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}
function zonedInputToIso(value: string, timeZone: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) return "";
  const [, y, m, d, h, min] = match;
  const guess = Date.UTC(
    Number(y),
    Number(m) - 1,
    Number(d),
    Number(h),
    Number(min),
  );
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(guess));
  const get = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  const offset =
    Date.UTC(
      get("year"),
      get("month") - 1,
      get("day"),
      get("hour"),
      get("minute"),
    ) - guess;
  return new Date(guess - offset).toISOString();
}
function display(iso: string, timeZone: string) {
  return new Date(iso).toLocaleString(undefined, {
    timeZone,
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function EventProgramScheduleManager({
  organisationSlug,
  eventId,
  eventStart,
  timeZone,
  sessions,
  speakers,
}: {
  organisationSlug: string;
  eventId: string;
  eventStart: string;
  timeZone: string;
  sessions: ProgramScheduleRow[];
  speakers: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [selectedSpeakerIds, setSelectedSpeakerIds] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [removeTarget, setRemoveTarget] = useState<ProgramScheduleRow | null>(
    null,
  );
  const nextSessionStart = sessions.at(-1)?.endDateTime ?? eventStart;
  const complete = (
    result: { ok: boolean; error?: string },
    close?: () => void,
  ) => {
    if (!result.ok) setError(result.error || "Could not save the programme.");
    else {
      setError("");
      close?.();
      router.refresh();
    }
  };
  const submit = (
    event: FormEvent<HTMLFormElement>,
    session?: ProgramScheduleRow,
  ) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    startTransition(async () =>
      complete(
        await saveSession({
          organisationSlug,
          eventId,
          ...(session ? { id: session.id } : {}),
          speakerIds: selectedSpeakerIds,
          title: String(form.get("title") ?? ""),
          startDateTime: zonedInputToIso(
            String(form.get("start") ?? ""),
            timeZone,
          ),
          endDateTime: zonedInputToIso(String(form.get("end") ?? ""), timeZone),
          type: String(form.get("type") ?? "TALK"),
          track: String(form.get("track") ?? ""),
          roomId: session?.roomId ?? "",
          visibility: String(form.get("visibility") ?? "PUBLISHED"),
          sortOrder: Number(form.get("sortOrder") ?? sessions.length),
        }),
        () => {
          setEditing(null);
          setAdding(false);
          setSelectedSpeakerIds([]);
        },
      ),
    );
  };
  const updateDelay = (sessionId: string, delayMinutes: number) =>
    startTransition(async () =>
      complete(
        await setEventSessionDelay({
          organisationSlug,
          eventId,
          sessionId,
          delayMinutes,
        }),
      ),
    );
  const remove = (id: string) =>
    startTransition(async () =>
      complete(
        await deleteWebsiteContent({
          organisationSlug,
          eventId,
          kind: "session",
          id,
        }),
      ),
    );
  const fields = (session?: ProgramScheduleRow) => (
    <>
      <TextField
        name="title"
        label="Session title"
        defaultValue={session?.title ?? ""}
        required
      />
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
        <TextField
          name="start"
          label="Planned start"
          type="datetime-local"
          defaultValue={
            session
              ? localValue(session.startDateTime, timeZone)
              : localValue(nextSessionStart, timeZone)
          }
          slotProps={{ inputLabel: { shrink: true } }}
          required
          fullWidth
        />
        <TextField
          name="end"
          label="Planned end"
          type="datetime-local"
          defaultValue={
            session ? localValue(session.endDateTime, timeZone) : ""
          }
          slotProps={{ inputLabel: { shrink: true } }}
          required
          fullWidth
        />
      </Stack>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
        <TextField
          name="type"
          label="Type"
          select
          defaultValue={session?.type ?? "TALK"}
          fullWidth
        >
          {types.map((type) => (
            <MenuItem key={type} value={type}>
              {type.replaceAll("_", " ")}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          name="track"
          label="Track"
          defaultValue={session?.track ?? ""}
          fullWidth
        />
      </Stack>
      <Autocomplete
        multiple
        options={speakers}
        value={speakers.filter((speaker) => selectedSpeakerIds.includes(speaker.id))}
        onChange={(_, selected) =>
          setSelectedSpeakerIds(selected.map((speaker) => speaker.id))
        }
        getOptionLabel={(speaker) => speaker.name}
        isOptionEqualToValue={(option, value) => option.id === value.id}
        renderInput={(params) => (
          <TextField
            {...params}
            label="Speakers"
            helperText={
              speakers.length
                ? "Select every speaker appearing in this session."
                : "Add speakers from the Event Page tab before assigning them to a session."
            }
          />
        )}
      />
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
        <TextField
          name="visibility"
          label="Visibility"
          select
          defaultValue={session?.visibility ?? "PUBLISHED"}
          fullWidth
        >
          <MenuItem value="PUBLISHED">Published</MenuItem>
          <MenuItem value="DRAFT">Draft</MenuItem>
        </TextField>
        <TextField
          name="sortOrder"
          label="Order"
          type="number"
          defaultValue={session?.sortOrder ?? sessions.length}
          slotProps={{ htmlInput: { min: 0 } }}
          fullWidth
        />
      </Stack>
    </>
  );
  return (
    <Stack spacing={2.5}>
      {error ? <Alert severity="error">{error}</Alert> : null}
      <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
        <Stack spacing={1}>
          <Stack
            direction={{ xs: "column", sm: "row" }}
            spacing={1}
            sx={{
              alignItems: { sm: "center" },
              justifyContent: "space-between",
            }}
          >
            <div>
              <Typography variant="h5">Schedule</Typography>
              <Typography variant="body2" color="text.secondary">
                Live delays shift this session and every later session without
                changing planned times.
              </Typography>
            </div>
            <Button
              variant="contained"
              onClick={() => {
                setSelectedSpeakerIds([]);
                setAdding(true);
              }}
              disabled={adding}
            >
              Add session
            </Button>
          </Stack>
          {adding ? (
            <Stack
              component="form"
              spacing={1.5}
              onSubmit={(event) => submit(event)}
              sx={{ pt: 2 }}
            >
              {fields()}
              <Stack direction="row" spacing={1}>
                <Button type="submit" variant="contained" disabled={pending}>
                  Add session
                </Button>
                <Button onClick={() => { setSelectedSpeakerIds([]); setAdding(false); }} disabled={pending}>
                  Cancel
                </Button>
              </Stack>
            </Stack>
          ) : null}
        </Stack>
      </Paper>
      {sessions.length ? (
        <Paper variant="outlined">
          <Stack divider={<Divider flexItem />}>
            {sessions.map((session, index) => (
              <Stack
                key={session.id}
                spacing={1.5}
                sx={{ p: { xs: 2, sm: 2.5 } }}
              >
                {editing === session.id ? (
                  <Stack
                    component="form"
                    spacing={1.5}
                    onSubmit={(event) => submit(event, session)}
                  >
                    {fields(session)}
                    <Stack direction="row" spacing={1}>
                      <Button
                        type="submit"
                        variant="contained"
                        disabled={pending}
                      >
                        Save changes
                      </Button>
                      <Button
                        onClick={() => { setSelectedSpeakerIds([]); setEditing(null); }}
                        disabled={pending}
                      >
                        Cancel
                      </Button>
                    </Stack>
                  </Stack>
                ) : (
                  <>
                    <Stack
                      direction={{ xs: "column", sm: "row" }}
                      spacing={1}
                      sx={{
                        alignItems: { sm: "center" },
                        justifyContent: "space-between",
                      }}
                    >
                      <Stack spacing={0.25}>
                        <Typography sx={{ fontWeight: 700 }}>
                          {session.title}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          Planned: {display(session.startDateTime, timeZone)} –{" "}
                          {display(session.endDateTime, timeZone)}
                        </Typography>
                        <Typography
                          variant="body2"
                          color={
                            session.cumulativeDelayMinutes
                              ? "warning.main"
                              : "text.secondary"
                          }
                        >
                          Live:{" "}
                          {display(session.effectiveStartDateTime, timeZone)} –{" "}
                          {display(session.effectiveEndDateTime, timeZone)}
                          {session.cumulativeDelayMinutes
                            ? ` (${session.cumulativeDelayMinutes} min behind)`
                            : ""}
                        </Typography>
                        {session.speakerNames?.length ? (
                          <Typography variant="body2" color="text.secondary">
                            Speakers: {session.speakerNames.join(", ")}
                          </Typography>
                        ) : null}
                      </Stack>
                      <Stack direction="row" spacing={0.5}>
                        <Button
                          size="small"
                          onClick={() => { setSelectedSpeakerIds(session.speakerIds); setEditing(session.id); }}
                        >
                          Edit
                        </Button>
                        <Button
                          color="error"
                          size="small"
                          onClick={() => setRemoveTarget(session)}
                          disabled={pending}
                        >
                          Remove
                        </Button>
                      </Stack>
                    </Stack>
                    <Stack
                      direction={{ xs: "column", sm: "row" }}
                      spacing={1}
                      sx={{ alignItems: { sm: "center" } }}
                    >
                      <TextField
                        label="Delay from this session (min)"
                        type="number"
                        defaultValue={session.delayMinutes}
                        size="small"
                        slotProps={{ htmlInput: { min: 0, max: 1440 } }}
                        disabled={pending}
                        onBlur={(event) => {
                          const delay = Number(event.target.value);
                          if (
                            Number.isInteger(delay) &&
                            delay !== session.delayMinutes
                          )
                            updateDelay(session.id, delay);
                        }}
                      />
                      <Typography variant="caption" color="text.secondary">
                        Affects this session and{" "}
                        {Math.max(sessions.length - index - 1, 0)} following
                        session{sessions.length - index - 1 === 1 ? "" : "s"}.
                      </Typography>
                    </Stack>
                  </>
                )}
              </Stack>
            ))}
          </Stack>
        </Paper>
      ) : (
        <Paper variant="outlined" sx={{ p: 3 }}>
          <Typography color="text.secondary">
            No sessions yet. Add the first session to build the schedule.
          </Typography>
        </Paper>
      )}
      <ConfirmationDialog
        open={Boolean(removeTarget)}
        title="Remove programme session?"
        message={`Remove “${removeTarget?.title ?? "this session"}” from the event schedule? This cannot be undone.`}
        confirmLabel="Remove session"
        loading={pending}
        onCancel={() => setRemoveTarget(null)}
        onConfirm={() => {
          if (!removeTarget) return;
          const id = removeTarget.id;
          setRemoveTarget(null);
          remove(id);
        }}
      />
    </Stack>
  );
}
