"use client";

import { useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { Mail, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Callout, Card, CardHeader } from "@/components/ui/display";
import { requestSubmissionLinkAction } from "@/app/actions/submissions";

export type TicketSubmissionMode =
  /** Signed-in owner: open the account submission page; solo owners can also email themselves the link. */
  | { kind: "account"; href: string; isTeam: boolean }
  /** A guest solo registration: the link is emailed to the registration's address. */
  | { kind: "email" }
  /** A team member who is not signed in (or registered as a guest). */
  | { kind: "team-info" }
  /** An account-owned registration viewed while signed out or as someone else. */
  | { kind: "sign-in" }
  /** Not confirmed yet. */
  | { kind: "not-confirmed" };

/**
 * The ticket page's "Your project" card (docs/HACKATHON.md). The ticket token
 * never edits a submission: it can only ask for the solo submission link to
 * be emailed to the registration's own address.
 */
export function TicketSubmissionCard({ ticketToken, mode }: { ticketToken: string; mode: TicketSubmissionMode }) {
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ tone: "success" | "info" | "danger"; message: string } | null>(null);
  const isTeam = mode.kind === "team-info" || (mode.kind === "account" && mode.isTeam);

  function requestLink() {
    setFeedback(null);
    startTransition(async () => {
      const res = await requestSubmissionLinkAction(ticketToken);
      if (!res.ok) {
        setFeedback({ tone: "danger", message: res.error });
        return;
      }
      setFeedback(
        res.data?.sent
          ? { tone: "success", message: "We've emailed your submission link to the address you registered with. Any older link no longer works." }
          : { tone: "info", message: "A link was sent a moment ago. Check your inbox, or try again in a minute." },
      );
    });
  }

  const emailButton = (
    <Button variant={mode.kind === "account" ? "quiet" : "secondary"} size="sm" loading={pending} loadingLabel="Sending…" startIcon={<Mail />} onClick={requestLink}>
      Email me my submission link
    </Button>
  );

  let body: ReactNode;
  switch (mode.kind) {
    case "account":
      body = (
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="primary" size="sm">
            <Link href={mode.href} prefetch={false}>
              <Send aria-hidden className="size-4" />
              {isTeam ? "Open team project" : "Open your project"}
            </Link>
          </Button>
          {isTeam ? null : emailButton}
        </div>
      );
      break;
    case "email":
      body = (
        <div className="flex flex-col items-start gap-2">
          <p className="text-body-ui text-ink-muted">We&apos;ll email a private link to the address you registered with. Anyone with that link can edit your project, so keep it to yourself.</p>
          {emailButton}
        </div>
      );
      break;
    case "team-info":
      body = <p className="text-body-ui text-ink-muted">Your team leader submits the project from the team page. Members can also edit it after signing in to the account they registered with.</p>;
      break;
    case "sign-in":
      body = <p className="text-body-ui text-ink-muted">Sign in to the account you registered with to submit your project.</p>;
      break;
    case "not-confirmed":
      body = <p className="text-body-ui text-ink-muted">You can submit a project once your place is confirmed.</p>;
      break;
  }

  return (
    <Card as="section" aria-labelledby="ticket-submission">
      <CardHeader
        title={<span id="ticket-submission">{isTeam ? "Team project" : "Your project"}</span>}
        description="This event takes project submissions for judging."
      />
      <div className="flex flex-col gap-3">
        {body}
        {feedback ? <Callout tone={feedback.tone} role={feedback.tone === "danger" ? "alert" : "status"}>{feedback.message}</Callout> : null}
      </div>
    </Card>
  );
}
