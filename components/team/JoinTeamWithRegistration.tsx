"use client";

import { useEffect, useState, useTransition, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { UsersRound } from "lucide-react";
import { joinTeamWithTicketAction } from "@/app/actions/teams";
import { Button } from "@/components/ui/button";
import { Callout, Card, CardHeader } from "@/components/ui/display";
import { Field, Input } from "@/components/ui/field";

/*
 * Joining a team with an existing solo registration (docs/TEAMS.md): the
 * registration moves into the team and keeps its ticket. The server checks
 * everything again under the event lock (same event, team size, team status,
 * check-in), so these components only collect the link and explain.
 */

const PLACE_NOTE =
  "You keep your ticket, and your place follows the team's: if the team is waiting for a place or for approval, you wait with it and your current place goes to the next person.";

/** The signed-in person's own registration for this event, as the join page sees it. */
export type JoinPageRegistration =
  | { state: "solo"; ticketToken: string }
  | { state: "this-team"; ticketToken: string }
  | { state: "other-team"; ticketToken: string }
  | { state: "declined"; ticketToken: string };

function JoinButton(props: { ticketToken: string; joinToken: string; teamName: string; label?: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-3">
      {error ? <Callout tone="danger" role="alert">{error}</Callout> : null}
      <Button
        variant="accent"
        fullWidth
        loading={pending}
        loadingLabel="Joining…"
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const res = await joinTeamWithTicketAction(props.ticketToken, props.joinToken);
            if (!res.ok) {
              setError(res.error);
              return;
            }
            router.push(`/ticket/${props.ticketToken}`);
            router.refresh();
          });
        }}
      >
        <UsersRound aria-hidden className="size-[18px]" />
        {props.label ?? `Join ${props.teamName}`}
      </Button>
    </div>
  );
}

/**
 * Join page, signed in with a registration for this event: move a solo
 * registration into the team instead of registering again, or explain why
 * that isn't possible.
 */
export function JoinWithAccountRegistration(props: { registration: JoinPageRegistration; joinToken: string; teamName: string }) {
  const { registration, joinToken, teamName } = props;
  const ticketHref = `/ticket/${registration.ticketToken}`;
  const ticketLink = (
    <Button asChild variant="secondary" fullWidth>
      <Link href={ticketHref} prefetch={false}>View your ticket</Link>
    </Button>
  );
  switch (registration.state) {
    case "solo":
      return (
        <div className="flex flex-col gap-3">
          <Callout tone="info" title="You're already registered on your own">
            Join {teamName} with that registration instead of signing up again. {PLACE_NOTE}
          </Callout>
          <JoinButton ticketToken={registration.ticketToken} joinToken={joinToken} teamName={teamName} />
        </div>
      );
    case "this-team":
      return (
        <div className="flex flex-col gap-3">
          <Callout tone="success" title={`You're in ${teamName}`} />
          {ticketLink}
        </div>
      );
    case "other-team":
      return (
        <div className="flex flex-col gap-3">
          <Callout tone="warning" title="You're already in another team">
            Each person can be in one team. To switch, leave your current team from your ticket page (this cancels that registration), then open this link again.
          </Callout>
          {ticketLink}
        </div>
      );
    case "declined":
      return <Callout tone="danger" title="Your registration for this event was declined" />;
  }
}

/**
 * Join page, not signed in (or signed in without a registration): when this
 * browser remembers a ticket for the event, offer to join with it. The server
 * decides whether that registration can move.
 */
export function JoinWithSavedTicket(props: { orgSlug: string; eventSlug: string; joinToken: string; teamName: string }) {
  const { orgSlug, eventSlug, joinToken, teamName } = props;
  const [ticketToken, setTicketToken] = useState<string | null>(null);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const raw = window.localStorage.getItem(`yuyu:rsvp:${orgSlug}:e:${eventSlug}`);
        const parsed = raw ? (JSON.parse(raw) as { ticketToken?: unknown }) : null;
        setTicketToken(typeof parsed?.ticketToken === "string" ? parsed.ticketToken : null);
      } catch {
        setTicketToken(null);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [orgSlug, eventSlug]);
  if (!ticketToken) return null;
  return (
    <div className="flex flex-col gap-3 border-b border-line pb-4">
      <Callout tone="info" title="Already registered in this browser?">
        Join {teamName} with that registration instead of signing up again. {PLACE_NOTE}
      </Callout>
      <JoinButton ticketToken={ticketToken} joinToken={joinToken} teamName={teamName} label={`Join ${teamName} with my registration`} />
    </div>
  );
}

/**
 * Ticket page, solo registration on a team event: paste a team's join link
 * to move this registration into that team.
 */
export function TicketJoinTeamForm(props: { ticketToken: string }) {
  const { ticketToken } = props;
  const router = useRouter();
  const [link, setLink] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setDone(null);
    if (!link.trim()) {
      setError("Paste the team link your team leader shared.");
      return;
    }
    startTransition(async () => {
      const res = await joinTeamWithTicketAction(ticketToken, link);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setLink("");
      setDone(res.data ? `You joined ${res.data.teamName}.` : "You joined the team.");
      router.refresh();
    });
  }

  return (
    <Card as="section" aria-labelledby="ticket-join-team-title">
      <CardHeader
        titleAs="h2"
        title={<span id="ticket-join-team-title">Join a team</span>}
        description="Got a team link from a team leader? Paste it here to join with this registration."
      />
      {done ? <Callout tone="success" role="status" className="mb-4">{done}</Callout> : null}
      <form onSubmit={submit} className="flex flex-col gap-3.5" noValidate>
        <Field label="Team link" helperText={PLACE_NOTE} error={error ?? undefined}>
          <Input
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="https://…/team/…"
            autoComplete="off"
            spellCheck={false}
            maxLength={2048}
          />
        </Field>
        <div>
          <Button type="submit" variant="primary" size="sm" loading={pending} loadingLabel="Joining…">
            Join this team
          </Button>
        </div>
      </form>
    </Card>
  );
}
