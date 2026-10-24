"use client";

import { useCallback, useEffect, useState, useTransition, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUpRight, ChevronDown, ChevronUp, GripVertical, Plus, Upload } from "lucide-react";
import { Button, IconButton } from "@/components/ui/button";
import { Switch } from "@/components/ui/choice";
import { Callout, Chip, type ChipTone } from "@/components/ui/display";
import { Field, Input, Dropdown, Textarea } from "@/components/ui/field";
import { ACCENT_PRESETS, DEFAULT_EVENT_ACCENT, normalizeAccentHex } from "@/lib/theme/accent";
import { ColorPicker } from "@/components/ui/color-picker";
import { cn } from "@/lib/cn";
import {
  deleteWebsiteContent,
  saveEventPage,
  saveFaq,
  saveHighlight,
  saveResource,
  saveSpeaker,
  saveSponsor,
  uploadEventSpeakerPhoto,
  uploadEventSponsorLogo,
} from "@/app/actions/event-website";
import { RichTextEditor } from "@/components/editor/RichTextEditor";
import { ConfirmationDialog } from "@/components/feedback/ConfirmationDialog";
import { useToast } from "@/components/feedback/ToastProvider";
import { useUnsavedChangesGuard } from "@/components/forms/useUnsavedChangesGuard";
import { useEventTabs } from "@/components/event-dashboard/EventDashboardTabs";
import { UnsavedChangesBar } from "@/components/event-dashboard/event-page/UnsavedChangesBar";
import {
  countPageChanges,
  normalizeSections,
  parseAccentInput,
  sectionLabel,
  sectionNote,
  type PageSection,
  type PageSettings,
} from "@/components/event-dashboard/event-page/summary";

type ContentKind = "highlight" | "speaker" | "sponsor" | "resource" | "faq";
type ContentRow = {
  id: string;
  title: string;
  description: string;
  visibility: string;
  values: Record<string, string | number | null>;
};
type SaveAction = (input: unknown) => Promise<{ ok: boolean; error?: string }>;

/** Read-only facts for the section notes and the live phone preview (computed on the server). */
export type EventPagePreviewData = {
  title: string;
  dateLine: string;
  privacyType: string;
  location: string;
  isOnline: boolean;
  aboutExcerpt: string;
  sessionCount: number;
  /** First few published sessions: start time + title. */
  sessionLines: Array<{ lead: string; text: string }>;
  /** Link to the schedule workspace, only when the viewer may manage it. */
  scheduleHref: string | null;
};

type Props = {
  organisationSlug: string;
  eventId: string;
  eventSlug: string;
  /** The Details sub-tab is owner/admin only; co-organisers with EDIT_DETAILS edit page content here. */
  canEditDetails?: boolean;
  page: {
    tagline: string;
    logoUrl: string | null;
    accentColor: string | null;
    aboutHtml: string;
    sections: PageSection[];
  } | null;
  highlights: ContentRow[];
  speakers: ContentRow[];
  sponsors: ContentRow[];
  resources: ContentRow[];
  faqs: ContentRow[];
  preview?: EventPagePreviewData;
  /** Rendered first in the editor column (e.g. the programme card). */
  programme?: ReactNode;
};

const CONTENT_FOR_SECTION: Partial<Record<string, ContentKind>> = {
  HIGHLIGHTS: "highlight",
  SPEAKERS: "speaker",
  SPONSORS: "sponsor",
  FAQ: "faq",
  RESOURCES: "resource",
};
const collectionId = (kind: ContentKind) => `event-page-${kind}s`;

