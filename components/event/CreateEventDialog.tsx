"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { EventPrivacyType, EventStatus } from "@prisma/client";
import { Plus, X } from "lucide-react";
import { createEvent } from "@/app/actions/event";
import { RichTextEditor } from "@/components/editor/RichTextEditor";
import { Button } from "@/components/ui/button";
import { SwitchRow } from "@/components/ui/choice";
import { Callout } from "@/components/ui/display";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Field, Input, Dropdown } from "@/components/ui/field";
import { cn } from "@/lib/cn";
import { zonedDatetimeLocalValue, zonedInputToIso } from "@/lib/timeZone";
import {
  DEFAULT_TEAM_SETTINGS,
  TeamSettingsFields,
  teamSettingsPayload,
  focusTeamSettingsProblem,
  teamSettingsProblem,
  type TeamSettingsDraft,
} from "./TeamSettingsFields";

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

const DEFAULT_TIMEZONE = "Asia/Kolkata";
const HOUR_MS = 60 * 60 * 1000;

/** Shifts a `datetime-local` wall-clock value by whole hours (calendar arithmetic, no timezone). */
function addWallClockHours(value: string, hours: number) {
  const parsed = Date.parse(`${value}:00Z`);
  return Number.isNaN(parsed) ? "" : new Date(parsed + hours * HOUR_MS).toISOString().slice(0, 16);
}

/**
 * A whole hour on the event's own clock at least 30 minutes away, as a
 * `datetime-local` value. The plain next whole hour can be seconds away, and
 * then has passed by the time the organiser clicks Create.
 */
function nextWholeHour(timeZone: string) {
  return `${zonedDatetimeLocalValue(new Date(Date.now() + 1.5 * HOUR_MS), timeZone).slice(0, 13)}:00`;
}

/**
 * The pickers hold wall-clock times on the event's clock, never the browser's
 * or the server's. Converts them to instants and explains the first problem.
 */
function checkSchedule(start: string, end: string, timeZone: string): { error: string } | { startIso: string; endIso: string } {
  if (!start || !end) return { error: "Please select both start and end times." };
  const startIso = zonedInputToIso(start, timeZone);
  if (!startIso) return { error: `That start time does not exist in ${timeZone}.` };
  if (new Date(startIso) < new Date()) return { error: "Start time must be now or in the future." };
  const endIso = zonedInputToIso(end, timeZone);
  if (!endIso) return { error: `That end time does not exist in ${timeZone}.` };
  if (new Date(endIso) <= new Date(startIso)) return { error: "End time must be after start time." };
  return { startIso, endIso };
}

const STEP_TITLES = ["Create Event: Basics", "Create Event: Schedule", "Create Event: Location & sign-ups"];
const STEP_LABELS = ["Basics", "Schedule", "Location & sign-ups"];

function isRichTextEmpty(html: string) {
  return !new DOMParser().parseFromString(html, "text/html").body.textContent?.trim();
}

