"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { applyJudgeAutoAssignment, previewJudgeAutoAssignment } from "@/app/actions/judging-ops";
import { useToast } from "@/components/feedback/ToastProvider";
import { Button } from "@/components/ui/button";
import { CheckboxField, Radio, RadioGroup } from "@/components/ui/choice";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Callout } from "@/components/ui/display";
import { Field, Input } from "@/components/ui/field";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { REVIEWS_PER_PROJECT_MAX, REVIEWS_PER_PROJECT_MIN, type AutoAssignMode } from "@/lib/judgingProgress";
import type { AutoAssignPreviewDto } from "@/lib/core/judgingOps";
import type { EligibleJudgeDto } from "@/lib/core/judging";
import type { JudgingScope } from "./JudgingPanelShared";
import { AUTO_ASSIGN_MODE_COPY, autoAssignPreviewHeadline, SEE_ALL_SWITCH_WARNING } from "./judgingOpsCopy";

/**
 * Assign judges automatically (docs/HACKATHON.md): pick the judges per
 * project, keep or replace current assignments, and the pool (invited judges
 * are in by default; organisers only when ticked). Preview shows every
 * judge's load before and after and the projects that can't reach the
 * target; Apply re-plans on the server under the event lock and refuses if
 * anything changed since the preview.
 */
