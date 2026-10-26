"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2, Trophy, X } from "lucide-react";
import {
  addEventAward,
  editEventAward,
  removeEventAward,
  removeEventAwardWinner,
  reorderEventAwards,
  searchAwardCandidates,
  setEventAwardWinner,
} from "@/app/actions/judging-admin";
import { ConfirmationDialog } from "@/components/feedback/ConfirmationDialog";
import { Button, IconButton } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Callout, Card, CardHeader, EmptyState } from "@/components/ui/display";
import { Radio, RadioGroup } from "@/components/ui/choice";
import { useLoadMoreFocus } from "@/components/ui/use-load-more-focus";
import { Dropdown, Field, Input, SearchInput, Textarea } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import type { JudgingDashboardAward, JudgingDashboardAwardCandidate } from "@/lib/eventDashboard/judging";
import { fieldError, formatScore, useJudgingAction, type JudgingLimits, type JudgingScope } from "./JudgingPanelShared";

type AwardDraft = { id: string | null; name: string; description: string };

/**
 * Judging → Awards: name the awards and pick winners, guided by the ranked
 * score table. Only submitted (not disqualified) projects can win; the server
 * checks that again and keeps one project per place. The winner picker
 * searches the ranking on the server (`searchAwardCandidates`), top ranks
 * first, a short page at a time.
 */