export function CreateEventDialog(props: {
  organisationSlug: string;
  variant?: "button" | "fab";
}) {
  const { organisationSlug, variant = "button" } = props;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // `datetime-local` values on the event's clock (`timezone`).
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [timezone, setTimezone] = useState(DEFAULT_TIMEZONE);
  const [tagsPreview, setTagsPreview] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [formKey, setFormKey] = useState(0);
  const formRef = useRef<HTMLFormElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  /** Set when Next/Back (or a schedule error) changes the step, so focus follows into it. */
  const stepMoved = useRef(false);

  // Wizard States
  const [activeStep, setActiveStep] = useState(0);
  const [isOnline, setIsOnline] = useState(false);
  const [teamSettings, setTeamSettings] = useState<TeamSettingsDraft>(DEFAULT_TEAM_SETTINGS);

  // Keyboard and screen-reader users land in the step they moved to, not on
  // the Next button that is still under focus.
  useEffect(() => {
    if (!stepMoved.current) return;
    stepMoved.current = false;
    formRef.current?.querySelector<HTMLElement>(`[data-step="${activeStep}"] :is(input:not([type=hidden]), select, textarea, [contenteditable=true], button)`)?.focus();
  }, [activeStep]);

  const resetDraft = () => {
    setActiveStep(0);
    setError(null);
    setStart("");
    setEnd("");
    setTimezone(DEFAULT_TIMEZONE);
    setTagsPreview([]);
    setTagInput("");
    setIsOnline(false);
    setTeamSettings(DEFAULT_TEAM_SETTINGS);
    setFormKey((current) => current + 1);
  };

  const closeDialog = () => {
    if (pending) return;
    setOpen(false);
    resetDraft();
  };

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (activeStep !== 2) return;
    setError(null);
    const form = e.currentTarget;
    const fd = new FormData(form);
    const schedule = checkSchedule(start, end, timezone);
    if ("error" in schedule) {
      setError(schedule.error);
      stepMoved.current = true;
      setActiveStep(1);
      return;
    }
    const { startIso, endIso } = schedule;
    if (teamSettingsProblem(teamSettings)) {
      // The message is already shown (and announced) under the size inputs; move focus to the field.
      focusTeamSettingsProblem(e.currentTarget, teamSettings);
      return;
    }
    startTransition(async () => {
      const res = await createEvent({
        organisationSlug,
        title: String(fd.get("title") ?? ""),
        aboutHtml: String(fd.get("aboutHtml") ?? ""),
        tags: String(fd.get("tags") ?? ""),
        coverImageUrl: "",
        startDateTime: startIso,
        endDateTime: endIso,
        timezone,
        location: String(fd.get("location") ?? ""),
        mapLinkUrl: String(fd.get("mapLinkUrl") ?? ""),
        isOnline: isOnline,
        capacity: "",
        status: EventStatus.DRAFT,
        privacyType: EventPrivacyType.PUBLIC,
        ...teamSettingsPayload(teamSettings),
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      closeDialog();
      if (res.data?.id) {
        router.push(`/dashboard/${organisationSlug}/event/${res.data.id}`);
      } else {
        router.refresh();
      }
    });
  }

  const handleOpen = () => {
    resetDraft();
    const base = nextWholeHour(DEFAULT_TIMEZONE);
    setStart(base);
    setEnd(addWallClockHours(base, 1));
    setOpen(true);
  };

  const addTag = (raw: string) => {
    const tag = raw.trim().toLowerCase().replace(/\s+/g, " ");
    if (tag && !tagsPreview.includes(tag) && tagsPreview.length < 12) {
      setTagsPreview([...tagsPreview, tag]);
    }
    setTagInput("");
  };

  return (
    <>
      {variant === "fab" ? (
        <button
          ref={triggerRef}
          type="button"
          aria-label="Create event"
          onClick={handleOpen}
          className="inline-flex size-14 items-center justify-center rounded-full bg-primary text-on-primary shadow-float transition-opacity hover:opacity-90"
        >
          <Plus aria-hidden className="size-6" />
        </button>
      ) : (
        <Button ref={triggerRef} variant="primary" startIcon={<Plus />} onClick={handleOpen}>
          New event
        </Button>
      )}
      <Dialog open={open} onOpenChange={(next) => { if (!next) closeDialog(); }}>
        <DialogContent
          size="md"
          // The dialog is opened from our own button, not a Radix trigger, so
          // hand focus back to it on close (Escape, Cancel, the close icon).
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            triggerRef.current?.focus();
          }}
        >
          <form
            key={formKey}
            ref={formRef}
            onSubmit={onSubmit}
            onKeyDown={(event) => {
              if (activeStep === 2 && event.key === "Enter" && event.target instanceof HTMLInputElement) {
                event.preventDefault();
              }
            }}
            className="flex min-h-0 flex-1 flex-col"
          >
            <DialogHeader title={STEP_TITLES[activeStep]} />
            <DialogBody className="flex flex-col gap-5">
              <div>
                <div className="mb-2 flex items-center justify-between text-caption text-ink-muted">
                  <span className="text-overline">{STEP_LABELS[activeStep]}</span>
                  <span className="font-semibold">Step {activeStep + 1} of 3</span>
                </div>
                <div className="flex gap-1.5" aria-hidden>
                  {[0, 1, 2].map((stepIndex) => (
                    <span key={stepIndex} className={cn("h-1 flex-1 rounded-full transition-colors", stepIndex <= activeStep ? "bg-primary" : "bg-emphasis")} />
                  ))}
                </div>
              </div>

              {error ? <Callout tone="danger" role="alert">{error}</Callout> : null}

              {/* Step 1: Basics */}
              <div data-step="0" className={cn("flex-col gap-4", activeStep === 0 ? "flex" : "hidden")}>
                <Field label="Title" required>
                  <Input name="title" autoFocus />
                </Field>
                <RichTextEditor
                  name="aboutHtml"
                  label="About the event"
                  helperText="Required. Share the key details attendees should know."
                  minHeight={160}
                />
                <Field label="Tags" helperText="Press Enter or Comma to add up to 12 tags (e.g. workshop, meetup, ai).">
                  <Input
                    value={tagInput}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val.endsWith(",")) addTag(val.slice(0, -1));
                      else setTagInput(val);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addTag(tagInput);
                      }
                    }}
                    placeholder="Type a tag and press Enter or Comma"
                  />
                </Field>
                <input type="hidden" name="tags" value={tagsPreview.join(",")} />
                {tagsPreview.length > 0 ? (
                  <ul className="flex flex-wrap gap-1.5">
                    {tagsPreview.map((t) => (
                      <li key={t} className="inline-flex items-center gap-1 rounded-full bg-muted py-0.5 pl-3 pr-1 text-[13px] font-semibold text-ink-secondary">
                        {t}
                        <button
                          type="button"
                          aria-label={`Remove tag ${t}`}
                          onClick={() => setTagsPreview(tagsPreview.filter((x) => x !== t))}
                          className="inline-flex size-6 items-center justify-center rounded-full hover:bg-emphasis hover:text-ink"
                        >
                          <X aria-hidden className="size-3.5" />
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>

              {/* Step 2: Schedule */}
              <div data-step="1" className={cn("flex-col gap-4", activeStep === 1 ? "flex" : "hidden")}>
                <Field label="Start" required helperText="Pick date and time">
                  <Input
                    type="datetime-local"
                    value={start}
                    min={zonedDatetimeLocalValue(new Date(), timezone)}
                    onChange={(e) => {
                      const v = e.target.value;
                      setStart(v);
                      if (v) setEnd(addWallClockHours(v, 1));
                    }}
                  />
                </Field>
                <Field label="End" required helperText="Must be after start">
                  <Input
                    type="datetime-local"
                    value={end}
                    min={start || undefined}
                    onChange={(e) => setEnd(e.target.value)}
                  />
                </Field>
                <Field label="Timezone" required helperText="Start and end are times on this clock.">
                  <Dropdown name="timezone" value={timezone} onChange={(e) => setTimezone(e.target.value)}>
                    {timezones.map((tz) => (
                      <option key={tz} value={tz}>
                        {tz}
                      </option>
                    ))}
                  </Dropdown>
                </Field>
              </div>

              {/* Step 3: Location */}
              <div data-step="2" className={cn("flex-col gap-4", activeStep === 2 ? "flex" : "hidden")}>
                <SwitchRow
                  name="isOnline"
                  label="Online event"
                  checked={isOnline}
                  onCheckedChange={setIsOnline}
                />
                <Field
                  label={isOnline ? "Online meeting link" : "Location"}
                  required
                  helperText={isOnline ? "Enter a valid HTTP(S) meeting URL." : "Enter the venue or street address."}
                >
                  <Input
                    name="location"
                    type={isOnline ? "url" : "text"}
                    placeholder={isOnline ? "https://meet.google.com/..." : "e.g., 123 Main St, San Francisco, CA"}
                  />
                </Field>
                {!isOnline && (
                  <Field label="Map link" optional helperText="Paste a Google Maps link for directions (physical events only).">
                    <Input name="mapLinkUrl" type="url" />
                  </Field>
                )}
                <div className="border-t border-line pt-4">
                  <TeamSettingsFields value={teamSettings} onChange={setTeamSettings} />
                </div>
              </div>
            </DialogBody>
            <DialogFooter className="sm:justify-between">
              <div>
                {activeStep > 0 && (
                  <Button
                    variant="quiet"
                    onClick={() => {
                      setError(null);
                      stepMoved.current = true;
                      setActiveStep((prev) => prev - 1);
                    }}
                    disabled={pending}
                  >
                    Back
                  </Button>
                )}
              </div>
              <div className="flex flex-col-reverse gap-2.5 sm:flex-row">
                <Button variant="secondary" onClick={closeDialog} disabled={pending}>
                  Cancel
                </Button>
                {activeStep < 2 ? (
                  <Button
                    variant="primary"
                    onClick={() => {
                      setError(null);
                      if (activeStep === 0) {
                        const titleInput = formRef.current?.elements.namedItem(
                          "title",
                        ) as HTMLInputElement | null;
                        if (!titleInput?.value.trim()) {
                          titleInput?.focus();
                          titleInput?.reportValidity();
                          return;
                        }
                        const aboutInput = formRef.current?.elements.namedItem(
                          "aboutHtml",
                        ) as HTMLInputElement | null;
                        if (isRichTextEmpty(aboutInput?.value ?? "")) {
                          setError("Add a short description for your event.");
                          return;
                        }
                      }
                      if (activeStep === 1) {
                        const schedule = checkSchedule(start, end, timezone);
                        if ("error" in schedule) {
                          setError(schedule.error);
                          return;
                        }
                      }
                      stepMoved.current = true;
                      setActiveStep((prev) => prev + 1);
                    }}
                  >
                    Next
                  </Button>
                ) : (
                  <Button type="submit" variant="primary" disabled={pending} loading={pending}>
                    Create
                  </Button>
                )}
              </div>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