export function AutoAssignDialog({
  open,
  onOpenChange,
  scope,
  judges,
  defaultPerProject,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scope: JudgingScope;
  judges: EligibleJudgeDto[];
  defaultPerProject: number;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        {/* Remounted on every open, so the form starts from the current defaults. */}
        {open ? <AutoAssignForm scope={scope} judges={judges} defaultPerProject={defaultPerProject} onDone={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function AutoAssignForm({
  scope,
  judges,
  defaultPerProject,
  onDone,
}: {
  scope: JudgingScope;
  judges: EligibleJudgeDto[];
  defaultPerProject: number;
  onDone: () => void;
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const invited = judges.filter((judge) => judge.kind === "judge");
  const organisers = judges.filter((judge) => judge.kind === "admin");
  const [perProject, setPerProject] = useState(String(defaultPerProject));
  const [mode, setMode] = useState<AutoAssignMode>("keep");
  const [pool, setPool] = useState<Set<string>>(() => new Set(invited.map((judge) => judge.userId)));
  const [preview, setPreview] = useState<AutoAssignPreviewDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]> | undefined>();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<"preview" | "apply" | null>(null);

  const options = () => ({ perProject: perProject.trim(), mode, judgeUserIds: [...pool] });
  const changed = () => {
    setPreview(null);
    setError(null);
  };
  const toggle = (userId: string, on: boolean) => {
    setPool((current) => {
      const next = new Set(current);
      if (on) next.add(userId);
      else next.delete(userId);
      return next;
    });
    changed();
  };

  function runPreview() {
    setBusy("preview");
    setError(null);
    setFieldErrors(undefined);
    startTransition(async () => {
      try {
        const res = await previewJudgeAutoAssignment({ ...scope, options: options() });
        if (!res.ok || !res.data) {
          setError(res.ok ? "Couldn't preview the assignment. Try again." : res.error);
          if (!res.ok) setFieldErrors(res.fieldErrors);
          setPreview(null);
        } else setPreview(res.data);
      } catch {
        setError("Couldn't preview the assignment. Try again.");
      }
      setBusy(null);
    });
  }

  function runApply() {
    if (!preview) return;
    setBusy("apply");
    setError(null);
    startTransition(async () => {
      try {
        const res = await applyJudgeAutoAssignment({ ...scope, options: { ...options(), fingerprint: preview.fingerprint } });
        if (!res.ok || !res.data) {
          setError(res.ok ? "Couldn't apply the assignment. Try again." : res.error);
          setPreview(null);
        } else {
          showToast(
            `Judges assigned: ${res.data.added} added${res.data.removed ? `, ${res.data.removed} removed` : ""}${res.data.adopted ? `, ${res.data.adopted} started kept` : ""}.`,
            "success",
          );
          router.refresh();
          onDone();
        }
      } catch {
        setError("Couldn't apply the assignment. Try again.");
      }
      setBusy(null);
    });
  }

  const perProjectError = fieldErrors?.perProject?.[0];
  const poolError = fieldErrors?.judgeUserIds?.[0];
  return (
    <>
      <DialogHeader
        title="Assign judges automatically"
        description="Shares submitted projects out so each gets the same number of judges, keeping everyone's load even. Nobody is given a project they're registered on."
      />
      <DialogBody className="flex flex-col gap-5">
        <Field label="Judges per project" error={perProjectError} helperText={`Between ${REVIEWS_PER_PROJECT_MIN} and ${REVIEWS_PER_PROJECT_MAX}. Applying also makes this the progress target.`}>
          <Input
            type="number"
            inputMode="numeric"
            min={REVIEWS_PER_PROJECT_MIN}
            max={REVIEWS_PER_PROJECT_MAX}
            step={1}
            value={perProject}
            onChange={(event) => {
              setPerProject(event.target.value);
              changed();
            }}
          />
        </Field>

        <fieldset className="flex flex-col gap-2.5">
          <legend className="mb-2 text-label text-ink">Current assignments</legend>
          <RadioGroup
            value={mode}
            onValueChange={(value) => {
              setMode(value as AutoAssignMode);
              changed();
            }}
            aria-label="Current assignments"
          >
            {(["keep", "replace"] as const).map((value) => (
              <Radio key={value} value={value} label={AUTO_ASSIGN_MODE_COPY[value].label} description={AUTO_ASSIGN_MODE_COPY[value].description} />
            ))}
          </RadioGroup>
        </fieldset>

        <fieldset className="flex flex-col gap-2.5" aria-describedby={poolError ? "auto-assign-pool-error" : undefined}>
          <legend className="mb-2 text-label text-ink">Who judges</legend>
          {invited.length === 0 ? <p className="text-caption text-ink-muted">No invited judges yet. Tick organisers below, or invite judges from Settings.</p> : null}
          {invited.map((judge) => (
            <CheckboxField
              key={judge.userId}
              label={judge.name}
              description={judge.email ?? "Judge"}
              checked={pool.has(judge.userId)}
              onCheckedChange={(checked) => toggle(judge.userId, checked === true)}
            />
          ))}
          {organisers.length > 0 ? (
            <>
              <p className="mt-2 text-caption text-ink-muted">Organisers judge only if you tick them.</p>
              {organisers.map((judge) => (
                <CheckboxField
                  key={judge.userId}
                  label={judge.name}
                  description={`Organiser${judge.email ? ` · ${judge.email}` : ""}`}
                  checked={pool.has(judge.userId)}
                  onCheckedChange={(checked) => toggle(judge.userId, checked === true)}
                />
              ))}
            </>
          ) : null}
          {poolError ? (
            <p id="auto-assign-pool-error" className="text-caption text-danger-fg">
              {poolError}
            </p>
          ) : null}
        </fieldset>

        {error ? (
          <Callout tone="danger" role="alert">
            {error}
          </Callout>
        ) : null}

        {preview ? (
          <section aria-label="Preview" className="flex flex-col gap-3" data-testid="auto-assign-preview">
            <p role="status" className="text-body-ui font-semibold text-ink">
              {autoAssignPreviewHeadline(preview)}
            </p>
            {preview.judgesSeeAll ? <Callout tone="warning">{SEE_ALL_SWITCH_WARNING}</Callout> : null}
            <Table label="Assignments per judge">
              <THead>
                <tr>
                  <TH>Judge</TH>
                  <TH className="text-right">Now</TH>
                  <TH className="text-right">Change</TH>
                  <TH className="text-right">After</TH>
                </tr>
              </THead>
              <TBody>
                {preview.judges.map((judge) => (
                  <TR key={judge.userId}>
                    <TD>
                      <span className="block font-semibold">{judge.name}</span>
                      <span className="block text-caption text-ink-muted">{judge.kind === "admin" ? "Organiser" : "Judge"}</span>
                    </TD>
                    <TD className="text-right tabular-nums">{judge.before}</TD>
                    <TD className="whitespace-nowrap text-right tabular-nums">
                      {judge.added ? `+${judge.added}` : ""}
                      {judge.added && judge.removed ? " " : ""}
                      {judge.removed ? `−${judge.removed}` : ""}
                      {!judge.added && !judge.removed ? "—" : ""}
                    </TD>
                    <TD className="text-right font-semibold tabular-nums">{judge.after}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            {preview.shortfallTotal > 0 ? (
              <div className="flex flex-col gap-2">
                <h3 className="text-label text-ink">Projects short of {preview.perProject} judges</h3>
                <ul className="flex flex-col divide-y divide-line rounded-lg border border-line">
                  {preview.shortfalls.map((row) => (
                    <li key={row.submissionId} className="flex items-center justify-between gap-3 px-4 py-2.5 text-body-ui">
                      <span className="min-w-0">
                        <span className="block truncate font-semibold">{row.title}</span>
                        <span className="block truncate text-caption text-ink-muted">{row.entrantName}</span>
                      </span>
                      <span className="shrink-0 text-caption tabular-nums text-ink-secondary">
                        {row.assigned} of {preview.perProject}
                      </span>
                    </li>
                  ))}
                </ul>
                {preview.shortfallTotal > preview.shortfalls.length ? (
                  <p className="text-caption text-ink-muted">and {preview.shortfallTotal - preview.shortfalls.length} more.</p>
                ) : null}
              </div>
            ) : null}
          </section>
        ) : null}
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
        {preview ? (
          <Button variant="primary" onClick={runApply} loading={busy === "apply"} loadingLabel="Applying…" disabled={pending || preview.projects === 0}>
            Apply assignment
          </Button>
        ) : (
          <Button variant="primary" onClick={runPreview} loading={busy === "preview"} loadingLabel="Previewing…" disabled={pending}>
            Preview
          </Button>
        )}
      </DialogFooter>
    </>
  );
}