function contentInput(
  kind: ContentKind,
  target: { organisationSlug: string; eventId: string },
  values: Record<string, string | number | null>,
  id: string | undefined,
  form: FormData,
) {
  const title = String(form.get("title") ?? "");
  const description = String(form.get("description") ?? "");
  const visibility = String(form.get("visibility") ?? "PUBLISHED");
  const shared = { ...target, ...values, ...(id ? { id } : {}), visibility };
  if (kind === "faq")
    return { ...shared, question: title, answerHtml: description };
  if (kind === "speaker")
    return {
      ...shared,
      title,
      bioHtml: description,
      headline: String(form.get("headline") ?? ""),
      organisation: String(form.get("organisation") ?? ""),
      websiteUrl: String(form.get("websiteUrl") ?? ""),
      linkedinUrl: String(form.get("linkedinUrl") ?? ""),
      xUrl: String(form.get("xUrl") ?? ""),
    };
  if (kind === "sponsor")
    return {
      ...shared,
      title,
      description,
      websiteUrl: String(form.get("websiteUrl") ?? ""),
      tier: String(form.get("tier") ?? "PARTNER"),
    };
  if (kind === "resource")
    return {
      ...shared,
      title,
      description,
      externalUrl: String(form.get("externalUrl") ?? ""),
    };
  return {
    ...shared,
    title,
    description,
    ...(kind === "highlight" ? { icon: String(form.get("icon") ?? "") } : {}),
  };
}

const visibilityTones: Record<string, ChipTone> = { PUBLISHED: "success", DRAFT: "neutral", HIDDEN: "outline" };
const visibilityLabels: Record<string, string> = { PUBLISHED: "Published", DRAFT: "Draft", HIDDEN: "Hidden" };

function VisibilitySelect({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <Field label="Visibility">
      <Dropdown name="visibility" value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="PUBLISHED">Published</option>
        <option value="DRAFT">Draft</option>
        <option value="HIDDEN">Hidden</option>
      </Dropdown>
    </Field>
  );
}

