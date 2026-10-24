"use client";

import { useState, useTransition, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Crown, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, Callout, Card, CardHeader, Chip } from "@/components/ui/display";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/field";
import { SwitchRow } from "@/components/ui/choice";
import {
  cancelTeamRequestAction,
  leaveTeamAction,
  requestToJoinTeamAction,
  respondToTeamInviteAction,
  saveSeekerProfileAction,
} from "@/app/actions/teams";

/** Drop a cached RSVP marker for this ticket so event pages stop showing "registered". */
function forgetStoredTicket(token: string) {
  try {
    for (const key of Object.keys(localStorage)) {
      if (!key.startsWith("yuyu:rsvp:")) continue;
      try {
        const value = localStorage.getItem(key);
        const parsed = value ? (JSON.parse(value) as { ticketToken?: string }) : null;
        if (parsed?.ticketToken === token) localStorage.removeItem(key);
      } catch {
        // Ignore unreadable entries.
      }
    }
  } catch {
    // Storage unavailable (private mode, blocked site data).
  }
}

/**
 * A member's view of their team on the ticket page: names only, and the one
 * action the ticket token allows, leaving. Management lives on the team page.
 */
export function TicketTeamCard(props: {
  ticketToken: string;
  team: { name: string; leaderName: string | null; members: string[]; isLeader: boolean };
  /** Signed-in leaders get a link to the team page; guests use their emailed link. */
  manageHref: string | null;
  canLeave: boolean;
  eventPageHref: string;
}) {
  const { ticketToken, team, manageHref, canLeave, eventPageHref } = props;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function leave() {
    setError(null);
    startTransition(async () => {
      const res = await leaveTeamAction(ticketToken);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      forgetStoredTicket(ticketToken);
      setOpen(false);
      router.push(eventPageHref);
      router.refresh();
    });
  }

  return (
    <Card as="section" aria-labelledby="ticket-team-title">
      <CardHeader
        titleAs="h2"
        title={<span id="ticket-team-title">{team.name}</span>}
        description={team.leaderName ? `Led by ${team.leaderName}` : "Your team"}
        action={<Chip tone="neutral" size="sm" icon={<Users />}>{team.members.length}</Chip>}
      />
      <ul className="flex flex-col gap-2.5" aria-label="Team members">
        {team.members.map((name, index) => (
          <li key={`${index}-${name}`} className="flex min-w-0 items-center gap-2.5">
            <Avatar name={name} size="xs" />
            <span className="truncate text-body-ui text-ink">{name}</span>
          </li>
        ))}
      </ul>

      {team.isLeader ? (
        <div className="mt-4 border-t border-line pt-4">
          {manageHref ? (
            <Button asChild variant="secondary" size="sm">
              <Link href={manageHref} prefetch={false}>
                <Crown aria-hidden className="size-4" />
                Manage team
              </Link>
            </Button>
          ) : (
            <p className="text-caption text-ink-muted">You lead this team. Manage it from the team link in your confirmation email.</p>
          )}
        </div>
      ) : null}

      {canLeave ? (
        <div className="mt-4 flex justify-center">
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="inline-flex min-h-10 items-center text-sm font-semibold text-ink-secondary underline underline-offset-4 hover:text-danger-fg"
          >
            Leave team
          </button>
        </div>
      ) : null}

      <ConfirmDialog
        open={open}
        title={`Leave ${team.name}?`}
        message={
          team.isLeader
            ? "Leaving cancels your registration for this event. Leadership passes to the member who joined first; if you're the only member, the team is deleted."
            : "Leaving cancels your registration for this event. You can register again on your own or join another team."
        }
        cancelLabel="Stay in team"
        confirmLabel={pending ? "Leaving…" : "Leave team"}
        loading={pending}
        onConfirm={leave}
        onCancel={() => setOpen(false)}
      >
        {error ? <Callout tone="danger" role="alert">{error}</Callout> : null}
      </ConfirmDialog>
    </Card>
  );
}

type SeekerItem = { id: string; displayName: string; headline: string; skills: string[] };
type LookingTeam = { id: string; name: string; size: number; maxSize: number | null };

// Mirrors lib/validators.ts; the client bundle must not import server validators.
const SEEKER_HEADLINE_MAX_LENGTH = 120;
const SEEKER_MAX_SKILLS = 8;
const SEEKER_SKILL_MAX_LENGTH = 30;
const UNSAFE_TEXT = /[<>\u0000-\u001F\u007F]/;

function parseSkills(value: string) {
  return value
    .split(",")
    .map((skill) => skill.trim())
    .filter(Boolean);
}

