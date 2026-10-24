"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { approveRsvp, rejectRsvp } from "@/app/actions/rsvp-lifecycle";
import { approveTeam, rejectTeam } from "@/app/actions/team-admin";
import { ConfirmationDialog } from "@/components/feedback/ConfirmationDialog";
import { useToast } from "@/components/feedback/ToastProvider";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/display";
import { formatRelativeTime } from "@/lib/format/datetime";
import type { PendingRequest } from "@/lib/eventDashboard/overview";
import { OpenTabButton } from "../EventDashboardTabs";

/** "Yesterday" → "yesterday"; dates such as "13 Oct 2026" stay as they are. */
function midSentence(value: string) {
  return /^[A-Z][a-z]/.test(value) && !/^[A-Z][a-z]{2} /.test(value) ? value.charAt(0).toLowerCase() + value.slice(1) : value;
}

/** A pending request: one person, or (TEAM events) one whole team, which counts as one unit. */
type WaitingRequest = PendingRequest & { kind?: "rsvp" | "team"; size?: number };

/** Approval requests with inline Approve / Decline (organisation admins only; the actions re-check). */
export function WaitingForYou({
  organisationSlug,
  eventId,
  timeZone,
  referenceTime,
  requests,
  pendingTotal,
}: {
  organisationSlug: string;
  eventId: string;
  timeZone: string;
  referenceTime: string;
  requests: WaitingRequest[];
  /** Pending units: people, or teams plus solo registrants on a TEAM event. */
  pendingTotal: number;
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [declining, setDeclining] = useState<WaitingRequest | null>(null);
  const now = new Date(referenceTime);

  function run(request: WaitingRequest, decision: "approve" | "decline", success: string) {
    setBusyId(request.id);
    startTransition(async () => {
      const result = request.kind === "team"
        ? await (decision === "approve" ? approveTeam : rejectTeam)({ organisationSlug, teamId: request.id, eventId })
        : await (decision === "approve" ? approveRsvp : rejectRsvp)({ organisationSlug, rsvpId: request.id, eventId });
      setBusyId(null);
      if (!result.ok) {
        showToast(result.error, "error");
        return;
      }
      showToast(success, "success");
      router.refresh();
    });
  }

  const more = pendingTotal - requests.length;

  return (
    <section aria-labelledby="overview-waiting-title" className="flex flex-col gap-1 rounded-xl border border-line bg-canvas p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="overview-waiting-title" className="text-h4 text-ink">
          Waiting for you
        </h2>
        <OpenTabButton tab="guests" sub="people" className="inline-flex min-h-9 items-center gap-1 text-sm font-semibold text-ink underline-offset-4 hover:underline">
          All guests <ArrowRight aria-hidden className="size-4" />
        </OpenTabButton>
      </div>
      {requests.length === 0 ? (
        <p className="py-2 text-body-ui text-ink-muted">No one is waiting for approval.</p>
      ) : (
        <ul className="flex flex-col">
          {requests.map((request) => {
            const busy = pending && busyId === request.id;
            return (
              <li key={request.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line py-2.5 last:border-b-0">
                <Avatar name={request.name} size="md" tone="warning" />
                <span className="flex min-w-0 flex-[1_1_160px] flex-col">
                  <span className="truncate font-semibold text-ink">{request.name}</span>
                  <span className="text-caption text-ink-muted">
                    {request.kind === "team" ? `Team of ${request.size ?? 0} · asked to join` : "Asked to join"} · {midSentence(formatRelativeTime(request.createdAt, timeZone, now))}
                  </span>
                </span>
                <span className="flex items-center gap-1">
                  <Button size="sm" variant="secondary" disabled={pending} loading={busy} loadingLabel="Approving…" aria-label={`Approve ${request.name}`} onClick={() => run(request, "approve", `${request.name} approved`)}>
                    Approve
                  </Button>
                  <Button size="sm" variant="dangerQuiet" disabled={pending} aria-label={`Decline ${request.name}`} onClick={() => setDeclining(request)}>
                    Decline
                  </Button>
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {more > 0 ? <p className="pt-1 text-caption text-ink-muted">and {more} more in Guests.</p> : null}

      <ConfirmationDialog
        open={declining != null}
        title="Decline this request?"
        message={declining?.kind === "team" ? `Everyone in ${declining.name} will be told they don't have a place.` : `${declining?.name ?? "This guest"} will not get a place at this event.`}
        confirmLabel="Decline"
        loading={pending}
        onCancel={() => setDeclining(null)}
        onConfirm={() => {
          if (!declining) return;
          const request = declining;
          setDeclining(null);
          run(request, "decline", `${request.name} declined`);
        }}
      />
    </section>
  );
}
