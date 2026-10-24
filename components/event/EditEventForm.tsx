"use client";

import { useId, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { EventPrivacyType, EventStatus } from "@prisma/client";
import type { EventClientDto } from "@/lib/eventDto";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SwitchRow } from "@/components/ui/choice";
import { Callout, Chip } from "@/components/ui/display";
import { Field, Input, Dropdown } from "@/components/ui/field";
import { updateEvent, uploadEventCoverImage } from "@/app/actions/event";
import { uploadEventPageLogo } from "@/app/actions/media";
import { CoverImagePicker } from "@/components/event/CoverImagePicker";
import { PublishingSection } from "@/components/event/PublishingSection";
import { RichTextEditor } from "@/components/editor/RichTextEditor";
import { ImageUploadPicker } from "@/components/forms/ImageUploadPicker";
import { useToast } from "@/components/feedback/ToastProvider";
import { useUnsavedChangesGuard } from "@/components/forms/useUnsavedChangesGuard";
import { zonedDatetimeLocalValue, zonedInputToIso } from "@/lib/timeZone";
import { UnsavedChangesBar } from "@/components/event-dashboard/event-page/UnsavedChangesBar";

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

/** The event's wall-clock time ("YYYY-MM-DDTHH:mm") in its own timezone, for a native datetime-local input. */
function zonedInputValue(value: Date | string, timeZone: string) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "" : zonedDatetimeLocalValue(date, timeZone);
}

/** One titled card of the details form. */
function FormCard({ title, description, children }: { title: ReactNode; description: string; children: ReactNode }) {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-5 rounded-2xl border border-line bg-canvas p-5 sm:p-6">
      <div>
        <h2 id={titleId} className="flex flex-wrap items-center gap-2 text-h4 text-ink">{title}</h2>
        <p className="mt-0.5 text-body-ui text-ink-muted">{description}</p>
      </div>
      {children}
    </section>
  );
}

