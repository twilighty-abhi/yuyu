"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BellRing, CalendarCheck, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SwitchRow } from "@/components/ui/choice";
import { Callout } from "@/components/ui/display";
import { ConfirmDialog, Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { useToast } from "@/components/feedback/ToastProvider";
import { previewAttendanceCheckSend, remindAttendanceChecks, sendAttendanceChecks, setAttendanceReleaseOnDecline } from "@/app/actions/attendance-check";
import { attendanceSendLabel } from "@/lib/attendanceCheck";
import type { AttendanceCheckCardData } from "@/lib/eventDashboard/attendanceCheckCard";

/*
 * "Ask guests to confirm attendance" on the event Emails tab. Nothing here is
 * automatic: every email follows an organiser's click and a confirmation step.
 * Only rendered for people who may email guests (organisation owner/admin).
 */

const people = (count: number, noun = "guest") => `${count} ${count === 1 ? noun : `${noun}s`}`;

type SendPreview = { count: number; firstSend: boolean };

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-lg bg-subtle px-3 py-2.5">
      <dt className="text-caption text-ink-muted">{label}</dt>
      <dd className="text-h4 tabular-nums text-ink">{value}</dd>
    </div>
  );
}

export function AttendanceCheckCard({ organisationSlug, eventId, data }: { organisationSlug: string; eventId: string; data: AttendanceCheckCardData }) {
  const router = useRouter();
  const { showToast } = useToast();
  const ref = { organisationSlug, eventId };

  const [releaseOnDecline, setReleaseOnDecline] = useState(data.releaseOnDecline);
  const [savingSetting, startSetting] = useTransition();
  const [previewing, startPreview] = useTransition();
  const [sending, startSend] = useTransition();
  const [reminding, startRemind] = useTransition();
  const [preview, setPreview] = useState<SendPreview | null>(null);
  const [remindOpen, setRemindOpen] = useState(false);

  const busy = previewing || sending || reminding;
  const open = data.closed === null;
  const neverSent = data.asked === 0 && data.lastSent === null;

  const changeRelease = (next: boolean) => {
    const previous = releaseOnDecline;
    setReleaseOnDecline(next);
    startSetting(async () => {
      const result = await setAttendanceReleaseOnDecline({ ...ref, releaseOnDecline: next });
      if (!result.ok) {
        setReleaseOnDecline(previous);
        showToast(result.error, "error");
        return;
      }
      router.refresh();
    });
  };

  const openPreview = () => {
    startPreview(async () => {
      const result = await previewAttendanceCheckSend(ref);
      if (!result.ok) return showToast(result.error, "error");
      if (!result.data) return showToast("Could not count the guests. Please try again.", "error");
      setPreview({ count: result.data.count, firstSend: result.data.firstSend });
    });
  };

  const confirmSend = () => {
    startSend(async () => {
      const result = await sendAttendanceChecks(ref);
      setPreview(null);
      if (!result.ok) {
        showToast(result.error, "error");
        router.refresh();
        return;
      }
      const queued = result.data?.queued ?? 0;
      showToast(`Asking ${people(queued)} to confirm. Emails are on their way.`, "success");
      router.refresh();
    });
  };

  const confirmRemind = () => {
    startRemind(async () => {
      const result = await remindAttendanceChecks(ref);
      setRemindOpen(false);
      if (!result.ok) {
        showToast(result.error, "error");
        router.refresh();
        return;
      }
      showToast(`Reminder queued for ${people(result.data?.queued ?? 0)}.`, "success");
      router.refresh();
    });
  };

  const askLabel = neverSent ? "Ask guests to confirm attendance" : "Ask newly confirmed guests";

  return (
    <section aria-labelledby="attendance-check-heading" className="flex min-w-0 flex-col gap-4 rounded-xl border border-line bg-canvas p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <span aria-hidden className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-tint-peach text-ink [&_svg]:size-[18px]">
          <CalendarCheck />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="attendance-check-heading" className="text-h4 text-ink">Attendance confirmation</h2>
          <p className="text-sm text-ink-muted">
            Email each confirmed guest a short “Are you still coming?” with Yes and No buttons. Most organisers send it 1–2 days before the event. Nothing is sent until you choose to.
          </p>
        </div>
      </div>

      {data.closed === "cancelled" ? (
        <Callout tone="warning">This event is cancelled, so guests can no longer be asked.</Callout>
      ) : data.closed === "started" ? (
        <Callout tone="info">This event has started ({data.eventStartLabel}), so guests can no longer be asked or reminded. The replies below are final.</Callout>
      ) : null}

      <div role="status" aria-live="polite" className="flex flex-col gap-3">
        {neverSent ? (
          <p className="text-body-ui text-ink">
            Not sent yet. {data.notAsked > 0 ? <>{people(data.notAsked, "confirmed guest")} would be asked.</> : "There are no confirmed guests to ask yet."}
          </p>
        ) : (
          <>
            <p className="text-body-ui text-ink">
              Asked <strong className="font-bold tabular-nums">{people(data.asked)}</strong>
              {data.lastSent ? (
                <>
                  {" "}· last sent <time dateTime={data.lastSent.at}>{data.lastSent.label}</time>
                  {data.lastSent.byName ? ` by ${data.lastSent.byName}` : ""}
                </>
              ) : null}
            </p>
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="Coming" value={data.coming} />
              <Stat label="Not coming" value={data.notComing} />
              <Stat label="No reply" value={data.noReply} />
              <Stat label="Newly confirmed, not asked" value={data.notAsked} />
            </dl>
            {data.released > 0 ? (
              <p className="text-caption text-ink-muted">
                {people(data.released, "place")} released after a guest said No. Released guests are no longer registered, so they are not counted above.
              </p>
            ) : null}
          </>
        )}
      </div>

      <div className="border-t border-line pt-4">
        <SwitchRow
          label="Free the place when a guest says No"
          description={
            releaseOnDecline
              ? "A No cancels their registration, so the next person on the waitlist can move up. It can't be undone by the guest."
              : "A No is recorded only. The guest keeps their registration until you or they cancel it."
          }
          checked={releaseOnDecline}
          disabled={savingSetting || !open}
          onCheckedChange={(value) => changeRelease(value === true)}
        />
      </div>

      {open ? (
        <div className="flex flex-col gap-3 border-t border-line pt-4">
          <div className="flex flex-col gap-2 min-[420px]:flex-row min-[420px]:flex-wrap">
            <Button
              variant="primary"
              startIcon={<Send />}
              loading={previewing}
              disabled={busy || data.notAsked === 0}
              onClick={openPreview}
            >
              {askLabel}
            </Button>
            {!neverSent ? (
              <Button variant="secondary" startIcon={<BellRing />} loading={reminding} disabled={busy || data.remindable === 0} onClick={() => setRemindOpen(true)}>
                Remind people who haven’t replied
              </Button>
            ) : null}
          </div>
          <p className="text-caption text-ink-muted">
            {data.notAsked === 0 && !neverSent ? "Everyone confirmed has been asked. Guests who are confirmed later can be asked from here. " : null}
            {!neverSent
              ? data.remindable > 0
                ? `${people(data.remindable)} can be reminded now. `
                : data.noReply > 0
                  ? `Each guest can be reminded once every 12 hours${data.nextReminderLabel ? `; the next reminder is possible from ${data.nextReminderLabel}` : ""}. `
                  : null
              : null}
            You can send until the event starts ({data.eventStartLabel}).
          </p>
        </div>
      ) : null}

      <Dialog
        open={preview !== null}
        onOpenChange={(next) => {
          if (!next && !sending) setPreview(null);
        }}
      >
        <DialogContent size="sm">
          <DialogHeader
            title={preview ? attendanceSendLabel(preview.count, preview.firstSend) : "Ask guests to confirm"}
            description="Emails can't be recalled once delivery starts."
          />
          <DialogBody className="flex flex-col gap-3">
            {preview && preview.count > 0 ? (
              <dl className="flex flex-col divide-y divide-line rounded-xl border border-line text-body-ui">
                <div className="px-4 py-3">
                  <dt className="text-caption text-ink-muted">To</dt>
                  <dd className="text-ink">
                    <span className="font-bold">{people(preview.count, "confirmed guest")}</span>
                    {preview.firstSend ? "" : " who joined since the last send"}
                  </dd>
                </div>
                <div className="px-4 py-3">
                  <dt className="text-caption text-ink-muted">Event</dt>
                  <dd className="text-ink">{data.eventStartLabel}</dd>
                </div>
              </dl>
            ) : (
              <p className="text-body-ui text-ink">Every confirmed guest has already been asked.</p>
            )}
            <p className="text-caption text-ink-muted">
              Each guest gets one email, and it counts towards your email sending limit. Anyone already asked is skipped. They can change their answer until the event starts.
              {releaseOnDecline ? " A No frees their place." : " A No is recorded only."}
            </p>
          </DialogBody>
          <DialogFooter>
            <Button variant="secondary" disabled={sending} onClick={() => setPreview(null)}>
              Cancel
            </Button>
            <Button variant="primary" startIcon={<Send />} loading={sending} disabled={!preview || preview.count === 0} onClick={confirmSend}>
              {preview && preview.count > 0 ? `Send to ${people(preview.count)}` : "Send"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={remindOpen}
        title={`Remind ${people(data.remindable)}?`}
        message="Guests who haven't replied get the question again with a new link; the link in their earlier email stops working. Each guest can be reminded once every 12 hours, and each reminder counts towards your email sending limit."
        confirmLabel="Send reminder"
        destructive={false}
        loading={reminding}
        onCancel={() => setRemindOpen(false)}
        onConfirm={confirmRemind}
      />
    </section>
  );
}
