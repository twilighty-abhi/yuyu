"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useAuthSession } from "@/components/auth/useAuthSession";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { RsvpStatus } from "@prisma/client";
import { CheckCircle2, Download } from "lucide-react";
import type { RegistrationFieldDefinition } from "@/components/rsvp/registrationTypes";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/display";
import { Field, Input } from "@/components/ui/field";
import { RegistrationQuestions, focusQuestion, useRegistrationAnswers } from "@/components/rsvp/QuestionField";
import { identityErrors } from "@/components/rsvp/registrationAnswers";
import { TeamRegistrationFields, useTeamRegistration, type TeamRegistrationConfig } from "@/components/rsvp/TeamRegistrationFields";

async function postRsvp(body: unknown) {
  const res = await fetch("/api/rsvp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  let data: { ok?: boolean; error?: string; data?: { ticketToken?: string; status?: RsvpStatus } } = {};
  try {
    data = (await res.json()) as {
      ok?: boolean;
      error?: string;
      data?: { ticketToken?: string; status?: RsvpStatus };
    };
  } catch {
    /* empty */
  }
  if (res.status === 429) {
    return {
      ok: false as const,
      error: data.error ?? "Too many requests. Try again later.",
    };
  }
  if (!res.ok) {
    return {
      ok: false as const,
      error: data.error ?? "Could not save your RSVP.",
    };
  }
  if (data.ok) {
    return {
      ok: true as const,
      ticketToken: data.data?.ticketToken ?? "",
      status: data.data?.status ?? null,
    };
  }
  return {
    ok: false as const,
    error: data.error ?? "Could not save your RSVP.",
  };
}

function storageKey(params: {
  orgSlug: string;
  eventSlug?: string;
  eventInstanceId?: string;
}) {
  const suffix = params.eventInstanceId
    ? `i:${params.eventInstanceId}`
    : `e:${params.eventSlug ?? ""}`;
  return `yuyu:rsvp:${params.orgSlug}:${suffix}`;
}

function safeJsonParse<T>(v: string | null): T | null {
  if (!v) return null;
  try {
    return JSON.parse(v) as T;
  } catch {
    return null;
  }
}

export function RsvpForm(props: {
  orgSlug: string;
  eventSlug?: string;
  eventInstanceId?: string;
  registrationFields?: RegistrationFieldDefinition[];
  /** Team event settings (docs/TEAMS.md); omit for individual registration. */
  team?: TeamRegistrationConfig | null;
  /** Lets a containing event page update immediately after this tab saves an RSVP. */
  onRsvpSaved?: (rsvp: { ticketToken: string; status: RsvpStatus | null; teamMode: "create" | "join" | "solo" | null }) => void;
  /**
   * Re-render the surrounding server page after a save, so counts such as
   * "N going" update at once (`/api/rsvp` revalidates the page). This form's
   * confirmation is client state and survives the refresh.
   */
  refreshPageOnSave?: boolean;
}) {
  const { orgSlug, eventSlug, eventInstanceId, registrationFields, team, onRsvpSaved, refreshPageOnSave = false } = props;
  const router = useRouter();
  const { data: session, status } = useAuthSession();
  const lsKey = storageKey({ orgSlug, eventSlug, eventInstanceId });
  const [guestEmail, setGuestEmail] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [rsvpStatus, setRsvpStatus] = useState<RsvpStatus | null>(null);
  const [ticketToken, setTicketToken] = useState("");
  const [registeredAs, setRegisteredAs] = useState<"create" | "join" | "solo" | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const saved = safeJsonParse<{ ticketToken?: string }>(
        window.localStorage.getItem(lsKey),
      );
      setTicketToken(saved?.ticketToken ?? "");
    }, 0);
    return () => window.clearTimeout(timer);
  }, [lsKey]);
  const [pending, startTransition] = useTransition();

  const fields = useMemo(() => registrationFields ?? [], [registrationFields]);
  const questionsState = useRegistrationAnswers(fields);
  const teamState = useTeamRegistration(team);
  const [identity, setIdentity] = useState<{ name?: string; email?: string }>({});
  const formRef = useRef<HTMLDivElement & HTMLFormElement>(null);
  const requireName = !session?.user?.name?.trim();
  const isGuest = !session?.user;
  const problemCount = Object.keys(questionsState.errors).length + Object.values(identity).filter(Boolean).length + teamState.problemCount();

  /** Client-side checks first, so each question shows its own message; the server still decides. */
  function checkBeforeSubmit() {
    const firstTeamProblem = teamState.validate();
    const who = identityErrors({ name, email: guestEmail, requireName: isGuest || requireName, requireEmail: isGuest });
    const questionErrors = questionsState.validate();
    setIdentity(who);
    const firstQuestion = fields.find((field) => questionErrors[field.key])?.key;
    const first = firstTeamProblem ?? (who.name ? "__name" : who.email ? "__email" : firstQuestion);
    if (first) focusQuestion(formRef.current, first);
    return !first;
  }

  function submit() {
    setError(null);
    if (teamState.awaitingLink) return;
    if (!checkBeforeSubmit()) return;
    const teamIntent = teamState.payload();
    startTransition(async () => {
      const res = await postRsvp({
        orgSlug,
        ...(eventInstanceId ? { eventInstanceId } : { eventSlug: eventSlug! }),
        ...(isGuest ? { guestEmail } : {}),
        name,
        answers: questionsState.payload(),
        ...(teamIntent ? { team: teamIntent } : {}),
      });
      if (!res.ok) setError(res.error);
      else {
        setRegisteredAs(teamIntent?.mode ?? null);
        saveSuccessfulRsvp({ ticketToken: res.ticketToken, status: res.status }, teamIntent?.mode ?? null);
      }
    });
  }

  function saveSuccessfulRsvp(rsvp: { ticketToken: string; status: RsvpStatus | null }, teamMode: "create" | "join" | "solo" | null = null) {
    setTicketToken(rsvp.ticketToken);
    setRsvpStatus(rsvp.status);
    if (rsvp.ticketToken) {
      try {
        window.localStorage.setItem(
          lsKey,
          JSON.stringify({
            ticketToken: rsvp.ticketToken,
            status: rsvp.status,
            registeredAt: new Date().toISOString(),
          }),
        );
      } catch {
        // The confirmed server state remains usable in this open page even if
        // this browser has disabled local storage.
      }
    }
    onRsvpSaved?.({ ...rsvp, teamMode });
    setDone(true);
    if (refreshPageOnSave) router.refresh();
  }

  if (status === "loading") {
    return <p className="text-body-ui text-ink-muted">Loading…</p>;
  }

  if (done) {
    const href = ticketToken ? `/ticket/${ticketToken}` : null;
    const ticketDownloadUrl = ticketToken ? `/api/ticket/${ticketToken}/download` : null;
    const isConfirmed = rsvpStatus === "CONFIRMED";
    return (
      <div role="status" className="flex flex-col items-start gap-3 rounded-lg bg-success-bg p-5 text-success-fg">
        <CheckCircle2 aria-hidden className="yy-success-in size-8" />
        <p className="text-body font-semibold">
          {isConfirmed
            ? "Registration confirmed. Download and save your ticket now — you’ll need it for check-in."
            : "Registration received. We’ll let you know when its status changes."}
        </p>
        {registeredAs === "create" ? (
          <p className="text-body-ui">
            Your team is registered. Check your email for your team page link, where you manage the team, and the join link to share with your teammates.
          </p>
        ) : registeredAs === "join" && team?.joinTeam ? (
          <p className="text-body-ui">You’re on {team.joinTeam.name}. Your registration follows the team’s status.</p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {isConfirmed && ticketDownloadUrl ? (
            <Button asChild variant="primary" size="sm">
              <a href={ticketDownloadUrl} download>
                <Download aria-hidden className="size-4" />
                Download and save ticket
              </a>
            </Button>
          ) : null}
          {isConfirmed && href ? (
            <Button asChild variant="secondary" size="sm">
              <Link href={href}>View ticket</Link>
            </Button>
          ) : null}
        </div>
      </div>
    );
  }

  const questions = <RegistrationQuestions controller={questionsState} />;
  const teamFields = <TeamRegistrationFields controller={teamState} />;
  const problems = problemCount > 0 ? (
    <Callout tone="danger" role="alert">
      {problemCount === 1 ? "One answer needs a quick fix before you can register." : `${problemCount} answers need a quick fix before you can register.`}
    </Callout>
  ) : null;

  // "Join with a link" without a link: only the explanation, nothing to
  // submit. The team choice stays in the same element either way, so moving
  // between the options with the arrow keys never remounts the radio group
  // (which would drop keyboard focus out of it).
  const awaitingLink = teamState.awaitingLink;

  if (session?.user) {
    return (
      <div ref={formRef} className="flex flex-col gap-3.5">
        {error ? <Callout tone="danger" role="alert">{error}</Callout> : null}
        {problems}
        {teamFields}
        {awaitingLink ? null : (
          <>
            <div data-question-key="__name">
              <Field label="Name" optional={!requireName} required={requireName} error={identity.name} helperText={!requireName ? `Leave blank to use ${session.user.name}.` : undefined}>
                <Input
                  name="name"
                  autoComplete="name"
                  value={name}
                  placeholder={session.user.name ?? ""}
                  onChange={(event) => {
                    setName(event.target.value);
                    if (identity.name && event.target.value.trim()) setIdentity((current) => ({ ...current, name: undefined }));
                  }}
                  maxLength={200}
                />
              </Field>
            </div>
            {questions}
            <Button variant="accent" size="lg" fullWidth loading={pending} loadingLabel="Registering…" onClick={submit}>
              Register
            </Button>
          </>
        )}
      </div>
    );
  }

  return (
    <form
      ref={formRef}
      noValidate
      className="flex flex-col gap-3.5"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      {error ? <Callout tone="danger" role="alert">{error}</Callout> : null}
      {problems}
      {teamFields}
      {awaitingLink ? null : (
        <>
          <p className="text-body-ui text-ink-muted">Register with your email</p>
          <div data-question-key="__name">
            <Field label="Name" required error={identity.name}>
              <Input
                name="name"
                autoComplete="name"
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  if (identity.name && event.target.value.trim()) setIdentity((current) => ({ ...current, name: undefined }));
                }}
                maxLength={200}
              />
            </Field>
          </div>
          <div data-question-key="__email">
            <Field label="Email" required error={identity.email} helperText="We’ll send your ticket here.">
              <Input
                name="guestEmail"
                type="email"
                autoComplete="email"
                value={guestEmail}
                onChange={(event) => {
                  setGuestEmail(event.target.value);
                  if (identity.email) {
                    const recheck = identityErrors({ name, email: event.target.value, requireName: false, requireEmail: true }).email;
                    setIdentity((current) => ({ ...current, email: recheck }));
                  }
                }}
              />
            </Field>
          </div>
          {questions}
          <Button variant="accent" size="lg" fullWidth type="submit" loading={pending} loadingLabel="Registering…">
            Register
          </Button>
        </>
      )}
    </form>
  );
}
