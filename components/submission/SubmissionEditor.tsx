"use client";

import { useState, useTransition, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpRight, Check, Clock, Send, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Callout, Card, CardHeader, Chip, type ChipTone } from "@/components/ui/display";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/field";
import {
  saveSubmissionDraftAction,
  submitSubmissionAction,
  withdrawSubmissionAction,
  type SubmissionRef,
} from "@/app/actions/submissions";
import { windowText, type SubmissionWindowPhase } from "./submissionWindow";

export type { SubmissionWindowPhase };

// Mirrors SUBMISSION_*_MAX_LENGTH in lib/validators.ts (the server enforces them).
const TITLE_MAX = 120;
const SUMMARY_MAX = 4000;
const URL_MAX = 500;

type SubmissionStatus = "DRAFT" | "SUBMITTED" | "WITHDRAWN" | "DISQUALIFIED";

/** Serializable view built on the server: labels only, no ids, tokens, or reasons. */
export type SubmissionEditorView = {
  entrantName: string;
  isTeam: boolean;
  eventTitle: string;
  phase: SubmissionWindowPhase;
  opensLabel: string | null;
  closesLabel: string | null;
  confirmed: boolean;
  canEdit: boolean;
  submission: {
    title: string;
    summary: string;
    repoUrl: string | null;
    demoUrl: string | null;
    videoUrl: string | null;
    status: SubmissionStatus;
    submittedLabel: string | null;
  } | null;
};

type Feedback = { tone: "success" | "danger"; message: string } | null;
type Busy = "draft" | "submit" | "withdraw" | null;

function statusChip(status: SubmissionStatus): { label: string; tone: ChipTone } {
  switch (status) {
    case "DRAFT":
      return { label: "Draft", tone: "warning" };
    case "SUBMITTED":
      return { label: "Submitted", tone: "success" };
    case "WITHDRAWN":
      return { label: "Withdrawn", tone: "neutral" };
    case "DISQUALIFIED":
      // Shown neutrally; the organisers' reason is never sent to entrants.
      return { label: "Not in judging", tone: "neutral" };
  }
}

/**
 * The entrant's project: title, summary, and links, with save draft,
 * submit, and withdraw. Used on the leader's team page, the signed-in
 * submission page, and the solo `/submit/{token}` page. Every button calls a
 * Server Action that re-checks the entrant, their status, and the window on
 * the server; this component decides nothing.
 */