function ContentCollection({
  title,
  kind,
  rows,
  action,
  target,
  pending,
  openAddRequest,
  onSave,
  onDelete,
  onError,
  onDraftChange,
}: {
  title: string;
  kind: ContentKind;
  rows: ContentRow[];
  action: SaveAction;
  target: { organisationSlug: string; eventId: string };
  pending: boolean;
  /** Bumped by the sections list to open the "Add" form. */
  openAddRequest: number;
  onSave: (action: SaveAction, input: unknown) => void;
  onDelete: (row: ContentRow) => void;
  onError: (message: string) => void;
  onDraftChange: (kind: ContentKind, dirty: boolean) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [newItemFormKey, setNewItemFormKey] = useState(0);
  const [formVisibility, setFormVisibility] = useState("PUBLISHED");
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [draftDirty, setDraftDirty] = useState(false);
  const [handledAddRequest, setHandledAddRequest] = useState(openAddRequest);
  const itemName = title === "FAQs" ? "FAQ" : title.slice(0, -1);
  const supportsRichText = kind === "faq" || kind === "speaker";
  const headingId = `${collectionId(kind)}-title`;

  useEffect(() => {
    onDraftChange(kind, draftDirty);
  }, [draftDirty, kind, onDraftChange]);

  const openNewItemForm = () => {
    setNewItemFormKey((key) => key + 1);
    setPhotoFile(null);
    setFormVisibility("PUBLISHED");
    setEditing(null);
    setDraftDirty(false);
    setAdding(true);
  };
  // The sections list asked to add an item: open the form once per request (adjust during render).
  if (openAddRequest !== handledAddRequest) {
    setHandledAddRequest(openAddRequest);
    if (!adding) openNewItemForm();
  }
  const closeForms = () => {
    setPhotoFile(null);
    setAdding(false);
    setEditing(null);
    setDraftDirty(false);
  };
  const submit = async (
    event: FormEvent<HTMLFormElement>,
    row?: ContentRow,
  ) => {
    const formElement = event.currentTarget;
    event.preventDefault();
    let values = row?.values ?? { sortOrder: rows.length };
    if ((kind === "speaker" || kind === "sponsor") && photoFile) {
      setUploadingPhoto(true);
      const photo = new FormData();
      photo.set("organisationSlug", target.organisationSlug);
      photo.set("eventId", target.eventId);
      photo.set("file", photoFile);
      const upload =
        kind === "speaker"
          ? await uploadEventSpeakerPhoto(photo)
          : await uploadEventSponsorLogo(photo);
      setUploadingPhoto(false);
      const assetLabel = kind === "speaker" ? "speaker photo" : "sponsor logo";
      if (!upload.ok) {
        onError(upload.error);
        return;
      }
      if (!upload.data) {
        onError(`Could not upload the ${assetLabel}.`);
        return;
      }
      values = {
        ...values,
        [kind === "speaker" ? "photoUrl" : "logoUrl"]: upload.data.url,
      };
      setPhotoFile(null);
    }
    onSave(
      action,
      contentInput(kind, target, values, row?.id, new FormData(formElement)),
    );
    closeForms();
  };
  const markDraft = () => setDraftDirty(true);
  const photoPicker =
    kind === "speaker" || kind === "sponsor" ? (
      <div className="flex flex-wrap items-center gap-2.5">
        <label className={cn("inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-full border border-line-strong bg-canvas px-3.5 text-sm font-semibold text-ink transition-colors hover:bg-subtle focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-(--yy-focus)", (pending || uploadingPhoto) && "pointer-events-none opacity-50")}>
          <Upload aria-hidden className="size-4" />
          Choose {kind === "speaker" ? "speaker photo" : "sponsor logo"}
          <input
            className="sr-only"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            disabled={pending || uploadingPhoto}
            onChange={(event) => setPhotoFile(event.target.files?.[0] ?? null)}
          />
        </label>
        <span className="text-caption text-ink-muted wrap-anywhere">
          {photoFile ? photoFile.name : "JPEG, PNG, or WebP · up to 5 MB"}
        </span>
      </div>
    ) : null;
  const destinationUrlField = (row?: ContentRow) =>
    kind === "speaker" || kind === "sponsor" ? (
      <Field label="Destination URL" helperText={`Where guests go when they select the ${kind === "speaker" ? "speaker photo" : "sponsor logo"}.`}>
        <Input name="websiteUrl" type="url" defaultValue={String(row?.values.websiteUrl ?? "")} placeholder="https://example.com" />
      </Field>
    ) : null;
  const metadataFields = (row?: ContentRow) => (
    <>
      {kind === "highlight" ? (
        <Field label="Icon" helperText="Optional short icon or emoji shown with this highlight.">
          <Input name="icon" defaultValue={String(row?.values.icon ?? "")} />
        </Field>
      ) : null}
      {kind === "speaker" ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Headline"><Input name="headline" defaultValue={String(row?.values.headline ?? "")} /></Field>
          <Field label="Organisation"><Input name="organisation" defaultValue={String(row?.values.organisation ?? "")} /></Field>
          <Field label="LinkedIn URL"><Input name="linkedinUrl" type="url" defaultValue={String(row?.values.linkedinUrl ?? "")} /></Field>
          <Field label="X URL"><Input name="xUrl" type="url" defaultValue={String(row?.values.xUrl ?? "")} /></Field>
        </div>
      ) : null}
      {kind === "sponsor" ? (
        <Field label="Sponsor tier">
          <Dropdown name="tier" defaultValue={String(row?.values.tier ?? "PARTNER")}>
            <option value="PLATINUM">Platinum</option>
            <option value="GOLD">Gold</option>
            <option value="SILVER">Silver</option>
            <option value="PARTNER">Partner</option>
            <option value="COMMUNITY_PARTNER">Community partner</option>
          </Dropdown>
        </Field>
      ) : null}
    </>
  );
  const itemForm = (row?: ContentRow) => (
    <>
      <Field label={kind === "faq" ? "Question" : "Name"} required>
        <Input name="title" defaultValue={row?.title} />
      </Field>
      {photoPicker}
      {destinationUrlField(row)}
      {metadataFields(row)}
      {kind === "resource" ? (
        <Field label="Resource link" required helperText="Paste the public URL guests should open.">
          <Input name="externalUrl" defaultValue={row ? String(row.values.externalUrl ?? "") : undefined} />
        </Field>
      ) : null}
      {supportsRichText ? (
        <RichTextEditor
          name="description"
          label={kind === "faq" ? "Answer" : "Description"}
          defaultValue={row?.description}
          minHeight={88}
        />
      ) : (
        <Field label="Description">
          <Textarea name="description" rows={2} defaultValue={row?.description} />
        </Field>
      )}
      <VisibilitySelect value={formVisibility} onChange={setFormVisibility} />
    </>
  );
  return (
    <section id={collectionId(kind)} aria-labelledby={headingId} tabIndex={-1} className="scroll-mt-24 rounded-2xl border border-line bg-canvas p-5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--yy-focus)">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 id={headingId} className="text-title text-ink">{title}</h3>
          <p className="text-caption text-ink-muted">{rows.length === 0 ? "Nothing added yet" : `${rows.length} added`}</p>
        </div>
        <Button
          size="sm"
          variant="secondary"
          startIcon={adding ? undefined : <Plus />}
          aria-expanded={adding}
          onClick={() => {
            if (adding) closeForms();
            else openNewItemForm();
          }}
        >
          {adding ? "Close" : `Add ${itemName}`}
        </Button>
      </div>
      <form
        key={newItemFormKey}
        aria-label={`New ${itemName}`}
        hidden={!adding}
        onInputCapture={markDraft}
        onChangeCapture={markDraft}
        onSubmit={(event) => void submit(event)}
        className="mt-4 flex flex-col gap-4 rounded-xl border border-line bg-subtle p-4"
      >
        {itemForm()}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="primary" disabled={pending || uploadingPhoto}>
            Add {itemName}
          </Button>
          <Button variant="quiet" onClick={closeForms} disabled={uploadingPhoto}>
            Cancel
          </Button>
        </div>
      </form>
      {rows.length ? (
        <ul className="mt-3 flex flex-col gap-2">
          {rows.map((row) => (
            <li key={row.id} className="rounded-xl border border-line px-3.5 py-2.5">
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <span className="truncate text-[15px] font-semibold text-ink">{row.title}</span>
                  <Chip size="sm" tone={visibilityTones[row.visibility] ?? "neutral"}>{visibilityLabels[row.visibility] ?? row.visibility.toLowerCase()}</Chip>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button
                    size="sm"
                    variant="quiet"
                    aria-expanded={editing === row.id}
                    aria-label={`Edit ${row.title}`}
                    onClick={() => {
                      const nextEditing = editing === row.id ? null : row.id;
                      setEditing(nextEditing);
                      setAdding(false);
                      setPhotoFile(null);
                      setDraftDirty(false);
                      if (nextEditing) setFormVisibility(row.visibility);
                    }}
                  >
                    Edit
                  </Button>
                  <Button size="sm" variant="dangerQuiet" aria-label={`Remove ${row.title}`} onClick={() => onDelete(row)} disabled={pending}>
                    Remove
                  </Button>
                </div>
              </div>
              <form
                aria-label={`Edit ${row.title}`}
                hidden={editing !== row.id}
                onInputCapture={markDraft}
                onChangeCapture={markDraft}
                onSubmit={(event) => void submit(event, row)}
                className="mt-3 flex flex-col gap-4 rounded-xl border border-line bg-subtle p-4"
              >
                {itemForm(row)}
                <div className="flex flex-wrap gap-2">
                  <Button type="submit" variant="primary" disabled={pending || uploadingPhoto}>
                    Save changes
                  </Button>
                  <Button variant="quiet" onClick={closeForms} disabled={pending || uploadingPhoto}>
                    Cancel
                  </Button>
                </div>
              </form>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

export function EventWebsiteManager(props: Props) {
  const router = useRouter();
  const { openTab } = useEventTabs();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{
    kind: ContentKind;
    row: ContentRow;
  } | null>(null);
  const [baseline, setBaseline] = useState<PageSettings>(() => ({
    accentColor: props.page?.accentColor ?? "",
    sections: normalizeSections(props.page?.sections),
  }));
  const [accentColor, setAccentColor] = useState(baseline.accentColor);
  const [sections, setSections] = useState<readonly PageSection[]>(baseline.sections);
  const [contentDrafts, setContentDrafts] = useState<ReadonlySet<ContentKind>>(() => new Set());
  const [addRequests, setAddRequests] = useState<Record<ContentKind, number>>({ highlight: 0, speaker: 0, sponsor: 0, resource: 0, faq: 0 });

  const changeCount = countPageChanges(baseline, { accentColor, sections });
  const pageDirty = changeCount > 0;
  useUnsavedChangesGuard((pageDirty || contentDrafts.size > 0) && !pending);

  const accent = parseAccentInput(accentColor);
  const accentPreview = accent.valid && accent.value ? accent.value : accent.valid ? DEFAULT_EVENT_ACCENT : normalizeAccentHex(baseline.accentColor);
  const customAccent = accent.valid && Boolean(accent.value) && !ACCENT_PRESETS.some((preset) => preset.hex === accent.value);

  const onDraftChange = useCallback(
    (kind: ContentKind, dirty: boolean) =>
      setContentDrafts((current) => {
        if (current.has(kind) === dirty) return current;
        const next = new Set(current);
        if (dirty) next.add(kind);
        else next.delete(kind);
        return next;
      }),
    [],
  );

  const target = {
    organisationSlug: props.organisationSlug,
    eventId: props.eventId,
  };
  // `announce` also toasts the outcome, for saves started from the floating bar far below the callouts.
  const save = (action: SaveAction, input: unknown, onSuccess?: () => void, announce = false) =>
    startTransition(async () => {
      const result = await action(input);
      if (!result.ok) {
        setSaved(false);
        setError(result.error || "Could not save your changes.");
        if (announce) showToast(result.error || "Could not save your changes.", "error");
      } else {
        if (announce) showToast("Event page saved", "success");
        setError("");
        setSaved(true);
        onSuccess?.();
        router.refresh();
      }
    });
  const touch = () => setSaved(false);
  const moveSection = (index: number, direction: -1 | 1) => {
    touch();
    setSections((current) => {
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= current.length) return current;
      const next = [...current];
      [next[index], next[nextIndex]] = [next[nextIndex]!, next[index]!];
      return next.map((section, sortOrder) => ({ ...section, sortOrder }));
    });
  };
  const savePage = () => {
    if (!accent.valid) {
      setError("Use a hex colour such as #C2410C, or choose a preset.");
      showToast("Use a hex colour such as #C2410C, or choose a preset.", "error");
      return;
    }
    const draft = { accentColor: accent.value, sections };
    save(
      saveEventPage,
      {
        ...target,
        tagline: props.page?.tagline ?? "",
        logoUrl: props.page?.logoUrl ?? "",
        accentColor: accent.value,
        aboutHtml: props.page?.aboutHtml ?? "",
        sections,
      },
      () => {
        setBaseline(draft);
        setAccentColor(draft.accentColor);
      },
      true,
    );
  };
  const discard = () => {
    setAccentColor(baseline.accentColor);
    setSections(baseline.sections);
    setError("");
  };
  const remove = (kind: ContentKind) => (row: ContentRow) =>
    setDeleteTarget({ kind, row });

  const preview = props.preview;
  const noteData = {
    highlights: props.highlights,
    speakers: props.speakers,
    sponsors: props.sponsors,
    resources: props.resources,
    faqs: props.faqs,
    sessionCount: preview?.sessionCount ?? 0,
    location: preview?.location ?? "",
    isOnline: preview?.isOnline ?? false,
  };
  const rowsFor: Record<ContentKind, ContentRow[]> = {
    highlight: props.highlights,
    speaker: props.speakers,
    sponsor: props.sponsors,
    resource: props.resources,
    faq: props.faqs,
  };

  const goToCollection = (kind: ContentKind, add: boolean) => {
    if (add) setAddRequests((current) => ({ ...current, [kind]: current[kind] + 1 }));
    const node = document.getElementById(collectionId(kind));
    if (!node) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    node.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
    node.focus({ preventScroll: true });
  };

  const sectionAction = (type: string, label: string): ReactNode => {
    const kind = CONTENT_FOR_SECTION[type];
    const linkClass = "inline-flex min-h-9 items-center whitespace-nowrap rounded-full px-1.5 text-sm font-semibold text-ink underline-offset-4 hover:underline";
    if (kind) {
      const empty = rowsFor[kind].length === 0;
      return (
        <button type="button" className={linkClass} onClick={() => goToCollection(kind, empty)}>
          {empty ? "Add" : "Edit"}
          <span className="sr-only"> {label}</span>
        </button>
      );
    }
    if ((type === "ABOUT" || type === "VENUE") && props.canEditDetails !== false) {
      return (
        <button type="button" className={linkClass} onClick={() => openTab("page", "details")}>
          Edit in Details
          <span className="sr-only"> ({label})</span>
        </button>
      );
    }
    if (type === "SCHEDULE" && preview?.scheduleHref) {
      return (
        <Link href={preview.scheduleHref} className={linkClass}>
          Open schedule
        </Link>
      );
    }
    return null;
  };

  const collections: Array<{ title: string; kind: ContentKind; action: SaveAction }> = [
    { title: "Highlights", kind: "highlight", action: saveHighlight },
    { title: "Speakers", kind: "speaker", action: saveSpeaker },
    { title: "Sponsors", kind: "sponsor", action: saveSponsor },
    { title: "Resources", kind: "resource", action: saveResource },
    { title: "FAQs", kind: "faq", action: saveFaq },
  ];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex min-w-0 flex-col gap-5">
          <Button asChild variant="secondary" size="sm" className="self-end">
            <a href={`/${props.organisationSlug}/${props.eventSlug}`} target="_blank" rel="noopener noreferrer">
              Open public page
              <ArrowUpRight aria-hidden className="size-4" />
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          </Button>
          {error ? <Callout tone="danger" role="alert">{error}</Callout> : null}
          {saved ? <Callout tone="success" role="status">Changes saved.</Callout> : null}
          {props.programme}

          <section aria-labelledby="event-page-colour-title" className="flex flex-col gap-3 rounded-2xl border border-line bg-canvas p-5">
            <div>
              <h2 id="event-page-colour-title" className="text-h4 text-ink">Colour</h2>
              <p className="mt-0.5 text-body-ui text-ink-muted">The accent for the hero band, buttons and links on the event page.</p>
            </div>
            <div role="group" aria-label="Accent presets" className="flex flex-wrap items-center gap-2">
              {ACCENT_PRESETS.map((preset) => {
                const selected = accent.valid && accentPreview === preset.hex;
                return (
                  <button
                    key={preset.hex}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => {
                      setAccentColor(preset.hex);
                      touch();
                    }}
                    className={cn(
                      "inline-flex min-h-10 items-center gap-2 rounded-full bg-canvas pl-2 pr-3.5 text-sm font-semibold text-ink transition-colors hover:bg-subtle",
                      selected ? "border-2 border-ink" : "border border-line-strong",
                    )}
                  >
                    <span aria-hidden className="size-6 rounded-full" style={{ backgroundColor: preset.hex }} />
                    {preset.name}
                  </button>
                );
              })}
              <ColorPicker
                value={accent.valid ? accent.value : ""}
                defaultColor={DEFAULT_EVENT_ACCENT}
                onChange={(hex) => {
                  setAccentColor(hex);
                  touch();
                }}
                trigger={
                  <button
                    type="button"
                    aria-label={customAccent ? `Custom colour ${accentPreview}, change` : "Choose a custom colour"}
                    className={cn(
                      "inline-flex min-h-10 items-center gap-2 rounded-full bg-canvas pl-2 pr-3.5 text-sm font-semibold text-ink transition-colors hover:bg-subtle",
                      customAccent ? "border-2 border-ink" : "border border-line-strong",
                    )}
                  >
                    <span
                      aria-hidden
                      className="size-6 rounded-full"
                      style={{ background: customAccent ? accentPreview : "conic-gradient(#f43f5e, #f59e0b, #22c55e, #06b6d4, #6366f1, #d946ef, #f43f5e)" }}
                    />
                    {customAccent ? <span className="font-mono">{accentPreview}</span> : "Custom"}
                  </button>
                }
              />
            </div>
            {accent.valid ? null : <p className="text-caption text-danger-fg">The saved colour isn&apos;t a valid hex colour. Pick a preset or a custom colour.</p>}
          </section>

          <section aria-labelledby="event-page-sections-title" className="flex flex-col gap-3 rounded-2xl border border-line bg-canvas p-5">
            <div>
              <h2 id="event-page-sections-title" className="text-h4 text-ink">Sections</h2>
              <p className="mt-0.5 text-body-ui text-ink-muted">Reorder with the arrows. Turn off anything you don&apos;t need. Open a section to edit what&apos;s in it.</p>
            </div>
            <ol className="flex flex-col gap-2">
              {sections.map((section, index) => {
                const label = sectionLabel(section.type);
                return (
                  <li
                    key={section.type}
                    className={cn("flex items-center gap-2 rounded-xl border border-line py-2 pl-2.5 pr-2 sm:gap-3 sm:pl-3.5", section.isVisible ? "bg-canvas" : "bg-subtle")}
                  >
                    <GripVertical aria-hidden className="size-4 shrink-0 text-ink-disabled" />
                    <div className="flex min-w-0 flex-1 flex-col sm:flex-row sm:items-center sm:gap-3">
                      <div className="flex min-w-0 flex-1 flex-col">
                        <span className={cn("font-bold", section.isVisible ? "text-ink" : "text-ink-muted")}>{label}</span>
                        <span className="truncate text-caption text-ink-muted">{sectionNote(section.type, noteData)}</span>
                      </div>
                      <div className="-ml-1.5 sm:ml-0">{sectionAction(section.type, label)}</div>
                    </div>
                    <Switch
                      checked={section.isVisible}
                      aria-label={`Show ${label} on the event page`}
                      onCheckedChange={(checked) => {
                        touch();
                        setSections((current) => current.map((item) => (item.type === section.type ? { ...item, isVisible: checked } : item)));
                      }}
                    />
                    <div className="flex shrink-0 flex-col sm:flex-row sm:gap-0.5">
                      <IconButton label={`Move ${label} up`} size="sm" disabled={index === 0} onClick={() => moveSection(index, -1)}>
                        <ChevronUp />
                      </IconButton>
                      <IconButton label={`Move ${label} down`} size="sm" disabled={index === sections.length - 1} onClick={() => moveSection(index, 1)}>
                        <ChevronDown />
                      </IconButton>
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>

          <div className="mt-2">
            <h2 className="text-h4 text-ink">Section content</h2>
            <p className="mt-0.5 text-body-ui text-ink-muted">Each item is saved on its own. Drafts and hidden items stay off the public page.</p>
          </div>
          {collections.map((collection) => (
            <ContentCollection
              key={collection.kind}
              title={collection.title}
              kind={collection.kind}
              rows={rowsFor[collection.kind]}
              action={collection.action}
              target={target}
              pending={pending}
              openAddRequest={addRequests[collection.kind]}
              onSave={(action, input) => save(action, input)}
              onDelete={remove(collection.kind)}
              onError={setError}
              onDraftChange={onDraftChange}
            />
          ))}
        </div>

      <UnsavedChangesBar visible={pageDirty} count={changeCount} pending={pending} onDiscard={discard} onSave={savePage} />

      <ConfirmationDialog
        open={Boolean(deleteTarget)}
        title="Remove event-page content?"
        message={`Remove “${deleteTarget?.row.title ?? "this item"}” from the event page? This cannot be undone.`}
        confirmLabel="Remove"
        loading={pending}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (!deleteTarget) return;
          const current = deleteTarget;
          setDeleteTarget(null);
          save(deleteWebsiteContent, {
            ...target,
            kind: current.kind,
            id: current.row.id,
          });
        }}
      />
    </div>
  );
}
