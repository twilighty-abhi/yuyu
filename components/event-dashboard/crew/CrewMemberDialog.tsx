"use client";

import { useId, useState, type FormEvent } from "react";
import { addCrewMember, updateCrewMember, uploadCrewPhoto } from "@/app/actions/crew";
import { ImageUploadPicker } from "@/components/forms/ImageUploadPicker";
import { Button } from "@/components/ui/button";
import { SwitchRow } from "@/components/ui/choice";
import { Callout } from "@/components/ui/display";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/field";
import type { OrganiserCrewMember } from "@/lib/core/crew";

/** Limits mirror `crewProfileSchema` in lib/core/crew.ts; the server re-validates. */
const LIMITS = { name: 120, email: 254, foodPreference: 80, role: 120, bio: 600, linkedinUrl: 500 } as const;

/**
 * Add or edit one crew member (Guests → Crew). A chosen photo is uploaded
 * first through `uploadCrewPhoto`, then the form is saved; both actions
 * re-check MANAGE_REGISTRATIONS on the server.
 */
export function CrewMemberDialog({
  organisationSlug,
  eventId,
  member,
  foodSuggestions,
  onClose,
  onSaved,
}: {
  organisationSlug: string;
  eventId: string;
  /** The member being edited, or null to add one. */
  member: OrganiserCrewMember | null;
  foodSuggestions: readonly string[];
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const foodListId = useId();
  const editing = member != null;
  const [name, setName] = useState(member?.name ?? "");
  const [email, setEmail] = useState(member?.email ?? "");
  const [foodPreference, setFoodPreference] = useState(member?.foodPreference ?? "");
  const [role, setRole] = useState(member?.role ?? "");
  const [bio, setBio] = useState(member?.bio ?? "");
  const [linkedinUrl, setLinkedinUrl] = useState(member?.linkedinUrl ?? "");
  const [showOnPage, setShowOnPage] = useState(member?.showOnPage ?? true);
  // The stored photo stays unless it is removed or replaced by a new file.
  const [photoUrl, setPhotoUrl] = useState(member?.photoUrl ?? "");
  const [photo, setPhoto] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      let savedPhotoUrl = photoUrl;
      if (photo) {
        const formData = new FormData();
        formData.set("organisationSlug", organisationSlug);
        formData.set("eventId", eventId);
        formData.set("file", photo);
        const uploaded = await uploadCrewPhoto(formData);
        if (!uploaded.ok || !uploaded.data) {
          setError(uploaded.ok ? "Could not upload the photo." : uploaded.error);
          return;
        }
        savedPhotoUrl = uploaded.data.url;
        setPhotoUrl(savedPhotoUrl);
        setPhoto(null);
      }
      const values = { name, email, foodPreference, role, bio, photoUrl: savedPhotoUrl, linkedinUrl, showOnPage };
      const result = member
        ? await updateCrewMember({ organisationSlug, eventId, memberId: member.id, member: values })
        : await addCrewMember({ organisationSlug, eventId, member: values });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onSaved(member ? `${name.trim()} updated` : `${name.trim()} added to the crew. Their ticket is on its way.`);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(next) => { if (!next && !busy) onClose(); }}>
      <DialogContent size="md">
        <form className="flex min-h-0 flex-col" onSubmit={submit} aria-busy={busy || undefined}>
          <DialogHeader
            title={editing ? `Edit ${member.name}` : "Add crew member"}
            description={
              editing
                ? "Changes to the name, role, bio, photo and LinkedIn show on the event page when this person is shown there."
                : "We email them a ticket for check-in. If they already registered, that registration becomes their crew ticket. Crew count as going but don't use up attendee places."
            }
          />
          <DialogBody className="flex flex-col gap-4">
            {error ? <Callout tone="danger" role="alert">{error}</Callout> : null}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Name" required>
                <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={LIMITS.name} autoComplete="off" disabled={busy} autoFocus />
              </Field>
              <Field label="Email" required helperText={editing ? "Never shown on the event page." : "Their ticket is sent here. Never shown on the event page."}>
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={LIMITS.email} autoComplete="off" disabled={busy} />
              </Field>
              <Field label="Role" optional helperText="For example: Volunteer, Registration desk">
                <Input value={role} onChange={(e) => setRole(e.target.value)} maxLength={LIMITS.role} disabled={busy} />
              </Field>
              <Field label="Food preference" optional helperText="Only organisers see this.">
                <Input value={foodPreference} onChange={(e) => setFoodPreference(e.target.value)} maxLength={LIMITS.foodPreference} list={foodListId} autoComplete="off" disabled={busy} />
              </Field>
            </div>
            <datalist id={foodListId}>
              {foodSuggestions.map((value) => <option key={value} value={value} />)}
            </datalist>
            <Field label="Short bio" optional helperText={`${bio.length}/${LIMITS.bio}`}>
              <Textarea value={bio} onChange={(e) => setBio(e.target.value)} maxLength={LIMITS.bio} rows={3} disabled={busy} />
            </Field>
            <div className="flex flex-col gap-1.5">
              <span className="text-label text-ink">
                Photo<span className="ml-1.5 font-normal text-ink-muted">Optional</span>
              </span>
              <ImageUploadPicker
                label="Photo"
                placeholder="No photo"
                objectFit="cover"
                initialUrl={member?.photoUrl ?? ""}
                disabled={busy}
                onChange={(file) => {
                  setPhoto(file);
                  if (!file) setPhotoUrl("");
                }}
              />
            </div>
            <Field label="LinkedIn URL" optional>
              <Input type="url" value={linkedinUrl} onChange={(e) => setLinkedinUrl(e.target.value)} maxLength={LIMITS.linkedinUrl} placeholder="https://www.linkedin.com/in/…" inputMode="url" disabled={busy} />
            </Field>
            <SwitchRow
              label="Show on event page"
              description="Shown in the Crew section with their name, role, bio, photo and LinkedIn. Email and food preference are never shown."
              checked={showOnPage}
              onCheckedChange={setShowOnPage}
              disabled={busy}
            />
          </DialogBody>
          <DialogFooter>
            <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button type="submit" variant="primary" loading={busy} disabled={!name.trim() || !email.trim()}>
              {editing ? "Save changes" : "Add and send ticket"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
