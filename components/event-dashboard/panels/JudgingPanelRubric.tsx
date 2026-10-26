"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from "lucide-react";
import { addJudgingCriterion, editJudgingCriterion, removeJudgingCriterion, reorderJudgingCriteria } from "@/app/actions/judging-admin";
import { ConfirmationDialog } from "@/components/feedback/ConfirmationDialog";
import { Button, IconButton } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Callout, Card, CardHeader, EmptyState } from "@/components/ui/display";
import { Field, Input, Textarea } from "@/components/ui/field";
import type { JudgingDashboardCriterion } from "@/lib/eventDashboard/judging";
import { fieldError, useJudgingAction, type JudgingLimits, type JudgingScope } from "./JudgingPanelShared";

type Draft = { id: string | null; name: string; description: string; weight: string; maxScore: string };

const EMPTY: Draft = { id: null, name: "", description: "", weight: "1", maxScore: "10" };

/**
 * Judging → Rubric. Criteria can only change while judging has not started;
 * the server refuses every rubric write afterwards, so the controls here are
 * disabled to match.
 */
export function JudgingPanelRubric({ scope, criteria, frozen, limits }: { scope: JudgingScope; criteria: JudgingDashboardCriterion[]; frozen: boolean; limits: JudgingLimits }) {
  const { run, busy, pending } = useJudgingAction();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [errors, setErrors] = useState<Record<string, string[]> | undefined>();
  const [deleting, setDeleting] = useState<JudgingDashboardCriterion | null>(null);
  const totalWeight = criteria.reduce((sum, criterion) => sum + criterion.weight, 0);
  const atLimit = criteria.length >= limits.criteria;

  function open(next: Draft) {
    setErrors(undefined);
    setDraft(next);
  }

  function save() {
    if (!draft) return;
    const criterion = { name: draft.name, description: draft.description, weight: draft.weight, maxScore: draft.maxScore };
    run(
      "save",
      () => (draft.id ? editJudgingCriterion({ ...scope, criterionId: draft.id, criterion }) : addJudgingCriterion({ ...scope, criterion })),
      draft.id ? "Criterion updated." : "Criterion added.",
      (result) => {
        if (result.ok) setDraft(null);
        else setErrors(result.fieldErrors);
      },
    );
  }

  function move(index: number, offset: -1 | 1) {
    const ids = criteria.map((criterion) => criterion.id);
    const target = index + offset;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    run(`move-${criteria[index]!.id}`, () => reorderJudgingCriteria({ ...scope, ids }), null);
  }

  return (
    <Card as="section">
      <CardHeader
        title="Rubric"
        description="Judges score each criterion from 0 to its maximum. A project's result is the weighted percentage, averaged over judges who submitted a review."
        action={
          frozen ? null : (
            <Button variant="secondary" size="sm" startIcon={<Plus />} disabled={atLimit} onClick={() => open(EMPTY)}>
              Add criterion
            </Button>
          )
        }
      />
      {frozen ? <Callout tone="info" className="mb-4">The rubric is locked because judging has started.</Callout> : null}
      {criteria.length === 0 ? (
        <EmptyState title="No criteria yet">Add criteria such as Impact, Technical execution and Design before you open judging.</EmptyState>
      ) : (
        <ol className="flex flex-col divide-y divide-line rounded-lg border border-line">
          {criteria.map((criterion, index) => (
            <li key={criterion.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
              <div className="min-w-0 flex-1">
                <p className="text-label text-ink">{criterion.name}</p>
                {criterion.description ? <p className="whitespace-pre-line text-caption text-ink-muted">{criterion.description}</p> : null}
              </div>
              <p className="shrink-0 text-caption text-ink-muted">
                Out of {criterion.maxScore} · weight {criterion.weight}
                {totalWeight > 0 ? ` (${Math.round((criterion.weight / totalWeight) * 100)}%)` : ""}
              </p>
              {frozen ? null : (
                <div className="flex shrink-0 items-center gap-1">
                  <IconButton label={`Move ${criterion.name} up`} size="sm" disabled={index === 0 || pending} onClick={() => move(index, -1)}>
                    <ArrowUp />
                  </IconButton>
                  <IconButton label={`Move ${criterion.name} down`} size="sm" disabled={index === criteria.length - 1 || pending} onClick={() => move(index, 1)}>
                    <ArrowDown />
                  </IconButton>
                  <IconButton
                    label={`Edit ${criterion.name}`}
                    size="sm"
                    disabled={pending}
                    onClick={() => open({ id: criterion.id, name: criterion.name, description: criterion.description, weight: String(criterion.weight), maxScore: String(criterion.maxScore) })}
                  >
                    <Pencil />
                  </IconButton>
                  <IconButton label={`Delete ${criterion.name}`} size="sm" disabled={pending} onClick={() => setDeleting(criterion)}>
                    <Trash2 />
                  </IconButton>
                </div>
              )}
            </li>
          ))}
        </ol>
      )}

      <Dialog open={draft !== null} onOpenChange={(next) => (!next && busy !== "save" ? setDraft(null) : undefined)}>
        <DialogContent size="sm">
          <DialogHeader title={draft?.id ? "Edit criterion" : "Add criterion"} />
          <form
            onSubmit={(event) => {
              event.preventDefault();
              save();
            }}
          >
            <DialogBody className="flex flex-col gap-3.5">
              <Field label="Name" error={fieldError(errors, "name")}>
                <Input value={draft?.name ?? ""} maxLength={limits.criterionName} required onChange={(event) => setDraft((current) => (current ? { ...current, name: event.target.value } : current))} />
              </Field>
              <Field label="What judges look for" optional error={fieldError(errors, "description")}>
                <Textarea rows={3} value={draft?.description ?? ""} maxLength={limits.description} onChange={(event) => setDraft((current) => (current ? { ...current, description: event.target.value } : current))} />
              </Field>
              <div className="grid grid-cols-2 gap-3.5">
                <Field label="Weight" helperText={`1 to ${limits.weight}`} error={fieldError(errors, "weight")}>
                  <Input type="number" inputMode="numeric" min={1} max={limits.weight} step={1} required value={draft?.weight ?? ""} onChange={(event) => setDraft((current) => (current ? { ...current, weight: event.target.value } : current))} />
                </Field>
                <Field label="Maximum score" helperText={`1 to ${limits.maxScore}`} error={fieldError(errors, "maxScore")}>
                  <Input type="number" inputMode="numeric" min={1} max={limits.maxScore} step={1} required value={draft?.maxScore ?? ""} onChange={(event) => setDraft((current) => (current ? { ...current, maxScore: event.target.value } : current))} />
                </Field>
              </div>
            </DialogBody>
            <DialogFooter>
              <Button variant="secondary" disabled={busy === "save"} onClick={() => setDraft(null)}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" loading={busy === "save"} loadingLabel="Saving…">
                {draft?.id ? "Save criterion" : "Add criterion"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmationDialog
        open={deleting !== null}
        title="Delete this criterion?"
        message={`"${deleting?.name ?? ""}" will be removed from the rubric.`}
        confirmLabel="Delete criterion"
        loading={busy === "delete"}
        onConfirm={() => deleting && run("delete", () => removeJudgingCriterion({ ...scope, criterionId: deleting.id }), "Criterion deleted.", () => setDeleting(null))}
        onCancel={() => setDeleting(null)}
      />
    </Card>
  );
}
