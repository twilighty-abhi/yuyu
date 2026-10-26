"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy, Link2, Link2Off, RefreshCw } from "lucide-react";
import { manageCrewJoinLink } from "@/app/actions/crew";
import { ConfirmationDialog } from "@/components/feedback/ConfirmationDialog";
import { useToast } from "@/components/feedback/ToastProvider";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/display";
import { Field, Input } from "@/components/ui/field";

/**
 * The crew sign-up link. Anyone holding it can join the crew (and gets a
 * ticket), so replacing it stops the old one working and turning it off
 * removes it. The server re-checks MANAGE_REGISTRATIONS for every change.
 */
export function CrewJoinLinkCard({ organisationSlug, eventId, joinUrl }: { organisationSlug: string; eventId: string; joinUrl: string | null }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  const [confirm, setConfirm] = useState<"rotate" | "disable" | null>(null);

  function run(action: "create" | "rotate" | "disable", success: string) {
    setConfirm(null);
    startTransition(async () => {
      const res = await manageCrewJoinLink({ organisationSlug, eventId, action });
      if (!res.ok) {
        showToast(res.error, "error");
        return;
      }
      showToast(success, "success");
      router.refresh();
    });
  }

  async function copy() {
    if (!joinUrl) return;
    try {
      await navigator.clipboard.writeText(joinUrl);
      showToast("Crew sign-up link copied", "success");
    } catch {
      showToast("Could not copy", "error");
    }
  }

  return (
    <Card as="section" aria-labelledby="crew-link-title" aria-busy={pending || undefined}>
      <CardHeader
        title={<span id="crew-link-title">Crew sign-up link</span>}
        titleAs="h3"
        description="Share it with your team so they can add themselves. People who sign up get a ticket by email but stay hidden on the event page until you switch them on."
      />
      {joinUrl ? (
        <div className="flex flex-col gap-3">
          <Field label="Sign-up link" hideLabel>
            <Input value={joinUrl} readOnly onFocus={(event) => event.currentTarget.select()} className="font-mono text-sm" />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" startIcon={<Copy />} onClick={() => void copy()} disabled={pending}>
              Copy link
            </Button>
            <Button size="sm" variant="secondary" startIcon={<RefreshCw />} onClick={() => setConfirm("rotate")} disabled={pending}>
              Replace link
            </Button>
            <Button size="sm" variant="dangerQuiet" startIcon={<Link2Off />} onClick={() => setConfirm("disable")} disabled={pending}>
              Turn off
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-body-ui text-ink-muted">There is no sign-up link yet.</p>
          <Button size="sm" variant="secondary" startIcon={<Link2 />} loading={pending} onClick={() => run("create", "Crew sign-up link created")}>
            Create link
          </Button>
        </div>
      )}

      <ConfirmationDialog
        open={confirm === "rotate"}
        title="Replace the crew sign-up link?"
        message="The current link stops working straight away. Share the new link with anyone who still needs to sign up."
        confirmLabel="Replace link"
        loading={pending}
        onCancel={() => setConfirm(null)}
        onConfirm={() => run("rotate", "New crew sign-up link created")}
      />
      <ConfirmationDialog
        open={confirm === "disable"}
        title="Turn off the crew sign-up link?"
        message="The link stops working. Crew who already signed up keep their tickets. You can create a new link later."
        confirmLabel="Turn off"
        loading={pending}
        onCancel={() => setConfirm(null)}
        onConfirm={() => run("disable", "Crew sign-up link turned off")}
      />
    </Card>
  );
}
