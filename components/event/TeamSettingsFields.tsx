"use client";

import { useId } from "react";
import { Lock } from "lucide-react";
import { SwitchRow } from "@/components/ui/choice";
import { Dropdown, Input } from "@/components/ui/field";
import { cn } from "@/lib/cn";
import { SOLO_POLICY_OPTIONS, teamSizeProblem, type SoloPolicyChoice } from "./publishing";

/** Team registration settings as the form holds them (sizes as typed). */
export type TeamSettingsDraft = {
  teamMode: boolean;
  teamMinSize: string;
  teamMaxSize: string;
  soloPolicy: SoloPolicyChoice;
};

export const DEFAULT_TEAM_SETTINGS: TeamSettingsDraft = {
  teamMode: false,
  teamMinSize: "",
  teamMaxSize: "4",
  soloPolicy: "SOLO_ALLOWED",
};

/** What is wrong with the sizes, checked the way the server does; null when fine or off. */
export function teamSettingsProblem(draft: TeamSettingsDraft, largestTeam = 0): string | null {
  return draft.teamMode ? teamSizeProblem({ minSize: draft.teamMinSize, maxSize: draft.teamMaxSize, largestTeam: largestTeam || undefined }) : null;
}

/** The create/update payload fields for these settings (docs/TEAMS.md). */
export function teamSettingsPayload(draft: TeamSettingsDraft) {
  return draft.teamMode
    ? { registrationMode: "TEAM" as const, teamMinSize: draft.teamMinSize.trim(), teamMaxSize: draft.teamMaxSize.trim(), soloPolicy: draft.soloPolicy }
    : { registrationMode: "INDIVIDUAL" as const };
}

/**
 * The team registration switch, team sizes and solo policy (docs/TEAMS.md),
 * shared by the Create event dialog and the event's Publishing section so
 * the wording and checks stay the same. On an existing event, `locked` keeps
 * the mode fixed once people have signed up, and `largestTeam` stops the
 * maximum dropping below the largest current team.
 */
export function TeamSettingsFields({
  value,
  onChange,
  locked = false,
  largestTeam = 0,
  offDescription = "Off: everyone signs up on their own. You can change this until the first person signs up.",
}: {
  value: TeamSettingsDraft;
  onChange: (next: TeamSettingsDraft) => void;
  locked?: boolean;
  largestTeam?: number;
  offDescription?: string;
}) {
  const helpId = useId();
  const problem = teamSettingsProblem(value, largestTeam);
  const set = (patch: Partial<TeamSettingsDraft>) => onChange({ ...value, ...patch });
  return (
    <div className="flex flex-col gap-3">
      <SwitchRow
        label="Team registration"
        description={
          locked
            ? "People have already signed up, so this can't be changed now."
            : value.teamMode
              ? "People sign up as teams: one person creates the team and shares a link with the others."
              : offDescription
        }
        checked={value.teamMode}
        disabled={locked}
        onCheckedChange={(teamMode) => set({ teamMode })}
      />
      {locked ? (
        <p className="flex items-center gap-1.5 text-caption text-ink-muted">
          <Lock aria-hidden className="size-3.5 shrink-0" />
          Locked because this event has registrations.
        </p>
      ) : null}
      {value.teamMode ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-caption text-ink-secondary">Smallest team</span>
              <Input
                type="number"
                min={1}
                max={100}
                inputMode="numeric"
                value={value.teamMinSize}
                onChange={(event) => set({ teamMinSize: event.target.value })}
                placeholder="Any"
                className="w-28"
                aria-describedby={helpId}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-caption text-ink-secondary">Largest team</span>
              <Input
                type="number"
                min={Math.max(2, largestTeam)}
                max={100}
                inputMode="numeric"
                value={value.teamMaxSize}
                onChange={(event) => set({ teamMaxSize: event.target.value })}
                className="w-28"
                aria-describedby={helpId}
                aria-invalid={problem ? true : undefined}
              />
            </label>
            <span className="pb-2.5 text-body-ui text-ink-muted">people</span>
          </div>
          <p id={helpId} className={cn("text-caption", problem ? "text-danger-fg" : "text-ink-muted")}>
            {problem ?? "Teams smaller than the minimum are marked Incomplete and can't be approved until they grow."}
          </p>
          <label className="flex flex-col gap-1">
            <span className="text-label text-ink">Can people sign up without a team?</span>
            <Dropdown value={value.soloPolicy} onChange={(event) => set({ soloPolicy: event.target.value as SoloPolicyChoice })} className="sm:max-w-md">
              {SOLO_POLICY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </Dropdown>
            <span className="text-caption text-ink-muted">{SOLO_POLICY_OPTIONS.find((option) => option.value === value.soloPolicy)?.description}</span>
          </label>
        </div>
      ) : null}
    </div>
  );
}
