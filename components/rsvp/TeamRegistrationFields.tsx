"use client";

import { useState } from "react";
import { Link2, UsersRound } from "lucide-react";
import { CheckboxField, RadioGroup, Radio } from "@/components/ui/choice";
import { Callout } from "@/components/ui/display";
import { Field, Input } from "@/components/ui/field";

/*
 * Team registration choices for the public sign-up form (docs/TEAMS.md).
 * The server (`/api/rsvp` → `submitRsvpCore`) owns every rule: team name
 * uniqueness, team size, capacity in units, and the solo policy. These checks
 * only give each field its own message before the request.
 */

// Mirrors lib/validators.ts; the client bundle must not import server validators.
const TEAM_NAME_MAX_LENGTH = 60;
const SEEKER_HEADLINE_MAX_LENGTH = 120;
const SEEKER_MAX_SKILLS = 8;
const SEEKER_SKILL_MAX_LENGTH = 30;

export type SoloPolicyValue = "TEAMS_ONLY" | "SOLO_ALLOWED" | "SOLO_WITH_MATCHING";

/** Team settings of a TEAM event as the public form needs them. Absent on INDIVIDUAL events. */
export type TeamRegistrationConfig = {
  soloPolicy: SoloPolicyValue;
  teamMinSize: number | null;
  teamMaxSize: number | null;
  /** Opened from a team join link: the team is shown and fixed. Never carries member names. */
  joinTeam?: { joinToken: string; name: string; size: number; maxSize: number | null };
};

type TeamMode = "create" | "join" | "solo";

/** What `/api/rsvp` accepts as `team` (lib/validators.ts `teamRegistrationIntentSchema`). */
export type TeamIntentPayload =
  | { mode: "create"; name: string }
  | { mode: "join"; joinToken: string }
  | { mode: "solo"; seeker?: { headline: string; skills: string[] } };

type TeamErrors = { teamName?: string; headline?: string; skills?: string };

function parseSkills(text: string) {
  const seen = new Set<string>();
  return text
    .split(",")
    .map((skill) => skill.trim().replace(/\s+/g, " "))
    .filter((skill) => {
      if (!skill || seen.has(skill.toLowerCase())) return false;
      seen.add(skill.toLowerCase());
      return true;
    });
}

function soloAllowed(config: TeamRegistrationConfig) {
  return config.soloPolicy !== "TEAMS_ONLY";
}

function sizeSummary(config: TeamRegistrationConfig) {
  const { teamMinSize: min, teamMaxSize: max } = config;
  if (min != null && max != null && min > 1) return `Teams of ${min} to ${max} people.`;
  if (max != null) return `Teams of up to ${max} people.`;
  return null;
}

/** State and checks for the team part of the form; `RsvpForm` renders `TeamRegistrationFields` with it. */
export function useTeamRegistration(config: TeamRegistrationConfig | null | undefined) {
  const [mode, setMode] = useState<TeamMode>(config?.joinTeam ? "join" : "create");
  const [teamName, setTeamName] = useState("");
  const [seeking, setSeeking] = useState(false);
  const [headline, setHeadline] = useState("");
  const [skillsText, setSkillsText] = useState("");
  const [errors, setErrors] = useState<TeamErrors>({});

  const fixedTeam = config?.joinTeam ?? null;
  const matching = config?.soloPolicy === "SOLO_WITH_MATCHING";
  /** "Join with a link" without a link only explains how to get one; there is nothing to submit. */
  const awaitingLink = Boolean(config && !fixedTeam && mode === "join");

  function check(): TeamErrors {
    if (!config || fixedTeam) return {};
    const next: TeamErrors = {};
    if (mode === "create") {
      const name = teamName.trim();
      if (!name) next.teamName = "Please enter a team name.";
      else if (name.length > TEAM_NAME_MAX_LENGTH) next.teamName = `Keep the team name to ${TEAM_NAME_MAX_LENGTH} characters.`;
      else if (!/[\p{L}\p{N}]/u.test(name) || /[<>]/.test(name)) next.teamName = "Enter a team name with letters or numbers.";
    }
    if (mode === "solo" && matching && seeking) {
      const line = headline.trim();
      if (!line) next.headline = "Add a short headline so teams know what you bring.";
      else if (line.length > SEEKER_HEADLINE_MAX_LENGTH) next.headline = `Keep the headline to ${SEEKER_HEADLINE_MAX_LENGTH} characters.`;
      const skills = parseSkills(skillsText);
      if (skills.length > SEEKER_MAX_SKILLS) next.skills = `Add up to ${SEEKER_MAX_SKILLS} skills.`;
      else if (skills.some((skill) => skill.length > SEEKER_SKILL_MAX_LENGTH)) next.skills = `Keep each skill to ${SEEKER_SKILL_MAX_LENGTH} characters.`;
    }
    return next;
  }

  return {
    config: config ?? null,
    mode,
    awaitingLink,
    errors,
    teamName,
    seeking,
    headline,
    skillsText,
    setMode(next: TeamMode) {
      setMode(next);
      setErrors({});
    },
    setTeamName(value: string) {
      setTeamName(value);
      if (errors.teamName && value.trim()) setErrors((current) => ({ ...current, teamName: undefined }));
    },
    setSeeking(value: boolean) {
      setSeeking(value);
      if (!value) setErrors((current) => ({ ...current, headline: undefined, skills: undefined }));
    },
    setHeadline(value: string) {
      setHeadline(value);
      if (errors.headline && value.trim()) setErrors((current) => ({ ...current, headline: undefined }));
    },
    setSkillsText(value: string) {
      setSkillsText(value);
      if (errors.skills) setErrors((current) => ({ ...current, skills: undefined }));
    },
    /** Shows field errors; returns the key of the first problem for focusing, or null. */
    validate(): "__teamName" | "__seekerHeadline" | "__seekerSkills" | null {
      const next = check();
      setErrors(next);
      if (next.teamName) return "__teamName";
      if (next.headline) return "__seekerHeadline";
      if (next.skills) return "__seekerSkills";
      return null;
    },
    problemCount() {
      return Object.values(errors).filter(Boolean).length;
    },
    /** The `team` body field, or undefined on an INDIVIDUAL event. */
    payload(): TeamIntentPayload | undefined {
      if (!config) return undefined;
      if (fixedTeam) return { mode: "join", joinToken: fixedTeam.joinToken };
      if (mode === "create") return { mode: "create", name: teamName.trim() };
      if (mode === "solo") {
        return matching && seeking
          ? { mode: "solo", seeker: { headline: headline.trim(), skills: parseSkills(skillsText) } }
          : { mode: "solo" };
      }
      return undefined;
    },
  };
}

