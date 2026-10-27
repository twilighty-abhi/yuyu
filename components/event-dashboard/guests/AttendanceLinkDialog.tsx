"use client";

import { useState, useTransition } from "react";
import { Copy, Link2 } from "lucide-react";
import { issueAttendanceLink } from "@/app/actions/attendance-check";
import { useToast } from "@/components/feedback/ToastProvider";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Callout } from "@/components/ui/display";
import { Field, Input } from "@/components/ui/field";
import type { AttendanceState } from "@/lib/attendanceCheck";

/**
 * Guests · People "Share attendance link": one guest's "Are you still
 * coming?" form, to send by hand (WhatsApp, text) instead of by email. Only
 * the link's digest is stored, so the server issues a new link each time;
 * for a guest already asked it replaces the emailed one. The server re-checks
 * the owner/admin rule, the guest and the event start.
 */
export function AttendanceLinkDialog({
  organisationSlug,
  eventId,
  guest,
  onClose,
}: {
  organisationSlug: string;
  eventId: string;
  guest: { rsvpId: string; name: string; state: AttendanceState | null };
  onClose: (created: boolean) => void;
}) {
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const asked = guest.state != null && guest.state !== "notAsked";

  function create() {
    setError(null);
    startTransition(async () => {
      const res = await issueAttendanceLink({ organisationSlug, eventId, rsvpId: guest.rsvpId });
      if (!res.ok || !res.data) {
        setError(res.ok ? "Could not create the link. Please try again." : res.error);
        return;
      }
      setUrl(res.data.url);
    });
  }

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      showToast("Attendance link copied", "success");
    } catch {
      showToast("Could not copy", "error");
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !pending) onClose(url !== null);
      }}
    >
      <DialogContent size="sm">
        <DialogHeader
          title={`Share ${guest.name}'s attendance link`}
          description="Send it yourself, for example by text or WhatsApp. It opens the same Yes or No form as the email. No email is sent."
        />
        <DialogBody className="flex flex-col gap-3">
          {url ? (
            <>
              <Field label="Attendance link" hideLabel>
                <Input value={url} readOnly onFocus={(event) => event.currentTarget.select()} className="font-mono text-sm" />
              </Field>
              <p className="text-caption text-ink-muted">
                Send it only to {guest.name}: anyone with the link can answer for them. It works until the event starts.
              </p>
            </>
          ) : asked ? (
            <Callout tone="warning">
              {guest.name} has already been asked. A new link replaces the one in their email, which stops working.
            </Callout>
          ) : (
            <p className="text-body-ui text-ink">
              {guest.name} will count as asked, so <strong>Ask guests to confirm attendance</strong> won’t email them too.
            </p>
          )}
          {error ? <Callout tone="danger" role="alert">{error}</Callout> : null}
        </DialogBody>
        <DialogFooter>
          {url ? (
            <>
              <Button variant="secondary" onClick={() => onClose(true)}>
                Done
              </Button>
              <Button variant="primary" startIcon={<Copy />} onClick={() => void copy()}>
                Copy link
              </Button>
            </>
          ) : (
            <>
              <Button variant="secondary" disabled={pending} onClick={() => onClose(false)}>
                Cancel
              </Button>
              <Button variant="primary" startIcon={<Link2 />} loading={pending} onClick={create}>
                {asked ? "Create new link" : "Create link"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
