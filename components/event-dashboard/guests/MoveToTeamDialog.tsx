"use client";

import { useState, useTransition } from "react";
import type { RsvpStatus } from "@prisma/client";
import { ArrowRightLeft } from "lucide-react";
import { moveTeamMember } from "@/app/actions/team-admin";
import { useToast } from "@/components/feedback/ToastProvider";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Callout } from "@/components/ui/display";
import { Dropdown, Field } from "@/components/ui/field";
import { moveOutcome, moveTargets } from "./teamList";

export type MoveTargetTeam = { id: string; name: string; status: RsvpStatus; size: number; maxSize: number | null };

/**
 * Move one registration (solo, or from another team) into a team of the same
 * event. Size, status and the event lock are all handled on the server.
 */
export function MoveToTeamDialog({
  organisationSlug,
  eventId,
  person,
  teams,
  onClose,
  onMoved,
}: {
  organisationSlug: string;
  eventId: string;
  person: { rsvpId: string; name: string; teamId: string | null };
  teams: MoveTargetTeam[];
  onClose: () => void;
  onMoved: () => void;
}) {
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  const targets = moveTargets(teams, person.teamId);
  const [targetId, setTargetId] = useState(targets[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const target = targets.find((team) => team.id === targetId) ?? null;

  return (
    <Dialog open onOpenChange={(next) => { if (!next && !pending) onClose(); }}>
      <DialogContent size="sm">
        <form
          className="flex min-h-0 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            if (!target) return;
            setError(null);
            startTransition(async () => {
              const result = await moveTeamMember({ organisationSlug, eventId, rsvpId: person.rsvpId, targetTeamId: target.id });
              if (!result.ok) {
                setError(result.error);
                return;
              }
              showToast(`${person.name} moved to ${target.name}`, "success");
              onMoved();
              onClose();
            });
          }}
        >
          <DialogHeader title={`Move ${person.name}`} description="Choose the team they should join. Only teams with room are listed." />
          <DialogBody className="flex flex-col gap-4">
            {error ? <Callout tone="danger" role="alert">{error}</Callout> : null}
            {targets.length === 0 ? (
              <p className="text-body-ui text-ink-muted">No other team has room right now.</p>
            ) : (
              <Field label="Team" helperText={target ? moveOutcome(target.status) : undefined}>
                <Dropdown value={targetId} onChange={(event) => setTargetId(event.target.value)}>
                  {targets.map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.name} ({team.size}{team.maxSize != null ? ` of ${team.maxSize}` : ""})
                    </option>
                  ))}
                </Dropdown>
              </Field>
            )}
          </DialogBody>
          <DialogFooter>
            <Button variant="secondary" onClick={onClose} disabled={pending}>Cancel</Button>
            <Button type="submit" variant="primary" startIcon={<ArrowRightLeft />} loading={pending} disabled={!target}>
              Move
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
