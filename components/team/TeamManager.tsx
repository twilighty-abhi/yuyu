"use client";

import { useState, useTransition, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Copy, Crown, MoreHorizontal, RefreshCw, UserMinus, UserPlus, Users } from "lucide-react";
import { Button, IconButton } from "@/components/ui/button";
import { Avatar, Callout, Card, CardHeader, Chip, DangerZone, EmptyState, type ChipTone } from "@/components/ui/display";
import { ConfirmDialog, Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Field, Input, ReadOnlyValue } from "@/components/ui/field";
import { SwitchRow } from "@/components/ui/choice";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui/menu";
import {
  addTeamMemberAction,
  cancelTeamInviteAction,
  disbandTeamAction,
  inviteSeekerAction,
  regenerateTeamJoinLinkAction,
  regenerateTeamManageLinkAction,
  removeTeamMemberAction,
  renameTeamAction,
  respondToTeamRequestAction,
  setTeamLookingForMembersAction,
  transferTeamLeadershipAction,
  type TeamRef,
} from "@/app/actions/teams";

export type TeamManagerMember = { rsvpId: string; name: string; isLeader: boolean; checkedIn: boolean };
export type TeamManagerRequest = { id: string; direction: "INVITE" | "REQUEST"; displayName: string; headline: string | null; skills: string[] };
export type TeamManagerSeeker = { id: string; displayName: string; headline: string; skills: string[] };

export type TeamManagerProps = {
  teamRef: TeamRef;
  /** True on `/team/{token}`: the management link itself can be rotated there. */
  tokenPage: boolean;
  /** Absolute origin for shareable links; empty means "use this browser's origin". */
  baseUrl: string;
  team: {
    name: string;
    status: "CONFIRMED" | "WAITLISTED" | "PENDING_APPROVAL" | "REJECTED";
    size: number;
    minSize: number | null;
    maxSize: number | null;
    incomplete: boolean;
    lookingForMembers: boolean;
    joinPath: string;
  };
  event: { title: string; href: string; whenLabel: string; registrationOpen: boolean; matching: boolean; inviteOnly: boolean };
  members: TeamManagerMember[];
  pendingRequests: TeamManagerRequest[];
  /** Null when the list is not available (no matching, team full or rejected). */
  seekers: TeamManagerSeeker[] | null;
};

type Feedback = { tone: "success" | "danger"; message: string } | null;
type Confirm =
  | { kind: "remove"; member: TeamManagerMember }
  | { kind: "transfer"; member: TeamManagerMember }
  | { kind: "rotateJoin" }
  | { kind: "rotateManage" }
  | { kind: "disband" }
  | null;

function teamStatus(status: TeamManagerProps["team"]["status"]): { label: string; tone: ChipTone } {
  switch (status) {
    case "CONFIRMED":
      return { label: "Confirmed", tone: "success" };
    case "WAITLISTED":
      return { label: "Waitlisted", tone: "warning" };
    case "PENDING_APPROVAL":
      return { label: "Waiting for approval", tone: "warning" };
    case "REJECTED":
      return { label: "Declined", tone: "danger" };
  }
}

/** Copy-time only: without a configured base URL, fall back to this browser's origin. */
function absolute(baseUrl: string, path: string) {
  return `${baseUrl || window.location.origin}${path}`;
}

/**
 * The leader's team page. Every button calls a Server Action that re-checks
 * the management capability under the event lock; nothing here decides
 * permissions. Member rows carry names only.
 */
