"use client";

import { useEffect, useState, useTransition, type FormEvent } from "react";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import { Alert, Button, Checkbox, Collapse, Divider, FormControlLabel, MenuItem, Paper, Stack, TextField, Typography } from "@mui/material";
import { useRouter } from "next/navigation";
import { deleteWebsiteContent, saveEventPage, saveFaq, saveHighlight, saveResource, saveSpeaker, saveSponsor, uploadEventSpeakerPhoto, uploadEventSponsorLogo } from "@/app/actions/event-website";
import { RichTextEditor } from "@/components/editor/RichTextEditor";
import { ConfirmationDialog } from "@/components/feedback/ConfirmationDialog";
import { useUnsavedChangesGuard } from "@/components/forms/useUnsavedChangesGuard";

const sectionTypes = ["HERO", "ABOUT", "HIGHLIGHTS", "SCHEDULE", "SPEAKERS", "SPONSORS", "VENUE", "FAQ", "RESOURCES"] as const;
const sectionLabels: Record<(typeof sectionTypes)[number], string> = { HERO: "Hero", ABOUT: "About", HIGHLIGHTS: "Highlights", SCHEDULE: "Programme", SPEAKERS: "Speakers", SPONSORS: "Sponsors", VENUE: "Venue", FAQ: "FAQ", RESOURCES: "Resources" };
type ContentKind = "highlight" | "speaker" | "sponsor" | "resource" | "faq";
type ContentRow = { id: string; title: string; description: string; visibility: string; values: Record<string, string | number | null> };
type Section = { type: string; isVisible: boolean; sortOrder: number };
type SaveAction = (input: unknown) => Promise<{ ok: boolean; error?: string }>;
type Props = { organisationSlug: string; eventId: string; eventSlug: string; page: { tagline: string; logoUrl: string | null; accentColor: string | null; aboutHtml: string; sections: Section[] } | null; highlights: ContentRow[]; speakers: ContentRow[]; sponsors: ContentRow[]; resources: ContentRow[]; faqs: ContentRow[] };

function contentInput(kind: ContentKind, target: { organisationSlug: string; eventId: string }, values: Record<string, string | number | null>, id: string | undefined, form: FormData) {
  const title = String(form.get("title") ?? "");
  const description = String(form.get("description") ?? "");
  const visibility = String(form.get("visibility") ?? "PUBLISHED");
  const shared = { ...target, ...values, ...(id ? { id } : {}), visibility };
  if (kind === "faq") return { ...shared, question: title, answerHtml: description };
  if (kind === "speaker") return { ...shared, title, bioHtml: description, websiteUrl: String(form.get("websiteUrl") ?? "") };
  if (kind === "sponsor") return { ...shared, title, description, websiteUrl: String(form.get("websiteUrl") ?? "") };
  if (kind === "resource") return { ...shared, title, description, externalUrl: String(form.get("externalUrl") ?? "") };
  return { ...shared, title, description };
}