export type TeamRegistrationController = ReturnType<typeof useTeamRegistration>;

/** The team block at the top of the form on TEAM events. Renders nothing on INDIVIDUAL events. */
export function TeamRegistrationFields({ controller }: { controller: TeamRegistrationController }) {
  const { config, errors } = controller;
  if (!config) return null;
  const sizes = sizeSummary(config);

  if (config.joinTeam) {
    const team = config.joinTeam;
    return (
      <div className="flex items-start gap-3 rounded-lg border border-line bg-subtle p-4">
        <span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-full bg-canvas text-ink">
          <UsersRound className="size-5" />
        </span>
        <div className="min-w-0">
          <p className="text-caption text-ink-muted">You’re joining</p>
          <p className="break-words text-[17px] font-bold leading-tight text-ink">{team.name}</p>
          <p className="mt-0.5 text-caption text-ink-muted">
            {team.maxSize != null ? `${team.size} of ${team.maxSize} members` : `${team.size} ${team.size === 1 ? "member" : "members"}`}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3.5">
      <fieldset className="flex flex-col gap-2.5">
        <legend className="mb-2.5 text-label text-ink">How are you taking part?</legend>
        <RadioGroup aria-label="How are you taking part?" value={controller.mode} onValueChange={(value) => controller.setMode(value as TeamMode)}>
          <Radio value="create" label="Create a team" description="You’ll lead the team and get a link to invite teammates." />
          <Radio value="join" label="Join with a link" description="Your team leader shares a link to their team." />
          {soloAllowed(config) ? (
            <Radio
              value="solo"
              label="Register solo"
              description={config.soloPolicy === "SOLO_WITH_MATCHING" ? "Take part on your own, or find a team here." : "Take part on your own."}
            />
          ) : null}
        </RadioGroup>
        {sizes ? <p className="text-caption text-ink-muted">{sizes}{config.soloPolicy === "TEAMS_ONLY" ? " Everyone takes part in a team." : ""}</p> : null}
      </fieldset>

      {controller.mode === "create" ? (
        <div data-question-key="__teamName">
          <Field label="Team name" required error={errors.teamName} helperText="Must be different from other teams at this event.">
            <Input
              name="teamName"
              autoComplete="off"
              value={controller.teamName}
              onChange={(event) => controller.setTeamName(event.target.value)}
              maxLength={TEAM_NAME_MAX_LENGTH}
            />
          </Field>
        </div>
      ) : null}

      {controller.mode === "join" ? (
        <Callout tone="info" title="Ask your team leader for the team link">
          <span className="flex items-start gap-2">
            <Link2 aria-hidden className="mt-0.5 size-4 shrink-0" />
            <span>
              The leader finds it on their team page. Opening it brings you back to this form with the team already chosen.
            </span>
          </span>
        </Callout>
      ) : null}

      {controller.mode === "solo" && config.soloPolicy === "SOLO_WITH_MATCHING" ? (
        <div className="flex flex-col gap-3.5 rounded-lg border border-line p-4">
          <CheckboxField
            checked={controller.seeking}
            onCheckedChange={(checked) => controller.setSeeking(checked === true)}
            label="List me as looking for a team"
            description="Team leaders and other solo entrants at this event see your first name, last initial, headline and skills. Never your email."
          />
          {controller.seeking ? (
            <>
              <div data-question-key="__seekerHeadline">
                <Field label="Headline" required error={errors.headline} helperText={`What you bring, in up to ${SEEKER_HEADLINE_MAX_LENGTH} characters.`}>
                  <Input
                    name="seekerHeadline"
                    autoComplete="off"
                    value={controller.headline}
                    placeholder="Backend developer who likes data viz"
                    onChange={(event) => controller.setHeadline(event.target.value)}
                    maxLength={SEEKER_HEADLINE_MAX_LENGTH}
                  />
                </Field>
              </div>
              <div data-question-key="__seekerSkills">
                <Field label="Skills" optional error={errors.skills} helperText={`Up to ${SEEKER_MAX_SKILLS}, separated by commas.`}>
                  <Input
                    name="seekerSkills"
                    autoComplete="off"
                    value={controller.skillsText}
                    placeholder="Python, design, pitching"
                    onChange={(event) => controller.setSkillsText(event.target.value)}
                    maxLength={SEEKER_MAX_SKILLS * (SEEKER_SKILL_MAX_LENGTH + 2)}
                  />
                </Field>
              </div>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