export function TeamManager(props: TeamManagerProps) {
  const { teamRef, tokenPage, baseUrl, team, event, members, pendingRequests, seekers } = props;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [finished, setFinished] = useState<{ title: string; body: string; eventPath: string | null } | null>(null);
  const [copied, setCopied] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState(team.name);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [memberName, setMemberName] = useState("");
  const [memberEmail, setMemberEmail] = useState("");
  const [memberErrors, setMemberErrors] = useState<Record<string, string[]>>({});
  const [invited, setInvited] = useState<Set<string>>(() => new Set());
  const [busyId, setBusyId] = useState<string | null>(null);

  const status = teamStatus(team.status);
  const full = team.maxSize != null && team.size >= team.maxSize;
  const rejected = team.status === "REJECTED";
  const canAdd = event.registrationOpen && !full && !rejected && !event.inviteOnly;
  const incomingRequests = pendingRequests.filter((request) => request.direction === "REQUEST");
  const sentInvites = pendingRequests.filter((request) => request.direction === "INVITE");

  function run(id: string | null, task: () => Promise<void>) {
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

  async function copyJoinLink() {
    try {
      await navigator.clipboard.writeText(absolute(baseUrl, team.joinPath));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setFeedback({ tone: "danger", message: "Couldn't copy the link. Select it and copy it instead." });
    }
  }

  function closeConfirm() {
    if (pending) return;
    setConfirm(null);
    setConfirmError(null);
  }

  function confirmAction() {
    if (!confirm) return;
    setConfirmError(null);
    const current = confirm;
    run(null, async () => {
      if (current.kind === "remove") {
        const res = await removeTeamMemberAction(teamRef, current.member.rsvpId);
        if (!res.ok) return setConfirmError(res.error);
        setFeedback({ tone: "success", message: `${current.member.name} was removed from the team.` });
      } else if (current.kind === "transfer") {
        const res = await transferTeamLeadershipAction(teamRef, current.member.rsvpId);
        if (!res.ok) return setConfirmError(res.error);
        setConfirm(null);
        setFinished({
          title: "Leadership handed over",
          body: `${current.member.name} now leads ${team.name} and has been emailed the team link. This page no longer manages the team.`,
          eventPath: event.href,
        });
        return;
      } else if (current.kind === "rotateJoin") {
        const res = await regenerateTeamJoinLinkAction(teamRef);
        if (!res.ok) return setConfirmError(res.error);
        setFeedback({ tone: "success", message: "New join link created. The old link no longer works." });
      } else if (current.kind === "rotateManage") {
        const res = await regenerateTeamManageLinkAction(teamRef);
        if (!res.ok) return setConfirmError(res.error);
        setConfirm(null);
        // The old address is dead now: move to the new one and keep it out of history.
        if (res.data) router.replace(res.data.managePath);
        return;
      } else if (current.kind === "disband") {
        const res = await disbandTeamAction(teamRef);
        if (!res.ok) return setConfirmError(res.error);
        setConfirm(null);
        setFinished({
          title: "Team disbanded",
          body: "Every registration in the team was cancelled. Members can register again on their own or join another team.",
          eventPath: res.data?.eventPath ?? null,
        });
        return;
      }
      setConfirm(null);
      router.refresh();
    });
  }

  function submitRename(e: FormEvent) {
    e.preventDefault();
    setRenameError(null);
    run(null, async () => {
      const res = await renameTeamAction(teamRef, { name: renameValue });
      if (!res.ok) {
        setRenameError(res.fieldErrors?.name?.[0] ?? res.error);
        return;
      }
      setRenameOpen(false);
      setFeedback({ tone: "success", message: "Team renamed." });
      router.refresh();
    });
  }

  function submitMember(e: FormEvent) {
    e.preventDefault();
    setMemberErrors({});
    run("add-member", async () => {
      const res = await addTeamMemberAction(teamRef, { name: memberName, email: memberEmail });
      if (!res.ok) {
        setMemberErrors(res.fieldErrors ?? {});
        if (!res.fieldErrors) setFeedback({ tone: "danger", message: res.error });
        return;
      }
      setFeedback({ tone: "success", message: `${memberName.trim()} was added. They'll get their own ticket by email.` });
      setMemberName("");
      setMemberEmail("");
      router.refresh();
    });
  }

  function toggleLooking(looking: boolean) {
    run("looking", async () => {
      const res = await setTeamLookingForMembersAction(teamRef, looking);
      if (!res.ok) return setFeedback({ tone: "danger", message: res.error });
      router.refresh();
    });
  }

  function respond(requestId: string, accept: boolean) {
    run(requestId, async () => {
      const res = await respondToTeamRequestAction(teamRef, requestId, accept);
      if (!res.ok) return setFeedback({ tone: "danger", message: res.error });
      setFeedback({ tone: "success", message: accept ? "Request accepted. They're now in your team." : "Request declined." });
      router.refresh();
    });
  }

  function withdrawInvite(requestId: string) {
    run(requestId, async () => {
      const res = await cancelTeamInviteAction(teamRef, requestId);
      if (!res.ok) return setFeedback({ tone: "danger", message: res.error });
      router.refresh();
    });
  }

  function invite(seeker: TeamManagerSeeker) {
    run(seeker.id, async () => {
      const res = await inviteSeekerAction(teamRef, seeker.id);
      if (!res.ok) return setFeedback({ tone: "danger", message: res.error });
      setInvited((current) => new Set(current).add(seeker.id));
      setFeedback({ tone: "success", message: `Invitation sent to ${seeker.displayName}. They can accept it from their ticket page.` });
      router.refresh();
    });
  }

  if (finished) {
    return (
      <EmptyState
        mood="done"
        title={finished.title}
        action={finished.eventPath ? <Button asChild variant="secondary"><Link href={finished.eventPath}>Event page</Link></Button> : undefined}
      >
        {finished.body}
      </EmptyState>
    );
  }

  const confirmCopy: Record<NonNullable<Confirm>["kind"], { title: string; message: string; label: string; destructive: boolean }> = {
    remove: {
      title: confirm?.kind === "remove" ? `Remove ${confirm.member.name}?` : "Remove member?",
      message: "Their registration for this event is cancelled. They can register again on their own or join another team.",
      label: "Remove",
      destructive: true,
    },
    transfer: {
      title: confirm?.kind === "transfer" ? `Make ${confirm.member.name} the leader?` : "Transfer leadership?",
      message: "They get a new team link by email and this page stops working for you. You stay in the team as a member.",
      label: "Transfer leadership",
      destructive: false,
    },
    rotateJoin: {
      title: "Create a new join link?",
      message: "The current join link stops working straight away. Share the new one with anyone who still needs to join.",
      label: "Create new link",
      destructive: false,
    },
    rotateManage: {
      title: "Reset the team management link?",
      message: "The link you used to open this page stops working, including the one in your email. You'll move to the new address; bookmark it.",
      label: "Reset link",
      destructive: false,
    },
    disband: {
      title: `Disband ${team.name}?`,
      message: `This cancels the registration of all ${team.size} ${team.size === 1 ? "member" : "members"} and deletes the team. This can't be undone.`,
      label: "Disband team",
      destructive: true,
    },
  };
  const confirmText = confirm ? confirmCopy[confirm.kind] : null;

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-3">
        <Link href={event.href} className="text-sm font-semibold text-ink-secondary hover:text-ink">
          {event.title}
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-overline text-ink-muted">Your team</p>
            <h1 className="break-words font-display text-[30px] font-extrabold leading-tight tracking-[-0.02em] text-ink sm:text-[38px]">{team.name}</h1>
            <p className="mt-1 text-body-ui text-ink-muted">{event.whenLabel}</p>
          </div>
          <Button variant="secondary" size="sm" onClick={() => { setRenameValue(team.name); setRenameError(null); setRenameOpen(true); }}>
            Rename
          </Button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Chip tone={status.tone} icon={team.status === "CONFIRMED" ? <Check /> : undefined}>{status.label}</Chip>
          <Chip tone="neutral" icon={<Users />}>
            {team.maxSize != null ? `${team.size} of ${team.maxSize} members` : `${team.size} ${team.size === 1 ? "member" : "members"}`}
          </Chip>
          {team.incomplete ? <Chip tone="warning">Incomplete</Chip> : null}
        </div>
      </header>

      {team.incomplete && team.minSize != null ? (
        <Callout tone="warning">
          Teams need at least {team.minSize} members. The organisers can&apos;t approve your team until it has {team.minSize}.
        </Callout>
      ) : null}
      {rejected ? <Callout tone="danger">The organisers declined this team, so it can&apos;t take new members.</Callout> : null}

      {feedback ? (
        <Callout tone={feedback.tone} role={feedback.tone === "danger" ? "alert" : "status"}>{feedback.message}</Callout>
      ) : null}

      {!rejected ? (
        <Card as="section" aria-labelledby="team-join-link">
          <CardHeader
            title={<span id="team-join-link">Join link</span>}
            description="Anyone with this link can register straight into your team. It shows the team name and size, never who is in it."
          />
          <ReadOnlyValue
            value={<span className="font-mono text-sm">{`${baseUrl}${team.joinPath}`}</span>}
            action={
              <Button variant="quiet" size="sm" onClick={copyJoinLink} aria-live="polite">
                {copied ? <Check aria-hidden className="size-4" /> : <Copy aria-hidden className="size-4" />}
                {copied ? "Copied" : "Copy"}
              </Button>
            }
          />
          <div className="mt-3">
            <Button variant="quiet" size="sm" onClick={() => setConfirm({ kind: "rotateJoin" })}>
              <RefreshCw aria-hidden className="size-4" />
              Create a new link…
            </Button>
          </div>
        </Card>
      ) : null}

      <Card as="section" aria-labelledby="team-members">
        <CardHeader title={<span id="team-members">Members</span>} description="Members see each other's names on their tickets." />
        <ul className="flex flex-col divide-y divide-line">
          {members.map((member) => (
            <li key={member.rsvpId} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
              <Avatar name={member.name} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-label text-ink">{member.name}</p>
                <div className="mt-0.5 flex flex-wrap gap-1.5">
                  {member.isLeader ? <Chip tone="ink" size="sm" icon={<Crown />}>Leader</Chip> : null}
                  {member.checkedIn ? <Chip tone="success" size="sm" icon={<Check />}>Checked in</Chip> : null}
                </div>
              </div>
              {member.isLeader ? null : (
                <Menu>
                  <MenuTrigger asChild>
                    <IconButton label={`Actions for ${member.name}`} size="sm">
                      <MoreHorizontal />
                    </IconButton>
                  </MenuTrigger>
                  <MenuContent>
                    <MenuItem icon={<Crown />} onSelect={() => setConfirm({ kind: "transfer", member })}>Make leader…</MenuItem>
                    <MenuItem danger icon={<UserMinus />} disabled={member.checkedIn} onSelect={() => setConfirm({ kind: "remove", member })}>
                      Remove from team…
                    </MenuItem>
                  </MenuContent>
                </Menu>
              )}
            </li>
          ))}
        </ul>

        <div className="mt-5 border-t border-line pt-5">
          <h3 className="text-label text-ink">Add a member</h3>
          {canAdd ? (
            <form onSubmit={submitMember} className="mt-3 flex flex-col gap-3.5" noValidate>
              <p className="text-caption text-ink-muted">We&apos;ll email them their own ticket. They don&apos;t need to fill in the registration form.</p>
              <div className="grid gap-3.5 sm:grid-cols-2">
                <Field label="Name" error={memberErrors.name?.[0]}>
                  <Input value={memberName} onChange={(e) => setMemberName(e.target.value)} autoComplete="off" maxLength={200} required />
                </Field>
                <Field label="Email" error={memberErrors.email?.[0]}>
                  <Input type="email" value={memberEmail} onChange={(e) => setMemberEmail(e.target.value)} autoComplete="off" maxLength={320} required />
                </Field>
              </div>
              <div>
                <Button type="submit" variant="primary" loading={busyId === "add-member"} loadingLabel="Adding…" startIcon={<UserPlus />}>
                  Add member
                </Button>
              </div>
            </form>
          ) : (
            <p className="mt-1 text-body-ui text-ink-muted">
              {rejected
                ? "This team can't take new members."
                : full
                  ? "Your team is full."
                  : !event.registrationOpen
                    ? "Registration for this event is closed, so no one else can be added."
                    : "This event is invite-only. Share your team's join link instead; each person signs in with their invited account to join."}
            </p>
          )}
        </div>
      </Card>

      {event.matching && !rejected ? (
        <Card as="section" aria-labelledby="team-matching">
          <CardHeader title={<span id="team-matching">Find teammates</span>} description="People registered on their own can ask to join teams that are looking for members." />
          <SwitchRow
            label="Looking for members"
            description="Show your team to people looking for a team at this event."
            checked={team.lookingForMembers}
            disabled={pending}
            onCheckedChange={toggleLooking}
          />

          {incomingRequests.length ? (
            <div className="mt-5 border-t border-line pt-5">
              <h3 className="text-label text-ink">Requests to join</h3>
              <ul className="mt-2 flex flex-col divide-y divide-line">
                {incomingRequests.map((request) => (
                  <li key={request.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center">
                    <PersonSummary name={request.displayName} headline={request.headline} skills={request.skills} />
                    <div className="flex shrink-0 gap-2">
                      <Button variant="primary" size="sm" disabled={full} loading={busyId === request.id} onClick={() => respond(request.id, true)}>Accept</Button>
                      <Button variant="secondary" size="sm" disabled={busyId === request.id} onClick={() => respond(request.id, false)}>Decline</Button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {sentInvites.length ? (
            <div className="mt-5 border-t border-line pt-5">
              <h3 className="text-label text-ink">Invitations you sent</h3>
              <ul className="mt-2 flex flex-col divide-y divide-line">
                {sentInvites.map((request) => (
                  <li key={request.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center">
                    <PersonSummary name={request.displayName} headline={request.headline} skills={request.skills} />
                    <Button variant="quiet" size="sm" loading={busyId === request.id} onClick={() => withdrawInvite(request.id)}>Withdraw</Button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="mt-5 border-t border-line pt-5">
            <h3 className="text-label text-ink">Looking for a team</h3>
            {seekers === null ? (
              <p className="mt-1 text-body-ui text-ink-muted">{full ? "Your team is full." : "This list isn't available right now."}</p>
            ) : seekers.length === 0 ? (
              <p className="mt-1 text-body-ui text-ink-muted">No one is looking for a team yet. Check back later.</p>
            ) : (
              <ul className="mt-2 flex flex-col divide-y divide-line">
                {seekers.map((seeker) => (
                  <li key={seeker.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center">
                    <PersonSummary name={seeker.displayName} headline={seeker.headline} skills={seeker.skills} />
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={invited.has(seeker.id)}
                      loading={busyId === seeker.id}
                      onClick={() => invite(seeker)}
                    >
                      {invited.has(seeker.id) ? "Invited" : "Invite"}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      ) : null}

      {tokenPage ? (
        <Card as="section" aria-labelledby="team-manage-link">
          <CardHeader
            title={<span id="team-manage-link">This page&apos;s link</span>}
            description="Anyone with the link to this page can manage your team. If it may have been shared, reset it."
          />
          <Button variant="secondary" size="sm" onClick={() => setConfirm({ kind: "rotateManage" })}>
            <RefreshCw aria-hidden className="size-4" />
            Reset management link…
          </Button>
        </Card>
      ) : null}

      <DangerZone
        title="Disband team"
        description="Cancels everyone's registration and deletes the team."
        action={<Button variant="danger" onClick={() => setConfirm({ kind: "disband" })}>Disband team…</Button>}
      />

      <ConfirmDialog
        open={confirm !== null}
        title={confirmText?.title ?? ""}
        message={confirmText?.message}
        confirmLabel={confirmText?.label}
        destructive={confirmText?.destructive ?? true}
        loading={pending && busyId === null}
        confirmText={confirm?.kind === "disband" ? team.name : undefined}
        onConfirm={confirmAction}
        onCancel={closeConfirm}
      >
        {confirmError ? <Callout tone="danger" role="alert">{confirmError}</Callout> : null}
      </ConfirmDialog>

      <Dialog open={renameOpen} onOpenChange={(open) => !pending && setRenameOpen(open)}>
        <DialogContent size="sm">
          <form onSubmit={submitRename} noValidate>
            <DialogHeader title="Rename team" description="Team names are unique for this event." />
            <DialogBody>
              <Field label="Team name" error={renameError ?? undefined}>
                <Input value={renameValue} onChange={(e) => setRenameValue(e.target.value)} maxLength={60} autoComplete="off" autoFocus required />
              </Field>
            </DialogBody>
            <DialogFooter>
              <Button variant="secondary" onClick={() => setRenameOpen(false)} disabled={pending}>Cancel</Button>
              <Button type="submit" variant="primary" loading={pending} loadingLabel="Saving…">Save</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PersonSummary({ name, headline, skills }: { name: string; headline: string | null; skills: string[] }) {
  return (
    <div className="flex min-w-0 flex-1 items-start gap-3">
      <Avatar name={name} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-label text-ink">{name}</p>
        {headline ? <p className="break-words text-sm text-ink-secondary">{headline}</p> : null}
        {skills.length ? (
          <ul className="mt-1.5 flex flex-wrap gap-1.5" aria-label="Skills">
            {skills.map((skill) => (
              <li key={skill}><Chip tone="outline" size="sm">{skill}</Chip></li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