function ContentCollection({ title, kind, rows, action, target, pending, onSave, onDelete, onError }: { title: string; kind: ContentKind; rows: ContentRow[]; action: SaveAction; target: { organisationSlug: string; eventId: string }; pending: boolean; onSave: (action: SaveAction, input: unknown) => void; onDelete: (row: ContentRow) => void; onError: (message: string) => void }) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [formVisibility, setFormVisibility] = useState("PUBLISHED");
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const itemName = title === "FAQs" ? "FAQ" : title.slice(0, -1);
  const supportsRichText = kind === "faq" || kind === "speaker";
  const submit = async (event: FormEvent<HTMLFormElement>, row?: ContentRow) => { const formElement = event.currentTarget; event.preventDefault(); let values = row?.values ?? { sortOrder: rows.length }; if ((kind === "speaker" || kind === "sponsor") && photoFile) { setUploadingPhoto(true); const photo = new FormData(); photo.set("organisationSlug", target.organisationSlug); photo.set("eventId", target.eventId); photo.set("file", photoFile); const upload = kind === "speaker" ? await uploadEventSpeakerPhoto(photo) : await uploadEventSponsorLogo(photo); setUploadingPhoto(false); const assetLabel = kind === "speaker" ? "speaker photo" : "sponsor logo"; if (!upload.ok) { onError(upload.error); return; } if (!upload.data) { onError(`Could not upload the ${assetLabel}.`); return; } values = { ...values, [kind === "speaker" ? "photoUrl" : "logoUrl"]: upload.data.url }; setPhotoFile(null); } onSave(action, contentInput(kind, target, values, row?.id, new FormData(formElement))); setAdding(false); setEditing(null); };
  const photoPicker = kind === "speaker" || kind === "sponsor" ? <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap" }}><Button component="label" variant="outlined" size="small" disabled={pending || uploadingPhoto}>Choose {kind === "speaker" ? "speaker photo" : "sponsor logo"}<input hidden type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setPhotoFile(event.target.files?.[0] ?? null)} /></Button><Typography variant="caption" color="text.secondary">{photoFile ? photoFile.name : "JPEG, PNG, or WebP · up to 5 MB"}</Typography></Stack> : null;
  const destinationUrlField = (row?: ContentRow) => kind === "speaker" || kind === "sponsor" ? <TextField name="websiteUrl" label="Destination URL" type="url" defaultValue={String(row?.values.websiteUrl ?? "")} placeholder="https://example.com" helperText={`Where guests go when they select the ${kind === "speaker" ? "speaker photo" : "sponsor logo"}.`} size="small" /> : null;
  return <Paper variant="outlined" sx={{ p: { xs: 2, sm: 2.5 } }}><Stack spacing={1.5}>
    <Stack direction="row" spacing={2} sx={{ justifyContent: "space-between", alignItems: "center" }}>
      <Stack spacing={0.25}><Typography variant="h6">{title}</Typography><Typography variant="body2" color="text.secondary">{rows.length} added</Typography></Stack>
      <Button size="small" variant="outlined" onClick={() => { setAdding((value) => !value); setEditing(null); setFormVisibility("PUBLISHED"); }}>{adding ? "Close" : `Add ${itemName}`}</Button>
    </Stack>
    <Collapse in={adding}><Stack component="form" spacing={1.5} onSubmit={(event) => void submit(event)} sx={{ pt: 1 }}><TextField name="title" label={kind === "faq" ? "Question" : "Name"} required size="small" />{photoPicker}{destinationUrlField()}{kind === "resource" ? <TextField name="externalUrl" label="Resource link" helperText="Paste the public URL guests should open." required size="small" /> : null}{supportsRichText ? <RichTextEditor name="description" label={kind === "faq" ? "Answer" : "Description"} minHeight={88} /> : <TextField name="description" label="Description" multiline minRows={2} size="small" />}<TextField name="visibility" label="Visibility" select value={formVisibility} onChange={(event) => setFormVisibility(event.target.value)} size="small"><MenuItem value="PUBLISHED">Published</MenuItem><MenuItem value="DRAFT">Draft</MenuItem></TextField><Stack direction="row" spacing={1}><Button type="submit" variant="contained" disabled={pending || uploadingPhoto}>Add {itemName}</Button><Button onClick={() => setAdding(false)} disabled={uploadingPhoto}>Cancel</Button></Stack></Stack></Collapse>
    {rows.length ? <Stack divider={<Divider flexItem />}>{rows.map((row) => <Stack key={row.id} spacing={1} sx={{ py: 1 }}>
      <Stack direction="row" spacing={1} sx={{ justifyContent: "space-between", alignItems: "center" }}><Stack spacing={0.25}><Typography>{row.title}</Typography><Typography variant="caption" color="text.secondary">{row.visibility.toLowerCase()}</Typography></Stack><Stack direction="row" spacing={0.5}><Button size="small" onClick={() => { const nextEditing = editing === row.id ? null : row.id; setEditing(nextEditing); setAdding(false); if (nextEditing) setFormVisibility(row.visibility); }}>Edit</Button><Button color="error" size="small" onClick={() => onDelete(row)} disabled={pending}>Remove</Button></Stack></Stack>
      <Collapse in={editing === row.id}><Stack component="form" spacing={1.5} onSubmit={(event) => void submit(event, row)} sx={{ pt: 1 }}><TextField name="title" label={kind === "faq" ? "Question" : "Name"} defaultValue={row.title} required size="small" />{photoPicker}{destinationUrlField(row)}{kind === "resource" ? <TextField name="externalUrl" label="Resource link" defaultValue={String(row.values.externalUrl ?? "")} helperText="Paste the public URL guests should open." required size="small" /> : null}{supportsRichText ? <RichTextEditor name="description" label={kind === "faq" ? "Answer" : "Description"} defaultValue={row.description} minHeight={88} /> : <TextField name="description" label="Description" defaultValue={row.description} multiline minRows={2} size="small" />}<TextField name="visibility" label="Visibility" select value={formVisibility} onChange={(event) => setFormVisibility(event.target.value)} size="small"><MenuItem value="PUBLISHED">Published</MenuItem><MenuItem value="DRAFT">Draft</MenuItem></TextField><Stack direction="row" spacing={1}><Button type="submit" variant="contained" disabled={pending || uploadingPhoto}>Save changes</Button><Button onClick={() => setEditing(null)} disabled={pending || uploadingPhoto}>Cancel</Button></Stack></Stack></Collapse>
    </Stack>)}</Stack> : <Typography variant="body2" color="text.secondary">Nothing has been added yet.</Typography>}
  </Stack></Paper>;
}

