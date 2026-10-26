"use client";

import { useState, useTransition, type FormEvent } from "react";
import { ArrowDown, ArrowUp, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FilterChip } from "@/components/ui/choice";
import { Callout, Chip, EmptyState } from "@/components/ui/display";
import { Field, Input, Dropdown } from "@/components/ui/field";
import { cn } from "@/lib/cn";
import { cachedDateTimeFormat } from "@/lib/format/intlCache";
import { useRouter } from "next/navigation";
import { deleteScheduleTrack, deleteWebsiteContent, reorderScheduleTracks, saveScheduleTrack, saveSession, setEventSessionDelay } from "@/app/actions/event-website";
import { ConfirmationDialog } from "@/components/feedback/ConfirmationDialog";
import { RichTextEditor } from "@/components/editor/RichTextEditor";

export type ProgramScheduleTrack = { id: string; name: string; sortOrder: number };
export type ProgramScheduleRow = {
  id: string; trackId: string; title: string; descriptionHtml: string;
  startDateTime: string; endDateTime: string; effectiveStartDateTime: string; effectiveEndDateTime: string;
  type: string; visibility: string; sortOrder: number; speakerIds: string[]; speakerNames?: string[];
  delayMinutes: number; cumulativeDelayMinutes: number; hasConflict: boolean;
};

const types = ["Keynote", "Talk", "Panel", "Workshop", "Fireside chat", "Networking", "Break", "Other"];
const displayType = (type: string) => type.toLowerCase().split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");

function localValue(iso: string, timeZone: string) {
  const parts = cachedDateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}
function zonedInputToIso(value: string, timeZone: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match;
  const guess = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
  const parts = cachedDateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(guess));
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  const offset = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute")) - guess;
  const iso = new Date(guess - offset).toISOString();
  return localValue(iso, timeZone) === value ? iso : null;
}
function display(iso: string, timeZone: string) { return new Date(iso).toLocaleString(undefined, { timeZone, dateStyle: "medium", timeStyle: "short" }); }