/** Field messages before the request; the server still decides. */
function seekerProfileErrors(headline: string, skills: string[]) {
  const errors: Record<string, string[]> = {};
  const line = headline.trim();
  if (!line) errors.headline = ["Add a short headline so teams know what you bring."];
  else if (line.length > SEEKER_HEADLINE_MAX_LENGTH) errors.headline = [`Keep the headline to ${SEEKER_HEADLINE_MAX_LENGTH} characters.`];
  else if (UNSAFE_TEXT.test(line)) errors.headline = ["Remove the < and > characters from the headline."];
  if (skills.length > SEEKER_MAX_SKILLS) errors.skills = [`Add up to ${SEEKER_MAX_SKILLS} skills.`];
  else if (skills.some((skill) => skill.length > SEEKER_SKILL_MAX_LENGTH)) errors.skills = [`Keep each skill to ${SEEKER_SKILL_MAX_LENGTH} characters.`];
  else if (skills.some((skill) => UNSAFE_TEXT.test(skill))) errors.skills = ["Remove the < and > characters from your skills."];
  return errors;
}

/**
 * Server field errors keyed for this form: Zod reports one skill's problem as
 * `skills.N`, which is shown on the Skills field.
 */
function profileFieldErrors(fieldErrors: Record<string, string[]> | undefined) {
  const errors: Record<string, string[]> = {};
  for (const [key, messages] of Object.entries(fieldErrors ?? {})) {
    const field = key === "skills" || key.startsWith("skills.") ? "skills" : key;
    if (field !== "headline" && field !== "skills") continue;
    errors[field] = [...(errors[field] ?? []), ...messages];
  }
  return errors;
}

/**
 * Looking for a team (SOLO_WITH_MATCHING) on a solo registrant's ticket page:
 * their own profile, invitations to answer, their requests, and, while they
 * are listed, the other seekers and the teams looking for members.
 */