export function EventWebsiteManager(props: Props) {
  const router = useRouter(); const [pending, startTransition] = useTransition(); const [error, setError] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<{ kind: ContentKind; row: ContentRow } | null>(null);
  const [dirty, setDirty] = useState(false);
  useUnsavedChangesGuard(dirty && !pending);
  useEffect(() => {
    const markPageDirty = (event: Event) => {
      const node = event.target;
      if (!(node instanceof HTMLElement)) return;
      const form = node.closest("form");
      const submit = form?.querySelector<HTMLButtonElement>('button[type="submit"]');
      if (submit?.textContent?.trim() === "Save event page") setDirty(true);
    };
    document.addEventListener("input", markPageDirty, true);
    document.addEventListener("change", markPageDirty, true);
    return () => {
      document.removeEventListener("input", markPageDirty, true);
      document.removeEventListener("change", markPageDirty, true);
    };
  }, []);
  const [sections, setSections] = useState<Section[]>(() => sectionTypes.map((type, sortOrder) => props.page?.sections.find((section) => section.type === type) ?? { type, isVisible: true, sortOrder }));
  const target = { organisationSlug: props.organisationSlug, eventId: props.eventId };
  const save = (action: SaveAction, input: unknown, clearDirty = false) => startTransition(async () => { const result = await action(input); if (!result.ok) setError(result.error || "Could not save your changes."); else { setError(""); if (clearDirty) setDirty(false); router.refresh(); } });
  const moveSection = (index: number, direction: -1 | 1) => { setDirty(true); setSections((current) => { const nextIndex = index + direction; if (nextIndex < 0 || nextIndex >= current.length) return current; const next = [...current]; [next[index], next[nextIndex]] = [next[nextIndex], next[index]]; return next.map((section, sortOrder) => ({ ...section, sortOrder })); }); };
  const savePage = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const form = new FormData(event.currentTarget); save(saveEventPage, { ...target, tagline: String(form.get("tagline") ?? ""), logoUrl: String(form.get("logoUrl") ?? ""), accentColor: String(form.get("accentColor") ?? ""), aboutHtml: String(form.get("aboutHtml") ?? ""), sections }, true); };
  const remove = (kind: ContentKind) => (row: ContentRow) => setDeleteTarget({ kind, row });
  return <Stack spacing={2}>{error ? <Alert severity="error">{error}</Alert> : null}<Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}><Stack component="form" spacing={2} onSubmit={savePage}><Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ justifyContent: "space-between", alignItems: { sm: "center" } }}><div><Typography variant="h6">Event page</Typography><Typography variant="body2" color="text.secondary">Set the essentials, choose what visitors see, and preview the result.</Typography></div><Button component="a" href={`/${props.organisationSlug}/${props.eventSlug}`} target="_blank" rel="noopener noreferrer" endIcon={<OpenInNewIcon />}>Preview</Button></Stack><TextField name="tagline" label="Tagline" defaultValue={props.page?.tagline ?? ""} size="small" helperText="A short line beneath the event title." /><Stack direction={{ xs: "column", sm: "row" }} spacing={2}><TextField name="logoUrl" label="Logo URL" defaultValue={props.page?.logoUrl ?? ""} size="small" fullWidth /><TextField name="accentColor" label="Accent colour" defaultValue={props.page?.accentColor ?? ""} placeholder="#2563EB" size="small" fullWidth /></Stack><RichTextEditor name="aboutHtml" label="About the event" defaultValue={props.page?.aboutHtml ?? ""} helperText="Use the toolbar to format text—no HTML needed." minHeight={140} /><Divider /><Stack spacing={0.5}><Typography variant="subtitle1" sx={{ fontWeight: 600 }}>Page sections</Typography><Typography variant="body2" color="text.secondary">Turn sections on or off, then arrange them in the order guests should see.</Typography></Stack><Stack spacing={0.25}>{sections.map((section, index) => <Stack key={section.type} direction="row" spacing={1} sx={{ alignItems: "center", justifyContent: "space-between" }}><FormControlLabel control={<Checkbox size="small" checked={section.isVisible} onChange={(_, isVisible) => setSections((current) => current.map((item) => item.type === section.type ? { ...item, isVisible } : item))} />} label={sectionLabels[section.type as keyof typeof sectionLabels] ?? section.type} sx={{ m: 0 }} /><Stack direction="row" spacing={0.5}><Button size="small" disabled={index === 0} onClick={() => moveSection(index, -1)} aria-label={`Move ${section.type} up`}>Up</Button><Button size="small" disabled={index === sections.length - 1} onClick={() => moveSection(index, 1)} aria-label={`Move ${section.type} down`}>Down</Button></Stack></Stack>)}</Stack><Button type="submit" variant="contained" disabled={pending} sx={{ alignSelf: "flex-start" }}>Save event page</Button></Stack></Paper><ContentCollection title="Highlights" kind="highlight" rows={props.highlights} action={saveHighlight} target={target} pending={pending} onSave={save} onDelete={remove("highlight")} onError={setError} /><ContentCollection title="Speakers" kind="speaker" rows={props.speakers} action={saveSpeaker} target={target} pending={pending} onSave={save} onDelete={remove("speaker")} onError={setError} /><ContentCollection title="Sponsors" kind="sponsor" rows={props.sponsors} action={saveSponsor} target={target} pending={pending} onSave={save} onDelete={remove("sponsor")} onError={setError} /><ContentCollection title="Resources" kind="resource" rows={props.resources} action={saveResource} target={target} pending={pending} onSave={save} onDelete={remove("resource")} onError={setError} /><ContentCollection title="FAQs" kind="faq" rows={props.faqs} action={saveFaq} target={target} pending={pending} onSave={save} onDelete={remove("faq")} onError={setError} /><ConfirmationDialog open={Boolean(deleteTarget)} title="Remove event-page content?" message={`Remove “${deleteTarget?.row.title ?? "this item"}” from the event page? This cannot be undone.`} confirmLabel="Remove" loading={pending} onCancel={() => setDeleteTarget(null)} onConfirm={() => { if (!deleteTarget) return; const current = deleteTarget; setDeleteTarget(null); save(deleteWebsiteContent, { ...target, kind: current.kind, id: current.row.id }); }} /></Stack>;
}