export function EditEventForm(props: {
  organisationSlug: string;
  event: EventClientDto;
  page: {
    tagline: string;
    logoUrl: string | null;
    aboutHtml: string;
  } | null;
  /** Existing registrations lock the registration mode; the largest team bounds the maximum size. */
  registrations?: { total: number; largestTeam: number };
}) {
  const { organisationSlug, event, page, registrations } = props;
  const router = useRouter();
  const { showToast } = useToast();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [dirty, setDirty] = useState(false);
  useUnsavedChangesGuard(dirty && !pending);
  const [coverPreviewUrl, setCoverPreviewUrl] = useState(
    event.coverImageUrl ?? "",
  );
  const [coverImageFile, setCoverImageFile] = useState<File | null>(null);
  const [pageLogoPreviewUrl, setPageLogoPreviewUrl] = useState(
    page?.logoUrl ?? "",
  );
  const [pageLogoFile, setPageLogoFile] = useState<File | null>(null);
  const [isOnlinePreview, setIsOnlinePreview] = useState(event.isOnline);
  const [mapLinkPreviewUrl, setMapLinkPreviewUrl] = useState(
    event.mapLinkUrl ?? "",
  );
  const [tagsPreview, setTagsPreview] = useState(
    Array.isArray(event.tags) ? (event.tags ?? []) : [],
  );
  const [showRegistrationCountPreview, setShowRegistrationCountPreview] =
    useState(event.showRegistrationCount ?? true);
  const [timezone, setTimezone] = useState(event.timezone);
  // Start and end are edited as wall-clock times in the selected event timezone.
  const [start, setStart] = useState(() => zonedInputValue(event.startDateTime, event.timezone));
  const [end, setEnd] = useState(() => zonedInputValue(event.endDateTime, event.timezone));

  const [status, setStatus] = useState<EventStatus>(event.status);
  const [privacyType, setPrivacyType] = useState<EventPrivacyType>(
    event.privacyType,
  );
  const [listedPublicly, setListedPublicly] = useState(event.listedPublicly);
  // Remounts the form (uncontrolled fields, pickers, rich text) when changes are discarded.
  const [formKey, setFormKey] = useState(0);

  function discard() {
    setCoverPreviewUrl(event.coverImageUrl ?? "");
    setCoverImageFile(null);
    setPageLogoPreviewUrl(page?.logoUrl ?? "");
    setPageLogoFile(null);
    setIsOnlinePreview(event.isOnline);
    setMapLinkPreviewUrl(event.mapLinkUrl ?? "");
    setTagsPreview(Array.isArray(event.tags) ? (event.tags ?? []) : []);
    setShowRegistrationCountPreview(event.showRegistrationCount ?? true);
    setTimezone(event.timezone);
    setStart(zonedInputValue(event.startDateTime, event.timezone));
    setEnd(zonedInputValue(event.endDateTime, event.timezone));
    setStatus(event.status);
    setPrivacyType(event.privacyType);
    setListedPublicly(event.listedPublicly);
    setError(null);
    setDirty(false);
    setFormKey((key) => key + 1);
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const startDateTime = start ? zonedInputToIso(start, timezone) : null;
    const endDateTime = end ? zonedInputToIso(end, timezone) : null;
    if (!startDateTime) {
      setError("Choose a valid start time in the event timezone.");
      return;
    }
    if (new Date(startDateTime) < new Date()) {
      setError("Start time must be now or in the future.");
      return;
    }
    if (!endDateTime) {
      setError("Choose a valid end time in the event timezone.");
      return;
    }
    if (new Date(endDateTime) <= new Date(startDateTime)) {
      setError("End time must be after start time.");
      return;
    }
    const form = e.currentTarget;
    const fd = new FormData(form);
    const capacityRaw = String(fd.get("capacity") ?? "").trim();
    const registrationClosesAtRaw = String(fd.get("registrationClosesAt") ?? "").trim();
    const registrationClosesAt = registrationClosesAtRaw
      ? zonedInputToIso(registrationClosesAtRaw, timezone)
      : "";
    if (registrationClosesAtRaw && !registrationClosesAt) {
      setError("Choose a valid registration closing time in the event time zone.");
      return;
    }
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
      let pageLogoUrl = pageLogoPreviewUrl;
      if (pageLogoFile) {
        const uploadData = new FormData();
        uploadData.set("organisationSlug", organisationSlug);
        uploadData.set("eventId", event.id);
        uploadData.set("file", pageLogoFile);
        const upload = await uploadEventPageLogo(uploadData);
        if (!upload.ok) {
          setError(upload.error);
          showToast(upload.error, "error");
          return;
        }
        pageLogoUrl = upload.data!.url;
      }
      const res = await updateEvent({
        organisationSlug,
        eventId: event.id,
        title: String(fd.get("title") ?? ""),
        tags: String(fd.get("tags") ?? ""),
        coverImageUrl,
        showRegistrationCount: fd.get("showRegistrationCount") === "on",
        startDateTime,
        endDateTime,
        timezone,
        location: String(fd.get("location") ?? ""),
        mapLinkUrl: String(fd.get("mapLinkUrl") ?? ""),
        isOnline: fd.get("isOnline") === "on",
        capacity: capacityRaw,
        registrationClosesAt,
        registrationLeadMinutes: String(
          fd.get("registrationLeadMinutes") ?? "",
        ),
        status,
        privacyType,
        listedPublicly,
        pageTagline: String(fd.get("pageTagline") ?? ""),
        pageLogoUrl,
        pageAboutHtml: String(fd.get("pageAboutHtml") ?? ""),
        registrationMode: String(fd.get("registrationMode") ?? ""),
        teamMinSize: String(fd.get("teamMinSize") ?? ""),
        teamMaxSize: String(fd.get("teamMaxSize") ?? ""),
        soloPolicy: String(fd.get("soloPolicy") ?? ""),
      });
      if (!res.ok) {
        setError(res.error);
        showToast(res.error, "error");
        return;
      }
      showToast("Event saved", "success");
      setDirty(false);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <section aria-label="Public URL" className="flex flex-col gap-3 rounded-2xl border border-line bg-subtle p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-caption text-ink-muted">Public URL</p>
          <Link href={`/${organisationSlug}/${event.slug}`} className="block truncate text-[15px] font-semibold text-ink underline underline-offset-4">
            /{organisationSlug}/{event.slug}
          </Link>
        </div>
        <Button asChild variant="secondary" size="sm" className="shrink-0 self-start sm:self-center">
          <Link href={`/${organisationSlug}/${event.slug}`}>
            Open event page
            <ArrowUpRight aria-hidden className="size-4" />
          </Link>
        </Button>
      </section>
      <form key={formKey} aria-label="Event details" onSubmit={onSubmit} onChangeCapture={() => setDirty(true)} onInputCapture={() => setDirty(true)} className="flex flex-col gap-5">
        {error ? <Callout tone="danger" role="alert">{error}</Callout> : null}

        <FormCard
          title={<>Basics<Chip size="sm" tone={event.status === EventStatus.DRAFT ? "neutral" : "success"}>{event.status === EventStatus.DRAFT ? "Draft" : "Published"}</Chip></>}
          description="Update the public-facing title and introduction."
        >
          <Field label="Title" required>
            <Input name="title" defaultValue={event.title} />
          </Field>
          <Field label="Tagline" helperText="A short line beneath the event title.">
            <Input name="pageTagline" defaultValue={page?.tagline ?? ""} />
          </Field>
          <ImageUploadPicker
            initialUrl={page?.logoUrl}
            label="Event page logo"
            placeholder="Your event page logo will appear here."
            disabled={pending}
            onChange={(file, previewUrl) => {
              setPageLogoFile(file);
              setPageLogoPreviewUrl(previewUrl);
              setDirty(true);
            }}
          />
          <RichTextEditor
            name="pageAboutHtml"
            label="About the event"
            defaultValue={page?.aboutHtml ?? ""}
            helperText="Required. Use the toolbar to format text—no HTML needed."
            minHeight={140}
          />
          <div className="flex flex-col gap-2">
            <Field label="Tags" helperText="Comma-separated (eg: workshop, meetup, ai). Used in global search.">
              <Input
                name="tags"
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
              />
            </Field>
            {tagsPreview.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {tagsPreview.slice(0, 12).map((t) => (
                  <Chip key={t} size="sm" tone="outline">{t}</Chip>
                ))}
              </div>
            ) : null}
          </div>
        </FormCard>

        <FormCard title="Cover image" description="Add a visual to make your event page stand out.">
          <CoverImagePicker
            initialUrl={event.coverImageUrl}
            disabled={pending}
            onChange={(file, previewUrl) => {
              setCoverImageFile(file);
              setCoverPreviewUrl(previewUrl);
              setDirty(true);
            }}
          />
        </FormCard>

        <FormCard title="Schedule" description="Set the date, time, and timezone for guests.">
          <div className="grid gap-4 md:grid-cols-3">
            <Field label="Start" required>
              <Input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
            </Field>
            <Field label="End" required>
              <Input type="datetime-local" value={end} min={start || undefined} onChange={(e) => setEnd(e.target.value)} />
            </Field>
            <Field label="Timezone" required>
              <Dropdown name="timezone" value={timezone} onChange={(e) => setTimezone(e.target.value)}>
                {timezones.map((tz) => (
                  <option key={tz} value={tz}>{tz}</option>
                ))}
              </Dropdown>
            </Field>
          </div>
        </FormCard>

        <FormCard title="Location" description="Choose whether this is online and what guests should see.">
          <SwitchRow
            name="isOnline"
            label="Online event"
            description="Guests will see “Online event”."
            checked={isOnlinePreview}
            onCheckedChange={(checked) => {
              setIsOnlinePreview(checked);
              setDirty(true);
            }}
            className="rounded-xl border border-line p-3.5"
          />
          <Field
            label={isOnlinePreview ? "Online meeting link" : "Location"}
            required
            helperText={isOnlinePreview ? "Enter a valid HTTP(S) meeting URL." : "Eg: Samagatha Foundation, Bengaluru"}
          >
            <Input name="location" type={isOnlinePreview ? "url" : "text"} defaultValue={event.location} />
          </Field>
          <div className="flex flex-col gap-1.5">
            <Field
              label="Map link"
              optional
              helperText={isOnlinePreview ? "Available only for physical events." : "Paste a Google Maps link so guests can open directions."}
            >
              <Input name="mapLinkUrl" type="url" defaultValue={event.mapLinkUrl ?? ""} disabled={isOnlinePreview} onChange={(e) => setMapLinkPreviewUrl(e.target.value)} />
            </Field>
            {!isOnlinePreview && mapLinkPreviewUrl.trim() ? <p className="text-caption text-ink-muted">Tip: Use a share link so it opens cleanly on mobile.</p> : null}
          </div>
        </FormCard>

        <FormCard title="Publishing" description="Who can see this event, who can join, and how sign-ups work.">
          <PublishingSection
            status={status}
            onStatusChange={setStatus}
            privacyType={privacyType}
            listedPublicly={listedPublicly}
            onAudienceChange={(audience) => {
              setPrivacyType(audience.privacyType);
              setListedPublicly(audience.listedPublicly);
            }}
            initialCapacity={event.capacity ?? null}
            initialClosesAt={event.registrationClosesAt ? zonedDatetimeLocalValue(new Date(event.registrationClosesAt), event.timezone) : ""}
            initialLeadMinutes={event.registrationLeadMinutes ?? null}
            showCount={showRegistrationCountPreview}
            onShowCountChange={setShowRegistrationCountPreview}
            start={start}
            timeZone={timezone}
            onDirty={() => setDirty(true)}
            initialTeam={{
              registrationMode: event.registrationMode,
              teamMinSize: event.teamMinSize,
              teamMaxSize: event.teamMaxSize,
              soloPolicy: event.soloPolicy,
            }}
            teamModeLocked={(registrations?.total ?? 0) > 0}
            largestTeam={registrations?.largestTeam ?? 0}
          />
        </FormCard>

        <UnsavedChangesBar visible={dirty} pending={pending} onDiscard={discard} />
      </form>
    </div>
  );
}
