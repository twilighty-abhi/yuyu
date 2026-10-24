"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2, Trophy, X } from "lucide-react";
import {
  addEventAward,
  editEventAward,
  removeEventAward,
  removeEventAwardWinner,
  reorderEventAwards,
  setEventAwardWinner,
} from "@/app/actions/judging-admin";
import { ConfirmationDialog } from "@/components/feedback/ConfirmationDialog";
import { Button, IconButton } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Callout, Card, CardHeader, EmptyState } from "@/components/ui/display";
import { Dropdown, Field, Input, Textarea } from "@/components/ui/field";
import type { JudgingDashboardAward, JudgingDashboardResultRow } from "@/lib/eventDashboard/judging";
import { fieldError, formatScore, useJudgingAction, type JudgingLimits, type JudgingScope } from "./JudgingPanelShared";

type AwardDraft = { id: string | null; name: string; description: string };

/**
 * Judging → Awards: name the awards and pick winners, guided by the ranked
 * score table. Only submitted (not disqualified) projects can win; the server
 * checks that again and keeps one project per place.
 */
export function JudgingPanelAwards({
  scope,
  awards,
  ranking,
  resultsPublished,
  limits,
}: {
  scope: JudgingScope;
  awards: JudgingDashboardAward[];
  ranking: JudgingDashboardResultRow[];
  resultsPublished: boolean;
  limits: JudgingLimits;
}) {
  const { run, busy, pending } = useJudgingAction();
  const [draft, setDraft] = useState<AwardDraft | null>(null);
  const [errors, setErrors] = useState<Record<string, string[]> | undefined>();
  const [deleting, setDeleting] = useState<JudgingDashboardAward | null>(null);
  const [pickingFor, setPickingFor] = useState<string | null>(null);
  const picking = pickingFor ? awards.find((award) => award.id === pickingFor) ?? null : null;
  const eligible = ranking.filter((row) => row.status === "SUBMITTED");

  function save() {
    if (!draft) return;
    const award = { name: draft.name, description: draft.description };
    run(
      "save",
      () => (draft.id ? editEventAward({ ...scope, awardId: draft.id, award }) : addEventAward({ ...scope, award })),
      draft.id ? "Award updated." : "Award added.",
      (result) => {
        if (result.ok) setDraft(null);
        else setErrors(result.fieldErrors);
      },
    );
  }

  function move(index: number, offset: -1 | 1) {
    const ids = awards.map((award) => award.id);
    const target = index + offset;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    run(`move-${awards[index]!.id}`, () => reorderEventAwards({ ...scope, ids }), null);
  }

  return (
    <Card as="section">
      <CardHeader
        title="Awards"
        description="Add awards such as Overall winner or Best design, then pick winners from the ranked projects."
        action={
          <Button
            variant="secondary"
            size="sm"
            startIcon={<Plus />}
            disabled={awards.length >= limits.awards}
            onClick={() => {
              setErrors(undefined);
              setDraft({ id: null, name: "", description: "" });
            }}
          >
            Add award
          </Button>
        }
      />
      {resultsPublished ? <Callout tone="info" className="mb-4">Results are published, so changes here show on the results page straight away.</Callout> : null}
      {awards.length === 0 ? (
        <EmptyState title="No awards yet" icon={<Trophy />}>
          Add at least one award before you publish results.
        </EmptyState>
      ) : (
        <ol className="flex flex-col gap-3">
          {awards.map((award, index) => (
            <li key={award.id} className="rounded-lg border border-line p-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-4">
                <div className="min-w-0 flex-1">
                  <p className="text-label text-ink">{award.name}</p>
                  {award.description ? <p className="whitespace-pre-line text-caption text-ink-muted">{award.description}</p> : null}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <IconButton label={`Move ${award.name} up`} size="sm" disabled={index === 0 || pending} onClick={() => move(index, -1)}>
                    <ArrowUp />
                  </IconButton>
                  <IconButton label={`Move ${award.name} down`} size="sm" disabled={index === awards.length - 1 || pending} onClick={() => move(index, 1)}>
                    <ArrowDown />
                  </IconButton>
                  <IconButton
                    label={`Edit ${award.name}`}
                    size="sm"
                    disabled={pending}
                    onClick={() => {
                      setErrors(undefined);
                      setDraft({ id: award.id, name: award.name, description: award.description });
                    }}
                  >
                    <Pencil />
                  </IconButton>
                  <IconButton label={`Delete ${award.name}`} size="sm" disabled={pending} onClick={() => setDeleting(award)}>
                    <Trash2 />
                  </IconButton>
                </div>
              </div>
              <div className="mt-3 flex flex-col gap-2">
                {award.winners.length === 0 ? <p className="text-caption text-ink-muted">No winner picked yet.</p> : null}
                {award.winners.map((winner) => (
                  <div key={winner.place} className="flex items-center gap-3 rounded-md bg-subtle px-3 py-2">
                    <span className="w-14 shrink-0 text-caption font-semibold text-ink-secondary">{placeLabel(winner.place)}</span>
                    <span className="min-w-0 flex-1 text-body-ui">
                      <span className="font-semibold text-ink">{winner.title}</span>
                      <span className="text-ink-muted"> · {winner.entrantName}</span>
                    </span>
                    <IconButton
                      label={`Remove ${winner.title} from ${award.name}`}
                      size="sm"
                      disabled={pending}
                      onClick={() => run(`winner-${award.id}-${winner.place}`, () => removeEventAwardWinner({ ...scope, awardId: award.id, place: winner.place }), "Winner removed.")}
                    >
                      <X />
                    </IconButton>
                  </div>
                ))}
                <div>
                  <Button variant="quiet" size="sm" startIcon={<Plus />} disabled={eligible.length === 0 || pending} onClick={() => setPickingFor(award.id)}>
                    Pick a winner
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}

      <Dialog open={draft !== null} onOpenChange={(next) => (!next && busy !== "save" ? setDraft(null) : undefined)}>
        <DialogContent size="sm">
          <DialogHeader title={draft?.id ? "Edit award" : "Add award"} />
          <form
            onSubmit={(event) => {
              event.preventDefault();
              save();
            }}
          >
            <DialogBody className="flex flex-col gap-3.5">
              <Field label="Name" error={fieldError(errors, "name")}>
                <Input value={draft?.name ?? ""} maxLength={limits.awardName} required placeholder="Overall winner" onChange={(event) => setDraft((current) => (current ? { ...current, name: event.target.value } : current))} />
              </Field>
              <Field label="Description" optional error={fieldError(errors, "description")}>
                <Textarea rows={3} value={draft?.description ?? ""} maxLength={limits.description} onChange={(event) => setDraft((current) => (current ? { ...current, description: event.target.value } : current))} />
              </Field>
            </DialogBody>
            <DialogFooter>
              <Button variant="secondary" disabled={busy === "save"} onClick={() => setDraft(null)}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" loading={busy === "save"} loadingLabel="Saving…">
                {draft?.id ? "Save award" : "Add award"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <WinnerPicker scope={scope} award={picking} eligible={eligible} maxPlace={limits.awardPlace} onClose={() => setPickingFor(null)} />

      <ConfirmationDialog
        open={deleting !== null}
        title="Delete this award?"
        message={`"${deleting?.name ?? ""}" and its winners will be removed${resultsPublished ? " from the results page" : ""}.`}
        confirmLabel="Delete award"
        loading={busy === "delete"}
        onConfirm={() => deleting && run("delete", () => removeEventAward({ ...scope, awardId: deleting.id }), "Award deleted.", () => setDeleting(null))}
        onCancel={() => setDeleting(null)}
      />
    </Card>
  );
}

function placeLabel(place: number) {
  const suffix = place % 100 >= 11 && place % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[place % 10] ?? "th";
  return `${place}${suffix}`;
}

function WinnerPicker({
  scope,
  award,
  eligible,
  maxPlace,
  onClose,
}: {
  scope: JudgingScope;
  award: JudgingDashboardAward | null;
  eligible: JudgingDashboardResultRow[];
  maxPlace: number;
  onClose: () => void;
}) {
  const { run, busy } = useJudgingAction();
  const taken = new Set(award?.winners.map((winner) => winner.place) ?? []);
  const firstFree = Array.from({ length: maxPlace }, (_, index) => index + 1).find((place) => !taken.has(place)) ?? 1;
  const [state, setState] = useState<{ awardId: string | null; place: string; submissionId: string }>({ awardId: null, place: "1", submissionId: "" });
  // Reset the picker for each award it opens on (adjusting state during render).
  if (award && state.awardId !== award.id) {
    const winnerIds = new Set(award.winners.map((winner) => winner.submissionId));
    setState({ awardId: award.id, place: String(firstFree), submissionId: eligible.find((row) => !winnerIds.has(row.submissionId))?.submissionId ?? eligible[0]?.submissionId ?? "" });
  }
  if (!award && state.awardId !== null) setState({ awardId: null, place: "1", submissionId: "" });

  const placeCount = Math.min(maxPlace, Math.max(3, Math.max(0, ...taken) + 1));
  const placeHolder = award?.winners.find((winner) => String(winner.place) === state.place);
  return (
    <Dialog open={award !== null} onOpenChange={(next) => (!next && busy === null ? onClose() : undefined)}>
      <DialogContent size="sm">
        <DialogHeader title="Pick a winner" description={award ? `For ${award.name}. Projects are listed by rank.` : undefined} />
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!award || !state.submissionId) return;
            run("pick", () => setEventAwardWinner({ ...scope, awardId: award.id, submissionId: state.submissionId, place: state.place }), "Winner saved.", (result) => {
              if (result.ok) onClose();
            });
          }}
        >
          <DialogBody className="flex flex-col gap-3.5">
            <Field label="Project">
              <Dropdown value={state.submissionId} onChange={(event) => setState((current) => ({ ...current, submissionId: event.target.value }))}>
                {eligible.map((row) => (
                  <option key={row.submissionId} value={row.submissionId}>
                    {row.rank ? `#${row.rank} · ${formatScore(row.score)}` : "Unranked"} · {row.title} ({row.entrantName})
                  </option>
                ))}
              </Dropdown>
            </Field>
            <Field
              label="Place"
              helperText={placeHolder ? `Replaces ${placeHolder.title} in this place.` : "If this project already holds another place in this award, it moves here."}
            >
              <Dropdown value={state.place} onChange={(event) => setState((current) => ({ ...current, place: event.target.value }))}>
                {Array.from({ length: placeCount }, (_, index) => index + 1).map((place) => (
                  <option key={place} value={String(place)}>
                    {placeLabel(place)}
                    {taken.has(place) ? " (taken)" : ""}
                  </option>
                ))}
              </Dropdown>
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button variant="secondary" disabled={busy !== null} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={!state.submissionId} loading={busy === "pick"} loadingLabel="Saving…">
              Save winner
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
