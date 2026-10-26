"use client";

import { useId, useState, type FormEvent } from "react";
import { CheckCircle2 } from "lucide-react";
import { joinCrew, uploadCrewPhotoWithLink } from "@/app/actions/crew";
import { ImageUploadPicker } from "@/components/forms/ImageUploadPicker";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/display";
import { Field, Input, Textarea } from "@/components/ui/field";

type Props = {
  /** The crew link token: the capability for both the photo upload and the sign-up. */
  token: string;
  foodSuggestions: string[];
};

/** Limits mirror `crewProfileSchema` in lib/core/crew.ts; the server re-validates. */
const LIMITS = { name: 120, email: 254, foodPreference: 80, role: 120, bio: 600, linkedinUrl: 500 } as const;

export function CrewJoinForm({ token, foodSuggestions }: Props) {
  const foodListId = useId();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [foodPreference, setFoodPreference] = useState("");
  const [role, setRole] = useState("");
  const [bio, setBio] = useState("");
  const [linkedinUrl, setLinkedinUrl] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      let photoUrl = "";
      if (photo) {
        const formData = new FormData();
        formData.set("token", token);
        formData.set("file", photo);
        const uploaded = await uploadCrewPhotoWithLink(formData);
        if (!uploaded.ok || !uploaded.data) {
          setError(uploaded.ok ? "Could not upload the photo." : uploaded.error);
          return;
        }
        photoUrl = uploaded.data.url;
      }
      const result = await joinCrew({
        token,
        member: { name, email, foodPreference, role, bio, photoUrl, linkedinUrl },
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setDone(true);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <Callout tone="success" role="status">
        You’re on the crew — your ticket is on its way to your email. The organisers will review your profile before it appears on the event page.
      </Callout>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      {error ? <Callout tone="danger" role="alert">{error}</Callout> : null}
      <Field label="Name" required>
        <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={LIMITS.name} autoComplete="name" disabled={busy} />
      </Field>
      <Field label="Email" required helperText="Your ticket is sent here. It is never shown on the event page.">
        <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={LIMITS.email} autoComplete="email" disabled={busy} />
      </Field>
      <Field label="Food preference" optional helperText="Only the organisers see this.">
        <Input value={foodPreference} onChange={(e) => setFoodPreference(e.target.value)} maxLength={LIMITS.foodPreference} list={foodListId} disabled={busy} />
      </Field>
      <datalist id={foodListId}>
        {foodSuggestions.map((value) => <option key={value} value={value} />)}
      </datalist>
      <Field label="Role" optional helperText="For example: Volunteer, Registration desk">
        <Input value={role} onChange={(e) => setRole(e.target.value)} maxLength={LIMITS.role} disabled={busy} />
      </Field>
      <Field label="Short bio" optional helperText={`${bio.length}/${LIMITS.bio}`}>
        <Textarea value={bio} onChange={(e) => setBio(e.target.value)} maxLength={LIMITS.bio} rows={3} disabled={busy} />
      </Field>
      <div className="flex flex-col gap-1.5">
        <span className="text-label text-ink">
          Photo<span className="ml-1.5 font-normal text-ink-muted">Optional</span>
        </span>
        <ImageUploadPicker label="Photo" placeholder="No photo" objectFit="cover" disabled={busy} onChange={(file) => setPhoto(file)} />
      </div>
      <Field label="LinkedIn URL" optional>
        <Input type="url" value={linkedinUrl} onChange={(e) => setLinkedinUrl(e.target.value)} maxLength={LIMITS.linkedinUrl} placeholder="https://www.linkedin.com/in/…" inputMode="url" disabled={busy} />
      </Field>
      <Button type="submit" variant="primary" disabled={busy} aria-busy={busy || undefined}>
        {busy ? "Joining…" : <><CheckCircle2 aria-hidden className="size-4" /> Join the crew</>}
      </Button>
    </form>
  );
}