export function SubmissionEditor({ submissionRef, view, variant }: { submissionRef: SubmissionRef; view: SubmissionEditorView; variant: "card" | "page" }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<Busy>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);
  const [title, setTitle] = useState(view.submission?.title ?? "");
  const [summary, setSummary] = useState(view.submission?.summary ?? "");
  const [repoUrl, setRepoUrl] = useState(view.submission?.repoUrl ?? "");
  const [demoUrl, setDemoUrl] = useState(view.submission?.demoUrl ?? "");
  const [videoUrl, setVideoUrl] = useState(view.submission?.videoUrl ?? "");

  const status = view.submission?.status ?? null;
  const submitted = status === "SUBMITTED";
  const disqualified = status === "DISQUALIFIED";
  const chip = status ? statusChip(status) : null;
  const headingId = variant === "page" ? "submission-page-title" : "submission-section-title";

  function run(kind: Exclude<Busy, null>, task: () => Promise<void>) {
    setFeedback(null);
    setBusy(kind);
    startTransition(async () => {
      try {
        await task();
      } finally {
        setBusy(null);
      }
    });
  }

  function save(mode: "draft" | "submit") {
    setErrors({});
    const input = { title, summary, repoUrl, demoUrl, videoUrl };
    run(mode, async () => {
      const res = mode === "submit" ? await submitSubmissionAction(submissionRef, input) : await saveSubmissionDraftAction(submissionRef, input);
      if (!res.ok) {
        setErrors(res.fieldErrors ?? {});
        setFeedback({ tone: "danger", message: res.fieldErrors ? "Check the highlighted fields." : res.error });
        return;
      }
      setFeedback({
        tone: "success",
        message:
          mode === "submit" && !submitted
            ? "Project submitted. We've emailed a confirmation. You can keep editing until submissions close."
            : submitted
              ? "Changes saved. Your project is still submitted."
              : "Draft saved. Submit it before submissions close so it can be judged.",
      });
      router.refresh();
    });
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    save("submit");
  }

  function withdraw() {
    setWithdrawError(null);
    run("withdraw", async () => {
      const res = await withdrawSubmissionAction(submissionRef);
      if (!res.ok) {
        setWithdrawError(res.error);
        return;
      }
      setConfirmWithdraw(false);
      setFeedback({ tone: "success", message: "Project withdrawn. It won't be judged unless you submit it again before submissions close." });
      router.refresh();
    });
  }

  const header = (
    <div className="flex flex-col gap-2">
      {variant === "page" ? (
        <>
          <p className="text-overline text-ink-muted">{view.isTeam ? `Team project · ${view.entrantName}` : "Your project"}</p>
          <h1 id={headingId} className="break-words font-display text-[30px] font-extrabold leading-tight tracking-[-0.02em] text-ink sm:text-[38px]">
            {view.eventTitle}
          </h1>
        </>
      ) : null}
      <div className="flex flex-wrap items-center gap-1.5">
        {chip ? <Chip tone={chip.tone} icon={submitted ? <Check /> : undefined}>{chip.label}</Chip> : <Chip tone="outline">Not started</Chip>}
        <Chip tone={view.phase === "open" ? "accent" : "neutral"} icon={<Clock />}>{windowText(view)}</Chip>
      </div>
      {submitted && view.submission?.submittedLabel ? (
        <p className="text-caption text-ink-muted">Submitted {view.submission.submittedLabel}</p>
      ) : null}
    </div>
  );

  let notice: ReactNode = null;
  if (disqualified) {
    notice = <Callout tone="info">This project isn&apos;t part of judging. If you have questions, contact the organisers.</Callout>;
  } else if (!view.confirmed) {
    notice = <Callout tone="info">Only confirmed registrations can submit a project. This section opens once your place is confirmed.</Callout>;
  } else if (view.phase === "upcoming") {
    notice = <Callout tone="info">You can start your project here once submissions open.</Callout>;
  } else if (view.phase === "closed" && status !== "SUBMITTED") {
    notice = <Callout tone="info">Submissions have closed, so this project can no longer be submitted.</Callout>;
  }

  const body = view.canEdit ? (
    <form onSubmit={onSubmit} className="flex flex-col gap-3.5" noValidate>
      <Field label="Project title" error={errors.title?.[0]}>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={TITLE_MAX} autoComplete="off" required />
      </Field>
      <Field
        label="Summary"
        optional
        error={errors.summary?.[0]}
        helperText={`What you built and how it works. Plain text, up to ${SUMMARY_MAX.toLocaleString("en-GB")} characters (${summary.length.toLocaleString("en-GB")} used).`}
      >
        <Textarea value={summary} onChange={(e) => setSummary(e.target.value)} maxLength={SUMMARY_MAX} rows={8} />
      </Field>
      <Field label="Code repository" optional error={errors.repoUrl?.[0]} helperText="A full https:// link.">
        <Input type="url" inputMode="url" value={repoUrl} onChange={(e) => setRepoUrl(e.target.value)} maxLength={URL_MAX} placeholder="https://" autoComplete="off" />
      </Field>
      <Field label="Demo" optional error={errors.demoUrl?.[0]}>
        <Input type="url" inputMode="url" value={demoUrl} onChange={(e) => setDemoUrl(e.target.value)} maxLength={URL_MAX} placeholder="https://" autoComplete="off" />
      </Field>
      <Field label="Video" optional error={errors.videoUrl?.[0]}>
        <Input type="url" inputMode="url" value={videoUrl} onChange={(e) => setVideoUrl(e.target.value)} maxLength={URL_MAX} placeholder="https://" autoComplete="off" />
      </Field>
      <p className="text-caption text-ink-muted">
        Judges see the title, summary, links, and {view.isTeam ? "your team name" : "your first name and last initial"}. They never see your email address.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {submitted ? (
          <Button type="button" variant="primary" loading={busy === "draft"} loadingLabel="Saving…" disabled={pending} onClick={() => save("draft")}>
            Save changes
          </Button>
        ) : (
          <>
            <Button type="submit" variant="primary" loading={busy === "submit"} loadingLabel="Submitting…" disabled={pending} startIcon={<Send />}>
              {status === "WITHDRAWN" ? "Submit again" : "Submit project"}
            </Button>
            <Button type="button" variant="secondary" loading={busy === "draft"} loadingLabel="Saving…" disabled={pending} onClick={() => save("draft")}>
              Save draft
            </Button>
          </>
        )}
        {submitted ? (
          <Button type="button" variant="quiet" disabled={pending} startIcon={<Undo2 />} onClick={() => { setWithdrawError(null); setConfirmWithdraw(true); }}>
            Withdraw…
          </Button>
        ) : null}
      </div>
    </form>
  ) : view.submission ? (
    <ProjectReadOnly submission={view.submission} />
  ) : view.confirmed && view.phase === "closed" ? (
    <p className="text-body-ui text-ink-muted">No project was submitted.</p>
  ) : null;

  const content = (
    <div className="flex flex-col gap-4">
      {header}
      {notice}
      {feedback ? <Callout tone={feedback.tone} role={feedback.tone === "danger" ? "alert" : "status"}>{feedback.message}</Callout> : null}
      {body}
      <ConfirmDialog
        open={confirmWithdraw}
        title="Withdraw your project?"
        message="It won't be judged. You can submit it again while submissions are open."
        confirmLabel="Withdraw"
        destructive
        loading={busy === "withdraw"}
        onConfirm={withdraw}
        onCancel={() => !pending && setConfirmWithdraw(false)}
      >
        {withdrawError ? <Callout tone="danger" role="alert">{withdrawError}</Callout> : null}
      </ConfirmDialog>
    </div>
  );

  if (variant === "page") {
    return (
      <section aria-labelledby={headingId} className="flex flex-col gap-5">
        {content}
      </section>
    );
  }
  return (
    <Card as="section" aria-labelledby={headingId}>
      <CardHeader
        title={<span id={headingId}>{view.isTeam ? "Team project" : "Your project"}</span>}
        description={view.isTeam ? "Your team's hackathon submission. Any member signed in to their account can edit it too." : "Your hackathon submission."}
      />
      {content}
    </Card>
  );
}

