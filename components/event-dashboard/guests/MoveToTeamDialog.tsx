"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type { RsvpStatus } from "@prisma/client";
import { ArrowRightLeft } from "lucide-react";
import { moveTeamMember, searchMoveTargets } from "@/app/actions/team-admin";
import { useToast } from "@/components/feedback/ToastProvider";
import { Button } from "@/components/ui/button";
import { Radio, RadioGroup } from "@/components/ui/choice";
import { useLoadMoreFocus } from "@/components/ui/use-load-more-focus";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Callout } from "@/components/ui/display";
import { SearchInput } from "@/components/ui/field";
import { useDebouncedValue } from "./useServerPages";
import { moveOutcome, moveTargets } from "./teamList";

export type MoveTargetTeam = { id: string; name: string; status: RsvpStatus; size: number; maxSize: number | null };

const SEARCH_DELAY_MS = 300;

/**
 * Move one registration (solo, or from another team) into a team of the same
 * event. The team list is searched and paged on the server
 * (`searchMoveTargets`: this event's teams with room, alphabetical), so any
 * team can be chosen however many there are. Size, status and the event lock
 * are all re-checked on the server when moving.
 */
export function MoveToTeamDialog({
  organisationSlug,
  eventId,
  person,
  onClose,
  onMoved,
}: {
  organisationSlug: string;
  eventId: string;
  person: { rsvpId: string; name: string; teamId: string | null };
  onClose: () => void;
  onMoved: () => void;
}) {
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const searched = useDebouncedValue(query.trim(), SEARCH_DELAY_MS);
  const [teams, setTeams] = useState<MoveTargetTeam[]>([]);
  const loadMoreFocus = useLoadMoreFocus(teams.length, { focus: "radio" });
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState<"replace" | "more" | null>("replace");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [target, setTarget] = useState<MoveTargetTeam | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  async function fetchTeams(search: string, cursor: string | null) {
    const mine = ++seq.current;
    setLoading(cursor ? "more" : "replace");
    setLoadError(null);
    const res = await searchMoveTargets({ organisationSlug, eventId, query: search, cursor, excludeTeamId: person.teamId });
    if (mine !== seq.current) return;
    setLoading(null);
    if (!res.ok || !res.data) {
      setLoadError(res.ok ? "Could not load teams." : res.error);
      return;
    }
    // The server already leaves out full, declined and current teams; this only guards stale rows.
    const page = moveTargets(res.data.teams, person.teamId);
    setTeams((current) => (cursor ? [...current, ...page.filter((team) => !current.some((other) => other.id === team.id))] : page));
    setNextCursor(res.data.nextCursor);
  }

  // The first page on open, then a fresh first page for each settled search.
  const fetchRef = useRef(fetchTeams);
  useEffect(() => {
    fetchRef.current = fetchTeams;
  });
  useEffect(() => {
    const timer = window.setTimeout(() => void fetchRef.current(searched, null), 0);
    return () => window.clearTimeout(timer);
  }, [searched]);

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
            <div>
              <label htmlFor="move-team-search" className="sr-only">Search teams by name</label>
              <SearchInput
                id="move-team-search"
                placeholder="Search teams"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onClear={() => setQuery("")}
                autoComplete="off"
                className="py-2 sm:text-sm"
              />
            </div>
            {loadError ? <Callout tone="danger" role="alert">{loadError}</Callout> : null}
            {loading === "replace" ? (
              <p role="status" className="text-body-ui text-ink-muted">Loading teams…</p>
            ) : teams.length === 0 ? (
              <p className="text-body-ui text-ink-muted">{searched ? "No team with room matches that search." : "No other team has room right now."}</p>
            ) : (
              <div className="flex min-w-0 flex-col gap-2">
                <RadioGroup
                  id={loadMoreFocus.listId}
                  aria-label="Team"
                  value={target?.id ?? ""}
                  onValueChange={(value) => setTarget(teams.find((team) => team.id === value) ?? null)}
                  className="max-h-[280px] gap-2 overflow-y-auto pr-1"
                >
                  {teams.map((team) => (
                    <Radio
                      key={team.id}
                      value={team.id}
                      label={team.name}
                      description={`${team.size}${team.maxSize != null ? ` of ${team.maxSize}` : ""} ${team.size === 1 && team.maxSize == null ? "person" : "people"}`}
                    />
                  ))}
                </RadioGroup>
                {nextCursor ? (
                  <Button size="sm" variant="quiet" className="self-start" loading={loading === "more"} loadingLabel="Loading…" onClick={() => {
                      loadMoreFocus.beforeLoadMore();
                      void fetchTeams(searched, nextCursor);
                    }}>
                    Show more teams
                  </Button>
                ) : null}
              </div>
            )}
            {target ? (
              <p className="text-caption text-ink-muted" aria-live="polite">
                {target.name}: {moveOutcome(target.status)}
              </p>
            ) : null}
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
