"use client";

import { DotLoader } from "@/components/brand/DotLoader";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { BroadcastAttendanceFilter, RsvpStatus } from "@prisma/client";
import { ChevronDown, FlaskConical, Monitor, Save, Send, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/choice";
import { Callout } from "@/components/ui/display";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/field";
import { Tooltip } from "@/components/ui/menu";
import { cn } from "@/lib/cn";
import {
  countBroadcastRecipients,
  discardEventBroadcastDraft,
  previewEventBroadcast,
  saveEventBroadcastDraft,
  sendEventBroadcast,
  sendEventBroadcastTest,
} from "@/app/actions/broadcasts";
import { DraftAutosave, draftStatusText, type BroadcastDraftContent, type DraftAutosaveState, type EventBroadcastDraftDto } from "@/lib/broadcastDraftAutosave";
import {
  BROADCAST_PLACEHOLDERS,
  BROADCAST_STARTER_TEMPLATES,
  BROADCAST_STATUS_OPTIONS,
  BROADCAST_SUBJECT_MAX,
  broadcastHtmlToText,
  defaultBroadcastTemplate,
  describeBroadcastAudience,
} from "@/lib/broadcastTemplate";
import { useToast } from "@/components/feedback/ToastProvider";
import { SendConfirmDialog } from "./SendConfirmDialog";
import { recipientDots, recipientSummary, sendBarLabel } from "@/components/event-dashboard/emails/recipients";
import { BroadcastEmailEditor } from "./BroadcastEmailEditor";
import { BroadcastPreviewFrame } from "./BroadcastPreviewFrame";
import { DesignPicker } from "./DesignPicker";
import { DEFAULT_BROADCAST_DESIGN, type BroadcastDesignId } from "@/lib/email/broadcastDesigns";

export type BroadcastHistoryRow = {
  id: string;
  subject: string;
  body: string;
  statuses: RsvpStatus[];
  attendance: BroadcastAttendanceFilter;
  design: BroadcastDesignId;
  recipientCount: number;
  createdAt: string;
  /** Pre-formatted on the server in the event timezone ("3 days ago", "13 Oct 2026"). */
  sentLabel: string;
  createdByName: string | null;
};

const SUBJECT_PLACEHOLDERS = BROADCAST_PLACEHOLDERS.filter((placeholder) => ["{{name}}", "{{event}}", "{{eventDate}}", "{{organisation}}"].includes(placeholder.token));

/** The first cards shown; the rest sit behind "More templates". */
const FEATURED_TEMPLATE_IDS = ["update", "reminder", "know-before-you-go", "agenda", "thank-you"];
const FEATURED_TEMPLATES = FEATURED_TEMPLATE_IDS.map((id) => BROADCAST_STARTER_TEMPLATES.find((template) => template.id === id)).filter((template) => template !== undefined);
const MORE_TEMPLATES = BROADCAST_STARTER_TEMPLATES.filter((template) => !FEATURED_TEMPLATE_IDS.includes(template.id));

/** The design's short names for each registration status (the values and server filter are unchanged). */
const STATUS_PILL_LABEL: Record<RsvpStatus, string> = {
  CONFIRMED: "Going",
  WAITLISTED: "Waitlist",
  PENDING_APPROVAL: "To approve",
  REJECTED: "Declined",
};

const ATTENDANCE_OPTIONS: ReadonlyArray<{ value: BroadcastAttendanceFilter; label: string; ariaLabel: string }> = [
  { value: "ANY", label: "Everyone", ariaLabel: "Everyone in the selected statuses" },
  { value: "CHECKED_IN", label: "Checked in", ariaLabel: "Only people who checked in" },
  { value: "NOT_CHECKED_IN", label: "Didn't check in", ariaLabel: "Only people who did not check in" },
];

function StepHeading({ step, id, title, aside }: { step: number; id: string; title: string; aside?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
      <span aria-hidden className="inline-flex size-[26px] shrink-0 items-center justify-center rounded-full bg-primary text-[13px] font-bold text-on-primary">{step}</span>
      <h2 id={id} className="text-h4 text-ink">
        <span className="sr-only">Step {step}: </span>
        {title}
      </h2>
      {aside ? <span className="text-sm text-ink-muted">{aside}</span> : null}
    </div>
  );
}

const cardClass = "flex min-w-0 flex-col gap-4 rounded-xl border border-line bg-canvas p-4 sm:p-5";

const UNDO_SECONDS = 5;
type SendPayload = { statuses: RsvpStatus[]; attendance: BroadcastAttendanceFilter; subject: string; body: string; design: BroadcastDesignId; count: number; templateId: string | null };

/** The composer as it opens without a saved draft: the first starter template. */
function startingContent(): BroadcastDraftContent & { design: BroadcastDesignId } {
  const template = BROADCAST_STARTER_TEMPLATES[0]!;
  const initial = defaultBroadcastTemplate();
  return {
    subject: initial.subject,
    body: initial.body,
    design: DEFAULT_BROADCAST_DESIGN,
    statuses: [...template.audience.statuses],
    attendance: template.audience.attendance,
    templateId: template.id,
  };
}

const noopSubscribe = () => () => {};
const timeFormatter = () => new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });

/** What replacing the composer would overwrite, asked before a template, a reused email, or a discard. */
type PendingReplace =
  | { kind: "template"; id: string; name: string }
  | { kind: "history"; row: BroadcastHistoryRow }
  | { kind: "discard" };

export function EventBroadcastPanel(props: {
  organisationSlug: string;
  eventId: string;
  statusCounts: Record<RsvpStatus, number>;
  history: BroadcastHistoryRow[];
  /** Event branding for the design thumbnails; the server renders the real thing. */
  brand: { accentColor: string | null; coverImageUrl: string | null };
  /** The signed-in organiser's own saved draft for this event, restored into the composer. */
  draft: EventBroadcastDraftDto | null;
}) {
  const { organisationSlug, eventId, statusCounts, history, brand, draft } = props;
  const router = useRouter();
  const { showToast } = useToast();
  // Only the first render's draft matters: later server renders (after a send)
  // must not overwrite what the organiser is editing.
  const [initial] = useState<BroadcastDraftContent & { design: BroadcastDesignId }>(() =>
    draft
      ? { subject: draft.subject, body: draft.body, design: draft.design, statuses: [...draft.statuses], attendance: draft.attendance, templateId: draft.templateId }
      : startingContent(),
  );

  const [templateId, setTemplateId] = useState<string>(initial.templateId ?? "");
  const [showAllTemplates, setShowAllTemplates] = useState(false);
  const [statuses, setStatuses] = useState<RsvpStatus[]>([...initial.statuses]);
  const [attendance, setAttendance] = useState<BroadcastAttendanceFilter>(initial.attendance);
  const [subject, setSubject] = useState(initial.subject);
  const [body, setBody] = useState(initial.body);
  const [countState, setCountState] = useState<{ key: string; count: number; error: string | null }>({ key: "", count: 0, error: null });
  const [preview, setPreview] = useState<{ key: string; subject: string; html: string; error: string | null }>({ key: "", subject: "", html: "", error: null });
  const [previewWidth, setPreviewWidth] = useState<"desktop" | "mobile">("desktop");
  const [design, setDesign] = useState<BroadcastDesignId>(initial.design);
  const [confirmOpen, setConfirmOpen] = useState(false);
  // After confirming, sending waits UNDO_SECONDS so a mistake can still be undone.
  const [countdown, setCountdown] = useState<{ left: number; count: number } | null>(null);
  const sendTimer = useRef<{ interval: ReturnType<typeof setInterval>; payload: SendPayload } | null>(null);
  const [pending, startTransition] = useTransition();
  const subjectRef = useRef<HTMLInputElement | null>(null);

  // Draft autosave: the controller owns the timing; React only mirrors its state.
  const content = useMemo<BroadcastDraftContent>(
    () => ({ subject, body, design, statuses, attendance, templateId: templateId || null }),
    [subject, body, design, statuses, attendance, templateId],
  );
  const contentRef = useRef(content);
  const [draftState, setDraftState] = useState<DraftAutosaveState>(() => ({
    dirty: false, saving: false, hasDraft: draft !== null, savedAt: draft?.updatedAt ?? null, error: null,
  }));
  const [autosave] = useState(() => new DraftAutosave({
    initial,
    savedAt: draft?.updatedAt ?? null,
    onChange: setDraftState,
    save: async (next) => {
      const result = await saveEventBroadcastDraft({ organisationSlug, eventId, ...next, statuses: [...next.statuses] });
      return result.ok ? { ok: true, updatedAt: result.data?.updatedAt ?? new Date().toISOString() } : { ok: false, error: result.error };
    },
  }));
  const [pendingReplace, setPendingReplace] = useState<PendingReplace | null>(null);
  const [replacing, setReplacing] = useState(false);
  const hydrated = useSyncExternalStore(noopSubscribe, () => true, () => false);
  const formatSavedTime = useMemo(() => {
    const formatter = timeFormatter();
    return (iso: string) => formatter.format(new Date(iso));
  }, []);

  useEffect(() => {
    contentRef.current = content;
    autosave.edit(content);
  }, [autosave, content]);

  // Switching dashboard tabs unmounts the composer: save what is left once.
  useEffect(() => () => autosave.leave(), [autosave]);

  // Closing or reloading the tab with unsaved work asks first. Client-side
  // navigation is covered by the save on unmount above.
  const unsaved = draftState.dirty || draftState.saving;
  useEffect(() => {
    if (!unsaved) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [unsaved]);

  const audienceText = describeBroadcastAudience(statuses, attendance);
  const audienceKey = `${[...statuses].sort().join(",")}|${attendance}`;
  const countReady = statuses.length === 0 || countState.key === audienceKey;
  const recipientCount: number | null = statuses.length === 0 ? 0 : countReady ? countState.count : null;
  const countError = countReady ? countState.error : null;

  const previewKey = `${design}\u0000${subject}\u0000${body}`;
  const previewReady = preview.key === previewKey;
  const hasContent = subject.trim().length > 0 && broadcastHtmlToText(body).trim().length > 0;

  const totalRegistrations = Object.values(statusCounts).reduce((sum, value) => sum + value, 0);
  const reach = recipientDots(recipientCount ?? 0, totalRegistrations);
  const summary = recipientSummary(recipientCount);
  const moreOpen = showAllTemplates || MORE_TEMPLATES.some((template) => template.id === templateId);

  // Recount on the server whenever the audience changes. The count is also
  // recomputed inside the send transaction, so this is guidance, not the truth.
  useEffect(() => {
    if (statuses.length === 0) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const result = await countBroadcastRecipients({ organisationSlug, eventId, statuses, attendance });
      if (cancelled) return;
      setCountState(result.ok
        ? { key: audienceKey, count: result.data?.count ?? 0, error: null }
        : { key: audienceKey, count: 0, error: result.error });
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [organisationSlug, eventId, statuses, attendance, audienceKey]);

  // The preview is rendered by the server with the real email template, so
  // what the organiser sees is exactly what a recipient receives.
  useEffect(() => {
    if (!hasContent) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const result = await previewEventBroadcast({ organisationSlug, eventId, subject, body, design });
      if (cancelled) return;
      setPreview(result.ok
        ? { key: previewKey, subject: result.data?.subject ?? "", html: result.data?.html ?? "", error: null }
        : { key: previewKey, subject: "", html: "", error: result.error });
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [organisationSlug, eventId, subject, body, design, hasContent, previewKey]);

  function toggleStatus(value: RsvpStatus) {
    setStatuses((current) => (current.includes(value) ? current.filter((status) => status !== value) : [...current, value]));
  }

  /** Puts new content in the composer as a fresh starting point, removing the saved draft if there is one. */
  async function replaceComposer(next: BroadcastDraftContent & { design: BroadcastDesignId }): Promise<boolean> {
    const hadDraft = autosave.state.hasDraft;
    setTemplateId(next.templateId ?? "");
    setSubject(next.subject);
    setBody(next.body);
    setStatuses([...next.statuses]);
    setAttendance(next.attendance);
    setDesign(next.design);
    contentRef.current = next;
    autosave.reset(next, { hasDraft: hadDraft, savedAt: autosave.state.savedAt });
    if (!hadDraft) return true;
    const result = await discardEventBroadcastDraft({ organisationSlug, eventId });
    if (!result.ok) {
      // The old draft is still on the server; saving the new content replaces it.
      autosave.markUnsaved();
      showToast(result.error, "error");
      return false;
    }
    autosave.reset(next, { hasDraft: false, savedAt: null });
    autosave.edit(contentRef.current);
    return true;
  }

  /** Templates, reuse, and discard overwrite the composer, so they ask first when there is work to lose. */
  function requestReplace(request: PendingReplace) {
    if (autosave.state.dirty || autosave.state.hasDraft) return setPendingReplace(request);
    void performReplace(request);
  }

  async function performReplace(request: PendingReplace) {
    if (request.kind === "template") {
      const template = BROADCAST_STARTER_TEMPLATES.find((candidate) => candidate.id === request.id);
      if (!template) return;
      await replaceComposer({
        subject: template.subject,
        body: template.bodyHtml,
        design,
        statuses: [...template.audience.statuses],
        attendance: template.audience.attendance,
        templateId: template.id,
      });
      showToast(`Loaded the “${template.name}” template. Edit anything before sending.`, "success");
    } else if (request.kind === "history") {
      const { row } = request;
      await replaceComposer({ subject: row.subject, body: row.body, design: row.design, statuses: [...row.statuses], attendance: row.attendance, templateId: null });
      showToast("Loaded the previous email into the editor", "success");
    } else {
      if (await replaceComposer(startingContent())) showToast("Draft discarded", "success");
    }
  }

  function applyTemplate(id: string) {
    const template = BROADCAST_STARTER_TEMPLATES.find((candidate) => candidate.id === id);
    if (!template) return;
    requestReplace({ kind: "template", id, name: template.name });
  }

  function insertSubjectPlaceholder(token: string) {
    const input = subjectRef.current;
    const start = input?.selectionStart ?? subject.length;
    const end = input?.selectionEnd ?? subject.length;
    const next = `${subject.slice(0, start)}${token}${subject.slice(end)}`;
    if (next.length > BROADCAST_SUBJECT_MAX) return;
    setSubject(next);
    requestAnimationFrame(() => {
      input?.focus();
      input?.setSelectionRange(start + token.length, start + token.length);
    });
  }

  function loadFromHistory(row: BroadcastHistoryRow) {
    requestReplace({ kind: "history", row });
  }

  // Sending waits for the preview of the current edit, so the review step
  // always shows the subject and design that will actually go out.
  const canSend = !pending && statuses.length > 0 && hasContent && (recipientCount ?? 0) > 0 && previewReady && !preview.error;
  function startCountdown(payload: SendPayload) {
    // No autosave while the email is about to go: the send clears the draft.
    autosave.suspend();
    let left = UNDO_SECONDS;
    setCountdown({ left, count: payload.count });
    const interval = setInterval(() => {
      left -= 1;
      if (left > 0) return setCountdown({ left, count: payload.count });
      clearInterval(interval);
      sendTimer.current = null;
      setCountdown(null);
      startTransition(async () => {
        const result = await sendEventBroadcast({ organisationSlug, eventId, statuses: payload.statuses, attendance: payload.attendance, subject: payload.subject, body: payload.body, design: payload.design });
        if (!result.ok) {
          autosave.resume();
          return showToast(result.error, "error");
        }
        // The server removed the draft with the send. What was sent is the new
        // starting point; edits made during the countdown stay unsaved and autosave.
        autosave.reset({ ...payload }, { hasDraft: false, savedAt: null });
        autosave.resume();
        autosave.edit(contentRef.current);
        showToast(`Queued for ${result.data?.recipientCount ?? 0} recipients`, "success");
        router.refresh();
      });
    }, 1000);
    sendTimer.current = { interval, payload };
  }

  function undoSend() {
    if (sendTimer.current) clearInterval(sendTimer.current.interval);
    sendTimer.current = null;
    setCountdown(null);
    autosave.resume();
    showToast("Sending cancelled. Nothing was sent.", "success");
  }

  // Leaving the page during the countdown cancels the send rather than firing it unseen.
  useEffect(() => () => {
    if (sendTimer.current) clearInterval(sendTimer.current.interval);
  }, []);

  const sendLabel = recipientCount && recipientCount > 0 ? `Send to ${recipientCount} ${recipientCount === 1 ? "person" : "people"}` : "Send";

  const templateCard = (template: (typeof BROADCAST_STARTER_TEMPLATES)[number]) => {
    const selected = templateId === template.id;
    return (
      <li key={template.id} className="flex">
        <button
          type="button"
          aria-pressed={selected}
          onClick={() => applyTemplate(template.id)}
          disabled={pending}
          className={cn(
            "flex w-full flex-col items-start gap-1 rounded-xl p-3.5 text-left transition-colors duration-[180ms] ease-yy disabled:pointer-events-none disabled:opacity-60",
            selected ? "border-2 border-primary bg-tint-peach" : "border border-line bg-canvas hover:bg-subtle",
          )}
        >
          <span className="font-bold text-ink">{template.name}</span>
          <span className="line-clamp-2 text-[13px] text-ink-muted">{template.description}</span>
        </button>
      </li>
    );
  };

  return (
    <div className="flex flex-col gap-6">
      <Callout tone="info">
        Emails go only to people who already registered for this event. Messages are queued and delivered in the background, a few at a time, so large audiences take a few minutes. Send yourself a test first.
      </Callout>

      <section aria-labelledby="broadcast-step-template" className="flex flex-col gap-3">
        <StepHeading step={1} id="broadcast-step-template" title="Pick a starting point" aside="Everything stays editable." />
        <ul className="grid grid-cols-1 gap-2.5 min-[420px]:grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
          {FEATURED_TEMPLATES.map(templateCard)}
          {moreOpen ? MORE_TEMPLATES.map(templateCard) : null}
          {MORE_TEMPLATES.length > 0 && !moreOpen ? (
            <li className="flex">
              <button
                type="button"
                aria-expanded={false}
                onClick={() => setShowAllTemplates(true)}
                className="flex w-full flex-col items-start gap-1 rounded-xl border border-dashed border-line-strong bg-canvas p-3.5 text-left transition-colors duration-[180ms] ease-yy hover:bg-subtle"
              >
                <span className="inline-flex items-center gap-1 font-bold text-ink">
                  More templates <ChevronDown aria-hidden className="size-4" />
                </span>
                <span className="line-clamp-2 text-[13px] text-ink-muted">
                  {MORE_TEMPLATES.length} more · {MORE_TEMPLATES.slice(0, 2).map((template) => template.name.toLowerCase()).join(", ")}…
                </span>
              </button>
            </li>
          ) : null}
        </ul>
      </section>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-5">
          <section aria-labelledby="broadcast-step-audience" className={cardClass}>
            <StepHeading step={2} id="broadcast-step-audience" title="Who gets it" />
            <div role="group" aria-label="Registration status" className="flex flex-wrap gap-1.5">
              {BROADCAST_STATUS_OPTIONS.map((option) => {
                const selected = statuses.includes(option.value);
                return (
                  <Tooltip key={option.value} content={`${option.label}: ${option.hint}`}>
                    <button
                      type="button"
                      aria-pressed={selected}
                      onClick={() => toggleStatus(option.value)}
                      disabled={pending}
                      className={cn(
                        "inline-flex min-h-[38px] items-center gap-1.5 rounded-full border px-3.5 text-sm font-semibold transition-colors duration-[180ms] ease-yy disabled:pointer-events-none disabled:opacity-50",
                        selected ? "border-primary bg-primary text-on-primary" : "border-line-strong bg-canvas text-ink hover:bg-subtle",
                      )}
                    >
                      {STATUS_PILL_LABEL[option.value]}
                      <span className="tabular-nums opacity-75">{statusCounts[option.value] ?? 0}</span>
                    </button>
                  </Tooltip>
                );
              })}
            </div>
            <SegmentedControl
              ariaLabel="Attendance"
              size="sm"
              value={attendance}
              onValueChange={(value) => setAttendance(value)}
              options={ATTENDANCE_OPTIONS}
              className="max-w-full self-start"
            />
            <div aria-live="polite" className="flex flex-col gap-2 rounded-lg bg-subtle px-3.5 py-3 sm:flex-row sm:items-center sm:gap-3">
              <span aria-hidden className="flex w-full max-w-[160px] shrink-0 flex-wrap gap-[3px]">
                {Array.from({ length: reach.dots }, (_, index) => (
                  <span key={index} className={cn("size-[7px] rounded-full", index < reach.lit ? "bg-accent" : "bg-track")} />
                ))}
              </span>
              {countError ? (
                <Callout tone="danger" className="flex-1">{countError}</Callout>
              ) : (
                <p className="text-sm text-ink">
                  {summary.count ? <strong className="font-bold">{summary.count}</strong> : null} {summary.rest}
                  {recipientCount !== null && recipientCount > 0 ? <span className="block text-caption text-ink-muted">Matches {audienceText}. Someone who registered twice still gets one email.</span> : null}
                </p>
              )}
            </div>
          </section>

          <section aria-labelledby="broadcast-step-message" className={cardClass}>
            <StepHeading step={3} id="broadcast-step-message" title="Write it" />
            <Field label="Subject" required helperText={`${subject.length}/${BROADCAST_SUBJECT_MAX}`}>
              <Input ref={subjectRef} value={subject} onChange={(e) => setSubject(e.target.value)} disabled={pending} maxLength={BROADCAST_SUBJECT_MAX} />
            </Field>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-caption text-ink-muted">Subject placeholders:</span>
              {SUBJECT_PLACEHOLDERS.map((placeholder) => (
                <Tooltip key={placeholder.token} content={placeholder.description}>
                  <button
                    type="button"
                    onClick={() => insertSubjectPlaceholder(placeholder.token)}
                    disabled={pending}
                    className="inline-flex min-h-8 items-center rounded-full border border-line-strong bg-canvas px-3 text-[13px] font-semibold text-ink transition-colors hover:bg-subtle disabled:pointer-events-none disabled:opacity-50"
                  >
                    {placeholder.label}
                  </button>
                </Tooltip>
              ))}
            </div>
            <BroadcastEmailEditor value={body} onChange={setBody} disabled={pending} />
            <div className="flex flex-col gap-2 border-t border-line pt-3 min-[420px]:flex-row min-[420px]:items-center">
              <p role="status" aria-live="polite" aria-atomic="true" className="flex flex-1 flex-wrap items-center gap-x-1.5 text-caption text-ink-muted">
                <span>{draftStatusText(draftState, hydrated ? formatSavedTime : null)}</span>
                {draftState.error && draftState.dirty && !draftState.saving ? (
                  <>
                    <span aria-hidden>·</span>
                    <Button variant="quiet" size="sm" className="min-h-0 px-0 font-semibold text-ink" onClick={() => void autosave.saveNow()}>
                      Retry
                    </Button>
                  </>
                ) : null}
              </p>
              <div className="flex items-center gap-2">
                {draftState.hasDraft || draftState.dirty ? (
                  <Button variant="dangerQuiet" size="sm" disabled={pending || countdown !== null || replacing} onClick={() => requestReplace({ kind: "discard" })}>
                    Discard draft…
                  </Button>
                ) : null}
                <Button
                  variant="secondary"
                  size="sm"
                  startIcon={<Save />}
                  disabled={!draftState.dirty || draftState.saving || pending || countdown !== null}
                  onClick={() => void autosave.saveNow()}
                >
                  Save draft
                </Button>
              </div>
            </div>
          </section>
        </div>

        <div className="flex min-w-0 flex-col gap-5">
          <section aria-labelledby="broadcast-preview" className="flex flex-col gap-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="broadcast-preview" className="text-overline text-ink-muted">Preview · as sent</h2>
              <SegmentedControl
                ariaLabel="Preview width"
                size="sm"
                value={previewWidth}
                onValueChange={setPreviewWidth}
                options={[
                  { value: "mobile", label: "Phone", icon: <Smartphone aria-hidden />, ariaLabel: "Mobile width" },
                  { value: "desktop", label: "Desktop", icon: <Monitor aria-hidden />, ariaLabel: "Desktop width" },
                ]}
              />
            </div>
            <div className="flex flex-col gap-2 rounded-xl border border-line bg-canvas p-3">
              <p className="text-label text-ink">Design</p>
              <DesignPicker value={design} onChange={setDesign} accentColor={brand.accentColor} coverImageUrl={brand.coverImageUrl} />
            </div>
            <p className="text-caption text-ink-muted">
              Rendered by the server with example values, exactly as it will arrive. Each attendee sees their own name and, when confirmed, their own ticket link.
            </p>
            {!hasContent ? (
              <Callout tone="info">Add a subject and a message to see the preview.</Callout>
            ) : preview.error && previewReady ? (
              <Callout tone="danger">{preview.error}</Callout>
            ) : (
              <div className="relative flex flex-col gap-2 rounded-xl border border-line bg-muted p-2.5 sm:p-3.5">
                {!previewReady ? (
                  <div aria-live="polite" className="absolute right-3 top-3 z-[1] flex items-center gap-2 rounded-full bg-canvas px-2.5 py-1 text-caption text-ink-secondary">
                    <DotLoader size={16} label="Updating preview" /> Updating…
                  </div>
                ) : null}
                <p className="px-1 text-label text-ink-muted [overflow-wrap:anywhere]">
                  Subject: <span className="font-bold text-ink">{preview.subject || "…"}</span>
                </p>
                <BroadcastPreviewFrame html={preview.html} width={previewWidth} dimmed={!previewReady} />
              </div>
            )}
          </section>

          <section aria-labelledby="broadcast-history" className={cn(cardClass, "gap-3")}>
            <h2 id="broadcast-history" className="text-h4 text-ink">Sent before</h2>
            {history.length === 0 ? (
              <p className="text-sm text-ink-muted">No emails have been sent for this event yet.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-line">
                {history.map((row) => (
                  <li key={row.id} className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-ink [overflow-wrap:anywhere]">{row.subject}</p>
                      <p className="text-[13px] text-ink-muted">
                        Sent to {row.recipientCount} {row.recipientCount === 1 ? "person" : "people"} · <time dateTime={row.createdAt}>{row.sentLabel}</time>
                        {row.createdByName ? ` · by ${row.createdByName}` : ""}
                      </p>
                      <p className="text-[13px] text-ink-muted">{describeBroadcastAudience(row.statuses, row.attendance)}</p>
                      <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-[13px] text-ink-secondary">{broadcastHtmlToText(row.body)}</p>
                    </div>
                    <Button size="sm" variant="quiet" className="shrink-0 font-semibold text-ink" onClick={() => loadFromHistory(row)} disabled={pending} aria-label={`Reuse “${row.subject}”`}>
                      Reuse
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>

      {countdown !== null ? (
        <div role="status" className="yy-dark-band sticky bottom-4 z-10 flex items-center gap-3 rounded-full bg-[var(--yy-inverse-surface)] py-2.5 pl-6 pr-3 text-ink shadow-float">
          <p className="flex-1 text-sm text-ink">
            Sending to {countdown.count} {countdown.count === 1 ? "person" : "people"} in <span className="font-bold tabular-nums">{countdown.left}</span>…
          </p>
          <Button variant="primary" onClick={undoSend}>
            Undo
          </Button>
        </div>
      ) : (
      <div className="yy-dark-band sticky bottom-4 z-10 flex flex-col gap-2 rounded-2xl bg-[var(--yy-inverse-surface)] p-3 text-ink shadow-float sm:flex-row sm:items-center sm:rounded-full sm:py-2.5 sm:pl-6 sm:pr-3">
        <p aria-live="polite" className="flex-1 px-1 text-sm text-ink-secondary sm:px-0">
          {sendBarLabel({ count: recipientCount, hasStatuses: statuses.length > 0, hasContent })}
        </p>
        <div className="flex flex-col-reverse gap-2 min-[420px]:flex-row min-[420px]:items-center">
          <Button
            variant="quiet"
            className="justify-center px-3 text-ink"
            startIcon={<FlaskConical />}
            disabled={pending || !hasContent}
            onClick={() => {
              startTransition(async () => {
                const result = await sendEventBroadcastTest({ organisationSlug, eventId, subject, body, design });
                if (!result.ok) return showToast(result.error, "error");
                showToast(`Test email queued to ${result.data?.to ?? "your address"}`, "success");
              });
            }}
          >
            Send a test to me
          </Button>
          <Button variant="primary" startIcon={<Send />} disabled={!canSend} onClick={() => setConfirmOpen(true)}>
            {sendLabel}
          </Button>
        </div>
      </div>
      )}

      <ConfirmDialog
        open={pendingReplace !== null}
        title={pendingReplace?.kind === "discard" ? "Discard this draft?" : "Replace your draft?"}
        message={
          pendingReplace?.kind === "discard"
            ? "Your saved subject, message, design, and audience will be removed, and the editor starts again from the first template. This can't be undone."
            : pendingReplace?.kind === "template"
              ? `Loading the “${pendingReplace.name}” template replaces what you've written, and your saved draft is removed.`
              : "Reusing this email replaces what you've written, and your saved draft is removed."
        }
        confirmLabel={pendingReplace?.kind === "discard" ? "Discard draft" : "Replace draft"}
        cancelLabel={pendingReplace?.kind === "discard" ? "Keep draft" : "Keep my draft"}
        destructive
        loading={replacing}
        onCancel={() => setPendingReplace(null)}
        onConfirm={() => {
          const request = pendingReplace;
          if (!request) return;
          setReplacing(true);
          void performReplace(request).finally(() => {
            setReplacing(false);
            setPendingReplace(null);
          });
        }}
      />

      <SendConfirmDialog
        open={confirmOpen}
        recipientCount={recipientCount ?? 0}
        audienceText={audienceText}
        subject={(previewReady && preview.subject) || subject}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => {
          setConfirmOpen(false);
          // Snapshot what was reviewed; later edits during the countdown don't change it.
          startCountdown({ statuses, attendance, subject, body, design, count: recipientCount ?? 0, templateId: templateId || null });
        }}
      />
    </div>
  );
}
