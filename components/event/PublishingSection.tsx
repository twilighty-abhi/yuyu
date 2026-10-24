"use client";

import { useId, useState, type ReactNode } from "react";
import { EventPrivacyType, EventStatus } from "@prisma/client";
import * as RadioGroupPrimitive from "@radix-ui/react-radio-group";
import { Check, EyeOff, Globe, Link2, Mail, PencilLine, Radio as LiveIcon } from "lucide-react";
import { SegmentedControl, SwitchRow } from "@/components/ui/choice";
import { Dropdown, Input } from "@/components/ui/field";
import { cn } from "@/lib/cn";
import {
  audienceFromPrivacy,
  privacyFromAudience,
  type Audience,
  type Reach,
  closingSummary,
  leadToParts,
  type CloseMode,
  type LeadUnit,
  LEAD_UNITS,
  publishingSummary,
  capacityUnitLabel,
  type SoloPolicyChoice,
} from "./publishing";
import { TeamSettingsFields, type TeamSettingsDraft } from "./TeamSettingsFields";

/** The stored team registration settings (docs/TEAMS.md). */
export type PublishingTeamSettings = {
  registrationMode: "INDIVIDUAL" | "TEAM";
  teamMinSize: number | null;
  teamMaxSize: number | null;
  soloPolicy: SoloPolicyChoice;
};

/**
 * The Publishing card of the event details form, as three plain questions:
 * who can see the event, who can join, and how sign-ups work. It renders the
 * same form fields the save handler already reads (status, privacyType,
 * capacity, registrationClosesAt, registrationLeadMinutes,
 * showRegistrationCount, and the team settings), and only ever sends one
 * closing rule. Team registration can't be switched on or off once people
 * have registered; the server enforces that too.
 */
