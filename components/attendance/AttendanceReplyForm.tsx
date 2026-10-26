"use client";

import { useEffect, useId, useRef, useState, useTransition, type FormEvent } from "react";
import { submitAttendanceReply } from "@/app/actions/attendance-check";
import {
  ATTENDANCE_NOTE_MAX,
  type AttendanceReplyClosed,
  type AttendanceResponseValue,
} from "@/lib/attendanceCheck";
import { formatDayTime } from "@/lib/format/datetime";
import { Button } from "@/components/ui/button";
import { RadioCard, RadioGroup } from "@/components/ui/choice";
import { Callout } from "@/components/ui/display";
import { Field, Textarea } from "@/components/ui/field";
import { DotFace } from "@/components/brand/DotFace";

type Saved = { response: AttendanceResponseValue; respondedAt: string | null; note: string };

type Phase = "answer" | "answered" | "released";

const ANSWER_LABELS: Record<AttendanceResponseValue, string> = {
  ATTENDING: "Yes, I'll be there",
  NOT_ATTENDING: "No, I can't make it",
};

const CLOSED_COPY: Record<AttendanceReplyClosed, { title: string; body: string }> = {
  cancelled: { title: "This event has been cancelled", body: "There is nothing to answer. The organisers will be in touch if anything changes." },
  started: { title: "Answers are closed", body: "The event has started, so you can no longer answer here." },
  notConfirmed: { title: "Your registration is no longer confirmed", body: "There is nothing to answer for this registration." },
};

export type AttendanceReplyFormProps = {
  token: string;
  attendeeName: string;
  attendeeEmail: string;
  teamName: string | null;
  initialResponse: AttendanceResponseValue | null;
  initialRespondedAt: string | null;
  initialNote: string;
  /** From the email's `?answer=` button; selects an answer but never submits it. */
  preselect: AttendanceResponseValue | null;
  releaseOnDecline: boolean;
  closed: AttendanceReplyClosed | null;
  /** The event's (already validated) timezone. */
  timeZone: string;
};

/**
 * The guest's side of attendance confirmation. The link token is the only
 * credential. A released place is shown from the action's result: the
 * registration (and with it this link) is gone, so a reload is a 404.
 */