export function EventProgramScheduleManager({ organisationSlug, eventId, eventStart, timeZone, tracks, sessions, speakers }: {
  organisationSlug: string; eventId: string; eventStart: string; timeZone: string;
  tracks: ProgramScheduleTrack[]; sessions: ProgramScheduleRow[]; speakers: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState<string | null>(null);
  const [addingTrackId, setAddingTrackId] = useState<string | null>(null);
  const [selectedSpeakerIds, setSelectedSpeakerIds] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");
  const [removeTarget, setRemoveTarget] = useState<ProgramScheduleRow | null>(null);
  const target = { organisationSlug, eventId };
  const sortedTracks = [...tracks].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  const complete = (result: { ok: boolean; error?: string }, close?: () => void) => {
    if (!result.ok) setError(result.error || "Could not save the programme.");
    else { setError(""); close?.(); router.refresh(); }
  };
  const trackSessions = (trackId: string) => sessions.filter((session) => session.trackId === trackId);
  const nextSessionStart = (trackId: string) => [...trackSessions(trackId)].sort((a, b) => new Date(a.endDateTime).getTime() - new Date(b.endDateTime).getTime()).at(-1)?.endDateTime ?? eventStart;
  const saveTrack = (event: FormEvent<HTMLFormElement>, track?: ProgramScheduleTrack) => {
    event.preventDefault();
    const name = String(new FormData(event.currentTarget).get("name") ?? "");
    startTransition(async () => complete(await saveScheduleTrack({ ...target, ...(track ? { id: track.id } : {}), name })));
  };
  const moveTrack = (track: ProgramScheduleTrack, direction: -1 | 1) => {
    const index = sortedTracks.findIndex((candidate) => candidate.id === track.id);
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= sortedTracks.length) return;
    const next = [...sortedTracks]; [next[index], next[nextIndex]] = [next[nextIndex]!, next[index]!];
    startTransition(async () => complete(await reorderScheduleTracks({ ...target, trackIds: next.map((item) => item.id) })));
  };
  const removeTrack = (track: ProgramScheduleTrack) => startTransition(async () => complete(await deleteScheduleTrack({ ...target, trackId: track.id })));
  const removeSession = (id: string) => startTransition(async () => complete(await deleteWebsiteContent({ ...target, kind: "session", id })));
  const updateDelay = (sessionId: string, delayMinutes: number) => startTransition(async () => complete(await setEventSessionDelay({ ...target, sessionId, delayMinutes })));
  const submitSession = (event: FormEvent<HTMLFormElement>, session?: ProgramScheduleRow) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const startDateTime = zonedInputToIso(String(form.get("start") ?? ""), timeZone);
    const endDateTime = zonedInputToIso(String(form.get("end") ?? ""), timeZone);
    if (!startDateTime || !endDateTime) { setError("Choose a valid local time. This time does not exist in the event time zone."); return; }
    startTransition(async () => {
      const result = await saveSession({ ...target, ...(session ? { id: session.id } : {}), trackId: String(form.get("trackId") ?? ""), speakerIds: selectedSpeakerIds, title: String(form.get("title") ?? ""), descriptionHtml: String(form.get("descriptionHtml") ?? ""), startDateTime, endDateTime, type: String(form.get("type") ?? "Talk"), visibility: String(form.get("visibility") ?? "PUBLISHED"), sortOrder: Number(form.get("sortOrder") ?? 0) });
      if (result.ok && result.data?.conflictingSessions.length) setWarning(`This overlaps ${result.data.conflictingSessions.map((conflict) => conflict.title).join(", ")} in the same track.`);
      else if (result.ok) setWarning("");
      complete(result, () => { setEditing(null); setAddingTrackId(null); setSelectedSpeakerIds([]); });
    });
  };
  const sessionFields = (session: ProgramScheduleRow | undefined, defaultTrackId: string) => {
    const typeListId = `session-types-${session?.id ?? defaultTrackId}`;
    return (
      <div className="flex flex-col gap-5">
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-2 text-label text-ink">Session details</legend>
          <Field label="Session title" required>
            <Input name="title" defaultValue={session?.title ?? ""} placeholder="e.g. Building inclusive communities" autoFocus={!session} />
          </Field>
          <RichTextEditor name="descriptionHtml" label="Session description" defaultValue={session?.descriptionHtml ?? ""} helperText="Optional details shown on the public session page." minHeight={100} />
        </fieldset>
        <fieldset className="flex flex-col gap-3 rounded-lg border border-line p-4">
          <legend className="px-1 text-label text-ink">When and where</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Planned start" required>
              <Input name="start" type="datetime-local" defaultValue={session ? localValue(session.startDateTime, timeZone) : localValue(nextSessionStart(defaultTrackId), timeZone)} />
            </Field>
            <Field label="Planned end" required>
              <Input name="end" type="datetime-local" defaultValue={session ? localValue(session.endDateTime, timeZone) : ""} />
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-[7fr_5fr]">
            <Field label="Track" required helperText="Tracks are the room, stage, or stream shown to attendees.">
              <Dropdown name="trackId" defaultValue={session?.trackId ?? defaultTrackId}>
                {sortedTracks.map((track) => <option key={track.id} value={track.id}>{track.name}</option>)}
              </Dropdown>
            </Field>
            <Field label="Type" required helperText="Choose or type your own.">
              <Input name="type" list={typeListId} defaultValue={displayType(session?.type ?? "Talk")} />
            </Field>
            <datalist id={typeListId}>{types.map((type) => <option key={type} value={type} />)}</datalist>
          </div>
        </fieldset>
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-2 text-label text-ink">Speakers and visibility</legend>
          <div className="flex flex-col gap-1.5">
            <p className="text-label text-ink">Speakers</p>
            {speakers.length ? (
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Speakers">
                {speakers.map((speaker) => {
                  const selected = selectedSpeakerIds.includes(speaker.id);
                  return (
                    <FilterChip key={speaker.id} selected={selected} onClick={() => setSelectedSpeakerIds((current) => selected ? current.filter((id) => id !== speaker.id) : [...current, speaker.id])}>
                      {speaker.name}
                    </FilterChip>
                  );
                })}
              </div>
            ) : null}
            <p className="text-caption text-ink-muted">{speakers.length ? "Select everyone appearing in this session." : "Add speakers from the Event Page tab before assigning them."}</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Visibility">
              <Dropdown name="visibility" defaultValue={session?.visibility ?? "PUBLISHED"}>
                <option value="PUBLISHED">Published</option>
                <option value="DRAFT">Draft</option>
                <option value="HIDDEN">Hidden</option>
              </Dropdown>
            </Field>
            <Field label="Display order" helperText="Use when sessions share a start time.">
              <Input name="sortOrder" type="number" min={0} defaultValue={session?.sortOrder ?? trackSessions(defaultTrackId).length} />
            </Field>
          </div>
        </fieldset>
      </div>
    );
  };
  return (
    <div className="flex flex-col gap-5">
      {error ? <Callout tone="danger" role="alert">{error}</Callout> : null}
      {warning ? <Callout tone="warning" action={<Button size="sm" variant="quiet" onClick={() => setWarning("")}>Dismiss</Button>}>{warning}</Callout> : null}
      <section className="flex flex-col gap-4 rounded-lg border border-line bg-canvas p-4 sm:p-6">
        <div>
          <h2 className="text-title text-ink">Programme tracks</h2>
          <p className="mt-1 text-body-ui text-ink-muted">Each track is an independent room, stage, or stream. Delays shift only later sessions in that track.</p>
        </div>
        <form className="flex flex-col gap-2.5 sm:flex-row sm:items-end" onSubmit={(event) => saveTrack(event)}>
          <Field label="New track" required className="flex-1">
            <Input name="name" placeholder="e.g. Main Hall" />
          </Field>
          <Button type="submit" variant="primary" startIcon={<Plus />} disabled={pending}>Add track</Button>
        </form>
        {sortedTracks.length ? (
          <ul className="divide-y divide-line">
            {sortedTracks.map((track, index) => (
              <li key={track.id}>
                <form className="flex flex-col gap-2 py-3 md:flex-row md:items-center" onSubmit={(event) => saveTrack(event, track)}>
                  <label htmlFor={`track-name-${track.id}`} className="sr-only">Track name</label>
                  <Input id={`track-name-${track.id}`} name="name" defaultValue={track.name} className="md:max-w-[300px]" />
                  <div className="flex flex-wrap items-center gap-1">
                    <Button type="submit" size="sm" variant="secondary" disabled={pending}>Rename</Button>
                    <Button size="sm" variant="quiet" startIcon={<ArrowUp />} disabled={pending || index === 0} onClick={() => moveTrack(track, -1)}>Up</Button>
                    <Button size="sm" variant="quiet" startIcon={<ArrowDown />} disabled={pending || index === sortedTracks.length - 1} onClick={() => moveTrack(track, 1)}>Down</Button>
                    <Button size="sm" variant="dangerQuiet" disabled={pending} onClick={() => removeTrack(track)}>Remove</Button>
                  </div>
                </form>
              </li>
            ))}
          </ul>
        ) : <Callout tone="info">Add a track before adding sessions.</Callout>}
      </section>
      <div className="grid gap-4 lg:grid-cols-2">
        {sortedTracks.map((track) => {
          const sessionsInTrack = trackSessions(track.id);
          return (
            <section key={track.id} className="flex h-full flex-col gap-3 rounded-lg border border-line bg-canvas p-4 sm:p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-title text-ink">{track.name}</h3>
                  <p className="text-sm text-ink-muted">{sessionsInTrack.length} session{sessionsInTrack.length === 1 ? "" : "s"} · delays stay in this track</p>
                </div>
                <Button variant="primary" size="sm" startIcon={<Plus />} disabled={pending || addingTrackId !== null} onClick={() => { setSelectedSpeakerIds([]); setAddingTrackId(track.id); }}>Add session</Button>
              </div>
              {addingTrackId === track.id ? (
                <form className="flex flex-col gap-4 rounded-lg bg-subtle p-4" onSubmit={(event) => submitSession(event)}>
                  {sessionFields(undefined, track.id)}
                  <div className="flex flex-wrap gap-2">
                    <Button type="submit" variant="primary" disabled={pending}>Add session</Button>
                    <Button variant="secondary" disabled={pending} onClick={() => { setSelectedSpeakerIds([]); setAddingTrackId(null); }}>Cancel</Button>
                  </div>
                </form>
              ) : null}
              {sessionsInTrack.length ? (
                <ul className="divide-y divide-line">
                  {sessionsInTrack.map((session) => (
                    <li key={session.id} className="flex flex-col gap-2.5 py-3">
                      {editing === session.id ? (
                        <form className="flex flex-col gap-4 rounded-lg bg-subtle p-4" onSubmit={(event) => submitSession(event, session)}>
                          {sessionFields(session, session.trackId)}
                          <div className="flex flex-wrap gap-2">
                            <Button type="submit" variant="primary" disabled={pending}>Save changes</Button>
                            <Button variant="secondary" disabled={pending} onClick={() => { setSelectedSpeakerIds([]); setEditing(null); }}>Cancel</Button>
                          </div>
                        </form>
                      ) : (
                        <>
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <p className="text-[16px] font-bold text-ink">{session.title}</p>
                                {session.hasConflict ? <Chip size="sm" tone="warning">Time overlap</Chip> : null}
                              </div>
                              <p className="text-sm text-ink-muted">Planned: {display(session.startDateTime, timeZone)} – {display(session.endDateTime, timeZone)}</p>
                              <p className={cn("text-sm", session.cumulativeDelayMinutes ? "font-semibold text-warning-fg" : "text-ink-muted")}>Live: {display(session.effectiveStartDateTime, timeZone)} – {display(session.effectiveEndDateTime, timeZone)}{session.cumulativeDelayMinutes ? ` (${session.cumulativeDelayMinutes} min behind)` : ""}</p>
                              {session.speakerNames?.length ? <p className="text-sm text-ink-muted">Speakers: {session.speakerNames.join(", ")}</p> : null}
                            </div>
                            <div className="flex shrink-0 gap-1">
                              <Button size="sm" variant="secondary" onClick={() => { setSelectedSpeakerIds(session.speakerIds); setEditing(session.id); }}>Edit</Button>
                              <Button size="sm" variant="dangerQuiet" disabled={pending} onClick={() => setRemoveTarget(session)}>Remove</Button>
                            </div>
                          </div>
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                            <label className="flex items-center gap-2 text-sm font-semibold text-ink-secondary">
                              Delay from this session (min)
                              <Input type="number" min={0} max={1440} defaultValue={session.delayMinutes} className="w-24" disabled={pending} onBlur={(event) => { const delay = Number(event.target.value); if (Number.isInteger(delay) && delay !== session.delayMinutes) updateDelay(session.id, delay); }} />
                            </label>
                            {session.hasConflict ? <p className="text-caption text-warning-fg">This overlaps another session in {track.name}; it is allowed, but attendees may need guidance.</p> : <p className="text-caption text-ink-muted">Affects only later sessions in {track.name}.</p>}
                          </div>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              ) : <EmptyState mood="sleepy" className="py-6">No sessions in this track yet.</EmptyState>}
            </section>
          );
        })}
      </div>
      <ConfirmationDialog open={Boolean(removeTarget)} title="Remove programme session?" message={`Remove “${removeTarget?.title ?? "this session"}” from the event schedule? This cannot be undone.`} confirmLabel="Remove session" loading={pending} onCancel={() => setRemoveTarget(null)} onConfirm={() => { if (!removeTarget) return; const id = removeTarget.id; setRemoveTarget(null); removeSession(id); }} />
    </div>
  );
}