export function TicketSeekerPanel(props: {
  ticketToken: string;
  profile: { headline: string; skills: string[]; visible: boolean } | null;
  invites: Array<{ id: string; teamName: string; size: number; maxSize: number | null }>;
  requests: Array<{ id: string; teamId: string; teamName: string }>;
  seekers: SeekerItem[] | null;
  teams: LookingTeam[] | null;
}) {
  const { ticketToken, profile, invites, requests, seekers, teams } = props;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ tone: "success" | "danger"; message: string } | null>(null);
  const [editing, setEditing] = useState(!profile);
  const [headline, setHeadline] = useState(profile?.headline ?? "");
  const [skills, setSkills] = useState(profile?.skills.join(", ") ?? "");
  const [visible, setVisible] = useState(profile?.visible ?? true);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const requestedTeamIds = new Set(requests.map((request) => request.teamId));

  function run(id: string, task: () => Promise<void>) {
    setFeedback(null);
    setBusyId(id);
    startTransition(async () => {
      try {
        await task();
      } finally {
        setBusyId(null);
      }
    });
  }

  function save(e: FormEvent) {
    e.preventDefault();
    const parsedSkills = parseSkills(skills);
    const local = seekerProfileErrors(headline, parsedSkills);
    setErrors(local);
    if (Object.keys(local).length) return;
    run("profile", async () => {
      const res = await saveSeekerProfileAction(ticketToken, { headline, skills: parsedSkills, visible });
      if (!res.ok) {
        const shown = profileFieldErrors(res.fieldErrors);
        setErrors(shown);
        // Always say something: an error with no field to show it on goes in the banner.
        if (!Object.keys(shown).length) setFeedback({ tone: "danger", message: res.error });
        return;
      }
      setEditing(false);
      setFeedback({ tone: "success", message: visible ? "You're on the Looking for a team list." : "You're hidden from the list." });
      router.refresh();
    });
  }

  function setListed(next: boolean) {
    if (!profile) return;
    run("visibility", async () => {
      const res = await saveSeekerProfileAction(ticketToken, { headline: profile.headline, skills: profile.skills, visible: next });
      if (!res.ok) return setFeedback({ tone: "danger", message: res.error });
      setVisible(next);
      router.refresh();
    });
  }

  function answerInvite(requestId: string, accept: boolean) {
    run(requestId, async () => {
      const res = await respondToTeamInviteAction(ticketToken, requestId, accept);
      if (!res.ok) return setFeedback({ tone: "danger", message: res.error });
      setFeedback({ tone: "success", message: accept ? "You joined the team." : "Invitation declined." });
      router.refresh();
    });
  }

  function requestJoin(team: LookingTeam) {
    run(team.id, async () => {
      const res = await requestToJoinTeamAction(ticketToken, team.id);
      if (!res.ok) return setFeedback({ tone: "danger", message: res.error });
      setFeedback({ tone: "success", message: `Request sent to ${team.name}. Their leader can accept it from the team page.` });
      router.refresh();
    });
  }

  function withdraw(requestId: string) {
    run(requestId, async () => {
      const res = await cancelTeamRequestAction(ticketToken, requestId);
      if (!res.ok) return setFeedback({ tone: "danger", message: res.error });
      router.refresh();
    });
  }

  return (
    <Card as="section" aria-labelledby="ticket-seeker-title">
      <CardHeader
        title={<span id="ticket-seeker-title">Looking for a team</span>}
        description="Other people at this event see only your first name, last initial, headline and skills."
      />

      {feedback ? (
        <Callout tone={feedback.tone} role={feedback.tone === "danger" ? "alert" : "status"} className="mb-4">{feedback.message}</Callout>
      ) : null}

      {invites.length ? (
        <div className="mb-5">
          <h3 className="text-label text-ink">Invitations</h3>
          <ul className="mt-2 flex flex-col divide-y divide-line">
            {invites.map((invite) => (
              <li key={invite.id} className="flex flex-col gap-2 py-3 first:pt-0">
                <p className="min-w-0 text-body-ui text-ink">
                  <span className="font-semibold">{invite.teamName}</span>
                  <span className="text-ink-muted"> · {invite.maxSize != null ? `${invite.size} of ${invite.maxSize}` : invite.size} members</span>
                </p>
                <div className="flex gap-2">
                  <Button variant="primary" size="sm" loading={busyId === invite.id} disabled={pending} onClick={() => answerInvite(invite.id, true)}>Join team</Button>
                  <Button variant="secondary" size="sm" disabled={pending} onClick={() => answerInvite(invite.id, false)}>Decline</Button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {editing ? (
        <form onSubmit={save} className="flex flex-col gap-3.5" noValidate>
          <Field label="Headline" helperText="What you're good at or want to work on, up to 120 characters." error={errors.headline?.[0]}>
            <Input value={headline} onChange={(e) => setHeadline(e.target.value)} maxLength={120} autoComplete="off" required />
          </Field>
          <Field label="Skills" optional helperText="Separate with commas. Up to 8, each up to 30 characters." error={errors.skills?.[0]}>
            <Input value={skills} onChange={(e) => setSkills(e.target.value)} autoComplete="off" maxLength={280} />
          </Field>
          <SwitchRow label="Show me on the list" description="Turn off to hide yourself without losing your details." checked={visible} onCheckedChange={setVisible} />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="primary" size="sm" loading={busyId === "profile"} loadingLabel="Saving…">
              {profile ? "Save" : "List me"}
            </Button>
            {profile ? <Button variant="quiet" size="sm" onClick={() => setEditing(false)}>Cancel</Button> : null}
          </div>
        </form>
      ) : profile ? (
        <div className="flex flex-col gap-3">
          <div className="min-w-0">
            <p className="break-words text-body-ui text-ink">{profile.headline}</p>
            {profile.skills.length ? (
              <ul className="mt-1.5 flex flex-wrap gap-1.5" aria-label="Your skills">
                {profile.skills.map((skill) => <li key={skill}><Chip tone="outline" size="sm">{skill}</Chip></li>)}
              </ul>
            ) : null}
          </div>
          <SwitchRow label="Show me on the list" checked={profile.visible} disabled={pending} onCheckedChange={setListed} />
          <div>
            <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>Edit details</Button>
          </div>
        </div>
      ) : null}

      {requests.length ? (
        <div className="mt-5 border-t border-line pt-5">
          <h3 className="text-label text-ink">Your requests</h3>
          <ul className="mt-2 flex flex-col divide-y divide-line">
            {requests.map((request) => (
              <li key={request.id} className="flex items-center justify-between gap-3 py-2.5">
                <span className="min-w-0 truncate text-body-ui text-ink">{request.teamName}</span>
                <Button variant="quiet" size="sm" loading={busyId === request.id} disabled={pending} onClick={() => withdraw(request.id)}>Withdraw</Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {teams ? (
        <div className="mt-5 border-t border-line pt-5">
          <h3 className="text-label text-ink">Teams looking for members</h3>
          {teams.length === 0 ? (
            <p className="mt-1 text-body-ui text-ink-muted">No teams are looking for members right now.</p>
          ) : (
            <ul className="mt-2 flex flex-col divide-y divide-line">
              {teams.map((team) => (
                <li key={team.id} className="flex items-center justify-between gap-3 py-2.5">
                  <p className="min-w-0 text-body-ui text-ink">
                    <span className="block truncate font-semibold">{team.name}</span>
                    <span className="text-sm text-ink-muted">{team.maxSize != null ? `${team.size} of ${team.maxSize}` : team.size} members</span>
                  </p>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={pending || requestedTeamIds.has(team.id)}
                    loading={busyId === team.id}
                    onClick={() => requestJoin(team)}
                  >
                    {requestedTeamIds.has(team.id) ? "Requested" : "Ask to join"}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      {seekers ? (
        <div className="mt-5 border-t border-line pt-5">
          <h3 className="text-label text-ink">Others looking for a team</h3>
          {seekers.length === 0 ? (
            <p className="mt-1 text-body-ui text-ink-muted">No one else is listed yet.</p>
          ) : (
            <ul className="mt-2 flex flex-col divide-y divide-line">
              {seekers.map((seeker) => (
                <li key={seeker.id} className="flex min-w-0 items-start gap-3 py-2.5">
                  <Avatar name={seeker.displayName} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-label text-ink">{seeker.displayName}</p>
                    <p className="break-words text-sm text-ink-secondary">{seeker.headline}</p>
                    {seeker.skills.length ? (
                      <ul className="mt-1.5 flex flex-wrap gap-1.5" aria-label="Skills">
                        {seeker.skills.map((skill) => <li key={skill}><Chip tone="outline" size="sm">{skill}</Chip></li>)}
                      </ul>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </Card>
  );
}