export function AttendanceReplyForm(props: AttendanceReplyFormProps) {
  const { token, attendeeName, attendeeEmail, teamName, releaseOnDecline, closed, timeZone } = props;
  const initialSaved: Saved | null = props.initialResponse
    ? { response: props.initialResponse, respondedAt: props.initialRespondedAt, note: props.initialNote }
    : null;
  const [saved, setSaved] = useState<Saved | null>(initialSaved);
  // An email button that matches the saved answer just shows it; a different one opens the form.
  const [phase, setPhase] = useState<Phase>(initialSaved && (!props.preselect || props.preselect === initialSaved.response) ? "answered" : "answer");
  const [choice, setChoice] = useState<AttendanceResponseValue | null>(props.preselect ?? initialSaved?.response ?? null);
  const [note, setNote] = useState(props.initialNote);
  const [error, setError] = useState<string | null>(null);
  const [releaseFailed, setReleaseFailed] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const resultRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  // Where keyboard focus goes once the next phase has rendered.
  const focusNext = useRef<"result" | "form" | null>(null);
  const questionId = useId();

  useEffect(() => {
    const target = focusNext.current;
    focusNext.current = null;
    if (target === "result") resultRef.current?.focus();
    if (target === "form") formRef.current?.querySelector<HTMLElement>("[role=radio][data-state=checked], [role=radio]")?.focus();
  }, [phase]);

  const willRelease = releaseOnDecline && choice === "NOT_ATTENDING";

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!choice || pending) return;
    setError(null);
    const response = choice;
    const trimmedNote = note.trim();
    startTransition(async () => {
      let result: Awaited<ReturnType<typeof submitAttendanceReply>>;
      try {
        result = await submitAttendanceReply({ token, response, note: trimmedNote });
      } catch {
        setError("We couldn't send your answer. Check your connection and try again.");
        return;
      }
      if (!result.ok) {
        setError(result.error);
        return;
      }
      focusNext.current = "result";
      if (result.data?.released) {
        setPhase("released");
      } else {
        setSaved({ response: result.data?.response ?? response, respondedAt: new Date().toISOString(), note: trimmedNote });
        setReleaseFailed(result.data?.releaseFailed ?? null);
        setPhase("answered");
      }
    });
  }

  const details = (
    <section aria-label="Your registration" className="rounded-xl border border-line bg-canvas p-5">
      <dl className="grid gap-3">
        <div>
          <dt className="text-overline text-ink-muted">Name</dt>
          <dd className="break-words text-[15px] font-bold text-ink">{attendeeName}</dd>
        </div>
        {attendeeEmail ? (
          <div>
            <dt className="text-overline text-ink-muted">Email</dt>
            <dd className="break-all text-[15px] font-bold text-ink">{attendeeEmail}</dd>
          </div>
        ) : null}
        {teamName ? (
          <div>
            <dt className="text-overline text-ink-muted">Team</dt>
            <dd className="break-words text-[15px] font-bold text-ink">{teamName}</dd>
          </div>
        ) : null}
      </dl>
    </section>
  );

  const savedSummary = saved ? (
    <div className="flex flex-col gap-1">
      <p className="text-overline text-ink-muted">Your answer</p>
      <p className="text-[17px] font-bold text-ink">{ANSWER_LABELS[saved.response]}</p>
      {saved.respondedAt ? <p className="text-caption text-ink-muted">Answered {formatDayTime(saved.respondedAt, timeZone)}</p> : null}
      {saved.note ? (
        <p className="mt-1 whitespace-pre-line break-words text-body-ui text-ink-secondary">
          <span className="sr-only">Your note: </span>
          {saved.note}
        </p>
      ) : null}
    </div>
  ) : null;

  if (phase === "released") {
    return (
      <>
        <div ref={resultRef} tabIndex={-1} role="status" className="flex flex-col gap-4 rounded-xl border border-line bg-canvas p-5 focus:outline-none">
          <DotFace mood="happy" size={48} />
          <div className="flex flex-col gap-1.5">
            <h2 className="text-h4 text-ink">Your place has been released</h2>
            <p className="text-body-ui text-ink-secondary">
              Thanks for letting the organisers know. Your registration is cancelled and your place can go to someone else. This can&apos;t be undone here; if your plans change, register again from the event page while places are left.
            </p>
          </div>
        </div>
        {details}
      </>
    );
  }

  if (closed) {
    const copy = CLOSED_COPY[closed];
    return (
      <>
        <Callout tone="info" title={copy.title}>{copy.body}</Callout>
        {savedSummary ? <div className="rounded-xl border border-line bg-canvas p-5">{savedSummary}</div> : null}
        {details}
      </>
    );
  }

  if (phase === "answered" && saved) {
    return (
      <>
        <div ref={resultRef} tabIndex={-1} className="flex flex-col gap-4 rounded-xl border border-line bg-canvas p-5 focus:outline-none">
          <div role="status" className="flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <DotFace mood={saved.response === "ATTENDING" ? "cheering" : "happy"} size={48} />
              <h2 className="text-h4 text-ink">{saved.response === "ATTENDING" ? "Thanks, see you there!" : "Thanks for letting us know"}</h2>
            </div>
            {savedSummary}
            {releaseFailed ? (
              <Callout tone="warning" title="Your place is kept">
                {releaseFailed} Your answer has been sent to the organisers.
              </Callout>
            ) : null}
          </div>
          <div>
            <Button
              variant="secondary"
              onClick={() => {
                setChoice(saved.response);
                setNote(saved.note);
                setError(null);
                focusNext.current = "form";
                setPhase("answer");
              }}
            >
              Change my answer
            </Button>
          </div>
          <p className="text-caption text-ink-muted">You can change your answer until the event starts.</p>
        </div>
        {details}
      </>
    );
  }

  const noteCount = note.length;

  return (
    <>
      {details}
      <form ref={formRef} onSubmit={handleSubmit} noValidate className="flex flex-col gap-5 rounded-xl border border-line bg-canvas p-5">
        <div className="flex flex-col gap-2.5">
          <p id={questionId} className="text-label text-ink">Will you be there?</p>
          <RadioGroup
            aria-labelledby={questionId}
            aria-required
            value={choice ?? ""}
            onValueChange={(value) => {
              setChoice(value === "ATTENDING" || value === "NOT_ATTENDING" ? value : null);
              setError(null);
            }}
            className="grid grid-cols-1 gap-2.5 sm:grid-cols-2"
          >
            <RadioCard value="ATTENDING" label={ANSWER_LABELS.ATTENDING} />
            <RadioCard value="NOT_ATTENDING" label={ANSWER_LABELS.NOT_ATTENDING} />
          </RadioGroup>
        </div>

        {willRelease ? (
          <Callout tone="warning" title="Answering No releases your place">
            Your registration will be cancelled and your place can go to someone else. You can&apos;t take it back from this page.
          </Callout>
        ) : null}

        <Field label="Note for the organisers" optional helperText={`${noteCount}/${ATTENDANCE_NOTE_MAX} characters`}>
          <Textarea
            name="note"
            rows={3}
            maxLength={ATTENDANCE_NOTE_MAX}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder={choice === "NOT_ATTENDING" ? "Anything the organisers should know?" : "Arriving late, or anything else the organisers should know"}
          />
        </Field>

        {error ? (
          <Callout tone="danger" role="alert">{error}</Callout>
        ) : null}

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-end">
          {saved ? (
            <Button
              variant="quiet"
              onClick={() => {
                setChoice(saved.response);
                setNote(saved.note);
                setError(null);
                focusNext.current = "result";
                setPhase("answered");
              }}
            >
              Keep my answer
            </Button>
          ) : null}
          <Button
            type="submit"
            variant={willRelease ? "danger" : "primary"}
            size="lg"
            disabled={!choice}
            loading={pending}
            loadingLabel="Sending…"
          >
            {willRelease ? "Release my place" : "Send my answer"}
          </Button>
        </div>
        {!choice ? <p className="text-caption text-ink-muted sm:text-right">Choose Yes or No to send your answer.</p> : null}
      </form>
    </>
  );
}