function ProjectLink({ href, label }: { href: string; label: string }) {
  return (
    <li>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer nofollow"
        className="inline-flex items-center gap-1 text-[15px] font-semibold text-ink underline-offset-4 decoration-accent hover:underline focus-visible:underline"
      >
        {label}
        <ArrowUpRight aria-hidden className="size-4 text-ink-muted" />
        <span className="sr-only"> (opens in a new tab)</span>
      </a>
    </li>
  );
}

function ProjectReadOnly({ submission }: { submission: NonNullable<SubmissionEditorView["submission"]> }) {
  const links = [
    submission.repoUrl ? { href: submission.repoUrl, label: "Code" } : null,
    submission.demoUrl ? { href: submission.demoUrl, label: "Demo" } : null,
    submission.videoUrl ? { href: submission.videoUrl, label: "Video" } : null,
  ].filter((link): link is { href: string; label: string } => link !== null);
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-line bg-subtle p-4">
      <p className="break-words text-label text-ink">{submission.title}</p>
      {submission.summary ? <p className="whitespace-pre-wrap break-words text-body-ui text-ink-secondary">{submission.summary}</p> : null}
      {links.length ? (
        <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1" aria-label="Project links">
          {links.map((link) => <ProjectLink key={link.label} href={link.href} label={link.label} />)}
        </ul>
      ) : null}
    </div>
  );
}