export function JudgingPanelAwards({
  scope,
  awards,
  submittedCount,
  resultsPublished,
  limits,
}: {
  scope: JudgingScope;
  awards: JudgingDashboardAward[];
  /** SUBMITTED projects (only those can win). */
  submittedCount: number;
  resultsPublished: boolean;
  limits: JudgingLimits;
}) {
  const { run, busy, pending } = useJudgingAction();
  const [draft, setDraft] = useState<AwardDraft | null>(null);
  const [errors, setErrors] = useState<Record<string, string[]> | undefined>();
  const [deleting, setDeleting] = useState<JudgingDashboardAward | null>(null);
  const [pickingFor, setPickingFor] = useState<string | null>(null);
  const picking = pickingFor ? awards.find((award) => award.id === pickingFor) ?? null : null;

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
                  <Button variant="quiet" size="sm" startIcon={<Plus />} disabled={submittedCount === 0 || pending} onClick={() => setPickingFor(award.id)}>
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

      <WinnerPicker scope={scope} award={picking} maxPlace={limits.awardPlace} onClose={() => setPickingFor(null)} />

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

const SEARCH_DELAY_MS = 300;

type CandidateList = { candidates: JudgingDashboardAwardCandidate[]; total: number; nextOffset: number | null };

function candidateLabel(row: JudgingDashboardAwardCandidate) {
  return `${row.rank ? `#${row.rank} · ${formatScore(row.score)}` : "Unranked"} · ${row.title}`;
}

/**
 * Pick a project for one award: a server search over the ranked SUBMITTED
 * projects (top ranks first) with "Show more", then the place.
 */
function WinnerPicker({
  scope,
  award,
  maxPlace,
  onClose,
}: {
  scope: JudgingScope;
  award: JudgingDashboardAward | null;
  maxPlace: number;
  onClose: () => void;
}) {
  const { organisationSlug, eventId } = scope;
  const { run, busy } = useJudgingAction();
  const taken = new Set(award?.winners.map((winner) => winner.place) ?? []);
  const firstFree = Array.from({ length: maxPlace }, (_, index) => index + 1).find((place) => !taken.has(place)) ?? 1;
  const [state, setState] = useState<{ awardId: string | null; place: string; submissionId: string; selectedTitle: string; query: string }>({
    awardId: null,
    place: "1",
    submissionId: "",
    selectedTitle: "",
    query: "",
  });
  const [list, setList] = useState<CandidateList | null>(null);
  const loadMoreFocus = useLoadMoreFocus(list?.candidates.length ?? 0, { focus: "radio" });
  const [loading, setLoading] = useState<"replace" | "more" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestSeq = useRef(0);
  // Reset the picker for each award it opens on (adjusting state during render).
  if (award && state.awardId !== award.id) {
    setState({ awardId: award.id, place: String(firstFree), submissionId: "", selectedTitle: "", query: "" });
    setList(null);
    setError(null);
  }
  if (!award && state.awardId !== null) setState({ awardId: null, place: "1", submissionId: "", selectedTitle: "", query: "" });

  const fetchCandidates = useCallback(
    async (query: string, offset: number, winnerIds: Set<string>) => {
      const seq = ++requestSeq.current;
      setLoading(offset > 0 ? "more" : "replace");
      setError(null);
      const res = await searchAwardCandidates({ organisationSlug, eventId, query: query.trim(), offset });
      if (seq !== requestSeq.current) return;
      setLoading(null);
      if (!res.ok || !res.data) {
        setError(res.ok ? "Could not load projects." : res.error);
        return;
      }
      const page = res.data;
      setList((current) =>
        offset > 0 && current
          ? { candidates: [...current.candidates, ...page.candidates.filter((row) => !current.candidates.some((other) => other.submissionId === row.submissionId))], total: page.total, nextOffset: page.nextOffset }
          : page,
      );
      // Preselect the best-ranked project that doesn't already hold a place in this award.
      if (offset === 0) {
        const best = page.candidates.find((row) => !winnerIds.has(row.submissionId)) ?? page.candidates[0];
        setState((current) => (current.submissionId || !best ? current : { ...current, submissionId: best.submissionId, selectedTitle: best.title }));
      }
    },
    [organisationSlug, eventId],
  );

  // Load the top of the ranking when the picker opens, and search once typing pauses.
  const awardId = award?.id ?? null;
  const winnerKey = award?.winners.map((winner) => winner.submissionId).join(",") ?? "";
  useEffect(() => {
    if (!awardId) return;
    const winnerIds = new Set(winnerKey ? winnerKey.split(",") : []);
    const timer = window.setTimeout(() => void fetchCandidates(state.query, 0, winnerIds), state.query.trim() ? SEARCH_DELAY_MS : 0);
    return () => window.clearTimeout(timer);
  }, [awardId, winnerKey, state.query, fetchCandidates]);

  const placeCount = Math.min(maxPlace, Math.max(3, Math.max(0, ...taken) + 1));
  const placeHolder = award?.winners.find((winner) => String(winner.place) === state.place);
  const selectedVisible = list?.candidates.some((row) => row.submissionId === state.submissionId) ?? false;
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
            <div className="flex flex-col gap-2">
              <SearchInput
                placeholder="Search by project or entrant"
                aria-label="Search projects"
                value={state.query}
                onChange={(event) => setState((current) => ({ ...current, query: event.target.value }))}
                onClear={() => setState((current) => ({ ...current, query: "" }))}
              />
              {error ? (
                <Callout tone="danger" role="alert">
                  {error}
                </Callout>
              ) : null}
              <div className="max-h-[320px] overflow-y-auto rounded-lg border border-line p-3" aria-busy={loading != null}>
                {loading === "replace" || !list ? (
                  <div className="flex justify-center py-4">
                    <Spinner className="size-5" />
                    <span className="sr-only">Loading projects</span>
                  </div>
                ) : list.candidates.length === 0 ? (
                  <p className="text-body-ui text-ink-muted">{state.query.trim() ? "No submitted project matches." : "No submitted projects yet."}</p>
                ) : (
                  <RadioGroup id={loadMoreFocus.listId} aria-label="Project" value={selectedVisible ? state.submissionId : ""} onValueChange={(value) =>
                      setState((current) => ({ ...current, submissionId: value, selectedTitle: list.candidates.find((row) => row.submissionId === value)?.title ?? "" }))
                    }
                  >
                    {list.candidates.map((row) => (
                      <Radio key={row.submissionId} value={row.submissionId} label={candidateLabel(row)} description={row.entrantName} />
                    ))}
                  </RadioGroup>
                )}
                {list && list.nextOffset != null && loading !== "replace" ? (
                  <div className="mt-3 flex justify-center">
                    <Button
                      type="button"
                      variant="quiet"
                      size="sm"
                      loading={loading === "more"}
                      loadingLabel="Loading…"
                      onClick={() => {
                        loadMoreFocus.beforeLoadMore();
                        void fetchCandidates(state.query, list.nextOffset ?? 0, new Set(winnerKey ? winnerKey.split(",") : []));
                      }}
                    >
                      Show more
                    </Button>
                  </div>
                ) : null}
              </div>
              {state.submissionId && !selectedVisible && list ? <p className="text-caption text-ink-secondary">Selected: {state.selectedTitle}</p> : null}
              {list && list.candidates.length > 0 ? (
                <p className="text-caption text-ink-muted">
                  Showing {list.candidates.length} of {list.total} {state.query.trim() ? "matching" : "submitted"} projects
                </p>
              ) : null}
            </div>
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