export function PublishingSection({
  status,
  onStatusChange,
  privacyType,
  listedPublicly,
  onAudienceChange,
  initialCapacity,
  initialClosesAt,
  initialLeadMinutes,
  showCount,
  onShowCountChange,
  start,
  timeZone,
  onDirty,
  initialTeam,
  teamModeLocked = false,
  largestTeam = 0,
}: {
  status: EventStatus;
  onStatusChange: (status: EventStatus) => void;
  privacyType: EventPrivacyType;
  listedPublicly: boolean;
  onAudienceChange: (audience: { privacyType: EventPrivacyType; listedPublicly: boolean }) => void;
  initialCapacity: number | null;
  /** Wall-clock "YYYY-MM-DDTHH:mm" in the event time zone, or "". */
  initialClosesAt: string;
  initialLeadMinutes: number | null;
  showCount: boolean;
  onShowCountChange: (show: boolean) => void;
  /** The start time as edited above, wall-clock in the event time zone. */
  start: string;
  timeZone: string;
  onDirty: () => void;
  initialTeam: PublishingTeamSettings;
  /** The event already has registrations, so the registration mode can't change. */
  teamModeLocked?: boolean;
  /** Size of the largest current team; the maximum can't go below it. */
  largestTeam?: number;
}) {
  const [limitSpots, setLimitSpots] = useState(initialCapacity != null);
  const [capacity, setCapacity] = useState(initialCapacity != null ? String(initialCapacity) : "");
  const [closeMode, setCloseMode] = useState<CloseMode>(initialClosesAt ? "at" : initialLeadMinutes != null ? "before" : "end");
  const initialLead = leadToParts(initialLeadMinutes ?? 60);
  const [leadAmount, setLeadAmount] = useState(String(initialLead.amount));
  const [leadUnit, setLeadUnit] = useState<LeadUnit>(initialLead.unit);
  const [closesAt, setClosesAt] = useState(initialClosesAt);
  const [team, setTeam] = useState<TeamSettingsDraft>(() => ({
    teamMode: initialTeam.registrationMode === "TEAM",
    teamMinSize: initialTeam.teamMinSize != null ? String(initialTeam.teamMinSize) : "",
    teamMaxSize: initialTeam.teamMaxSize != null ? String(initialTeam.teamMaxSize) : "4",
    soloPolicy: initialTeam.soloPolicy,
  }));
  const { teamMode, teamMinSize, teamMaxSize, soloPolicy } = team;

  const leadMinutes = Number(leadAmount) >= 0 && leadAmount.trim() !== "" ? Math.round(Number(leadAmount) * LEAD_UNITS[leadUnit].minutes) : null;
  const closing = closingSummary({ mode: closeMode, start, leadMinutes, closesAt, timeZone });
  const audience = audienceFromPrivacy(privacyType, listedPublicly);
  const setAudience = (next: Partial<Audience>) => {
    onAudienceChange(privacyFromAudience({ ...audience, ...next }));
    onDirty();
  };
  const summary = publishingSummary({ status, privacyType, listedPublicly, capacity: limitSpots && capacity ? Number(capacity) : null, closing: closing.short, teamMode });
  const live = status === EventStatus.PUBLISHED;
  const touch = <T,>(set: (value: T) => void) => (value: T) => {
    set(value);
    onDirty();
  };

  return (
    <div className="flex flex-col gap-6">
      {/* At a glance: what guests experience right now. */}
      <div role="status" className={cn("flex items-start gap-3 rounded-xl px-4 py-3", live ? "bg-success-bg" : "bg-subtle")}>
        <span aria-hidden className={cn("mt-1.5 size-2.5 shrink-0 rounded-full", live ? "bg-success-solid" : status === EventStatus.HIDDEN ? "bg-ink-muted" : "bg-warning-solid")} />
        <p className="text-body-ui text-ink">
          <span className="font-bold">{summary.headline}</span> <span className="text-ink-secondary">{summary.detail}</span>
        </p>
      </div>

      <Question title="Who can see this event?">
        <RadioGroupPrimitive.Root
          value={status}
          onValueChange={(value) => touch(onStatusChange)(value as EventStatus)}
          aria-label="Event status"
          className="grid gap-2.5 sm:grid-cols-3"
        >
          <OptionCard value={EventStatus.DRAFT} icon={<PencilLine />} title="Draft" description="Only your team can see it. Nobody can sign up yet." />
          <OptionCard value={EventStatus.PUBLISHED} icon={<LiveIcon />} title="Live" description="The event page is public and people can sign up." />
          <OptionCard value={EventStatus.HIDDEN} icon={<EyeOff />} title="Offline" description="Taken down. The link stops working; guests keep their places." />
        </RadioGroupPrimitive.Root>
      </Question>

      <Question title="Who can find it?" note={live ? undefined : "Takes effect when the event is live."}>
        <RadioGroupPrimitive.Root
          value={audience.reach}
          onValueChange={(value) => setAudience({ reach: value as Reach })}
          aria-label="Who can find it"
          className="grid gap-2.5 sm:grid-cols-3"
        >
          <OptionCard value="listed" icon={<Globe />} title="Everyone" description="Listed on your organisation page, Discover and search." />
          <OptionCard value="link" icon={<Link2 />} title="People with the link" description="Not listed anywhere. Share the link with who you want." />
          <OptionCard value="invite" icon={<Mail />} title="Invited people only" description="Only people you invite by email can open the page." />
        </RadioGroupPrimitive.Root>
        <SwitchRow
          label="Approve each sign-up"
          description={
            audience.reach === "invite"
              ? "Not needed: invited people are confirmed when they sign up."
              : audience.approve
                ? "People ask to join and wait until you accept them in Guests."
                : "Off: people get their place straight away."
          }
          checked={audience.approve}
          disabled={audience.reach === "invite"}
          onCheckedChange={(approve) => setAudience({ approve })}
          className="rounded-xl border border-line p-4"
        />
      </Question>

      <Question title="Sign-ups">
        <div className="flex flex-col divide-y divide-line rounded-xl border border-line">
          <div className="flex flex-col gap-3 p-4">
            <SwitchRow
              label="Limit the number of spots"
              description={
                limitSpots
                  ? teamMode
                    ? "Each team counts as one place, and so does each person signing up on their own. When it's full, new sign-ups join the waitlist."
                    : "When it's full, new sign-ups join the waitlist."
                  : "Unlimited. Everyone who signs up gets a place."
              }
              checked={limitSpots}
              onCheckedChange={touch(setLimitSpots)}
            />
            {limitSpots ? (
              <label className="flex items-center gap-3">
                <span className="sr-only">{teamMode ? "Number of teams and solo registrants" : "Number of spots"}</span>
                <Input
                  type="number"
                  min={1}
                  inputMode="numeric"
                  value={capacity}
                  onChange={(event) => setCapacity(event.target.value)}
                  placeholder="100"
                  className="w-32"
                  aria-label={teamMode ? "Number of teams and solo registrants" : "Number of spots"}
                />
                <span className="text-body-ui text-ink-muted">{capacityUnitLabel(teamMode)}</span>
              </label>
            ) : null}
          </div>

          <div className="flex flex-col gap-3 p-4">
            <div>
              <p className="text-label text-ink">Close sign-ups</p>
              <p className="text-caption text-ink-muted">Pick one. After this, the sign-up button turns off.</p>
            </div>
            <SegmentedControl<CloseMode>
              ariaLabel="When sign-ups close"
              size="sm"
              value={closeMode}
              onValueChange={touch(setCloseMode)}
              options={[
                { value: "end", label: "At the end" },
                { value: "before", label: "Before start" },
                { value: "at", label: "Set time" },
              ]}
              className="self-start max-sm:w-full max-sm:[&>*]:flex-1"
            />
            {closeMode === "before" ? (
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  type="number"
                  min={0}
                  inputMode="numeric"
                  value={leadAmount}
                  onChange={(event) => setLeadAmount(event.target.value)}
                  aria-label="How long before the start"
                  className="w-24"
                />
                <Dropdown value={leadUnit} onChange={(event) => touch(setLeadUnit)(event.target.value as LeadUnit)} aria-label="Unit" className="w-36">
                  {Object.entries(LEAD_UNITS).map(([unit, meta]) => (
                    <option key={unit} value={unit}>{meta.label}</option>
                  ))}
                </Dropdown>
                <span className="text-body-ui text-ink-muted">before the start</span>
              </div>
            ) : null}
            {closeMode === "at" ? (
              <Input
                type="datetime-local"
                value={closesAt}
                max={start || undefined}
                onChange={(event) => setClosesAt(event.target.value)}
                aria-label={`Sign-ups close at (${timeZone})`}
                className="sm:max-w-xs"
              />
            ) : null}
            <p className={cn("flex items-start gap-1.5 text-caption", closing.problem ? "text-danger-fg" : "text-ink-secondary")}>
              {closing.problem ? null : <Check aria-hidden className="mt-px size-3.5 shrink-0 text-success-fg" />}
              {closing.problem ?? closing.long}
            </p>
          </div>

          <div className="flex flex-col gap-3 p-4">
            <TeamSettingsFields
              value={team}
              onChange={touch(setTeam)}
              locked={teamModeLocked}
              largestTeam={largestTeam}
              offDescription="Off: everyone signs up on their own."
            />
          </div>

          <SwitchRow
            name="showRegistrationCount"
            label="Show how many are going"
            description="Guests see the number of sign-ups on the event page."
            checked={showCount}
            onCheckedChange={touch(onShowCountChange)}
            className="p-4"
          />
        </div>
      </Question>

      {/* The fields the save handler reads. Only one closing rule is ever sent. */}
      <input type="hidden" name="status" value={status} />
      <input type="hidden" name="privacyType" value={privacyType} />
      <input type="hidden" name="listedPublicly" value={listedPublicly ? "true" : "false"} />
      <input type="hidden" name="capacity" value={limitSpots ? capacity : ""} />
      <input type="hidden" name="registrationLeadMinutes" value={closeMode === "before" && leadMinutes != null ? String(leadMinutes) : ""} />
      <input type="hidden" name="registrationClosesAt" value={closeMode === "at" ? closesAt : ""} />
      <input type="hidden" name="registrationMode" value={teamMode ? "TEAM" : "INDIVIDUAL"} />
      <input type="hidden" name="teamMinSize" value={teamMode ? teamMinSize : ""} />
      <input type="hidden" name="teamMaxSize" value={teamMode ? teamMaxSize : ""} />
      <input type="hidden" name="soloPolicy" value={teamMode ? soloPolicy : ""} />
    </div>
  );
}

function Question({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  const id = useId();
  return (
    <div role="group" aria-labelledby={id} className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h3 id={id} className="text-label text-ink">{title}</h3>
        {note ? <p className="text-caption text-ink-muted">{note}</p> : null}
      </div>
      {children}
    </div>
  );
}

function OptionCard({ value, icon, title, description }: { value: string; icon: ReactNode; title: string; description: string }) {
  return (
    <RadioGroupPrimitive.Item
      value={value}
      className="group flex min-w-0 items-start gap-3 rounded-xl border border-line bg-canvas p-3.5 text-left transition-colors duration-[180ms] ease-yy hover:bg-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary data-[state=checked]:border-ink data-[state=checked]:shadow-[inset_0_0_0_0.5px_var(--color-ink)]"
    >
      <span aria-hidden className="flex size-8 shrink-0 items-center justify-center rounded-full bg-subtle text-ink-secondary group-data-[state=checked]:bg-ink group-data-[state=checked]:text-canvas [&_svg]:size-4">
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-label text-ink">{title}</span>
        <span className="block text-caption text-ink-muted">{description}</span>
      </span>
    </RadioGroupPrimitive.Item>
  );
}
