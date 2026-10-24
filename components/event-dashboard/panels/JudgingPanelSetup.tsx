"use client";

import { useState } from "react";
import type { JudgingStatus } from "@prisma/client";
import { changeJudgingStatus, saveJudgingSettings } from "@/app/actions/judging-admin";
import { ConfirmationDialog } from "@/components/feedback/ConfirmationDialog";
import { Button } from "@/components/ui/button";
import { Radio, RadioGroup, SwitchRow } from "@/components/ui/choice";
import { Callout, Card, CardHeader, Chip } from "@/components/ui/display";
import { Field, Input } from "@/components/ui/field";
import { formatDayTime, formatTimeZoneName } from "@/lib/format/datetime";
import { zonedInputToIso } from "@/lib/timeZone";
import type { JudgingDashboardSettings } from "@/lib/eventDashboard/judging";
import {
  JUDGING_STATUS_LABELS,
  JUDGING_STATUS_TONES,
  fieldError,
  useJudgingAction,
  type JudgingScope,
} from "./JudgingPanelShared";

/**
 * Judging → Setup: submission settings (window shown and entered in the
 * event timezone, converted to UTC instants before saving) and the judging
 * status controls. The server checks the window order, the rubric, and every
 * status transition again.
 */
export function JudgingPanelSetup({
  scope,
  settings,
  criteriaCount,
  submittedCount,
  now,
}: {
  scope: JudgingScope;
  settings: JudgingDashboardSettings;
  criteriaCount: number;
  submittedCount: number;
  now: string;
}) {
  return (
    <div className="flex flex-col gap-5">
      <SettingsCard scope={scope} settings={settings} now={now} />
      <StatusCard scope={scope} settings={settings} criteriaCount={criteriaCount} submittedCount={submittedCount} />
    </div>
  );
}

/**
 * The submissions settings card on its own. The Settings tab shows it while
 * the event does not use judging yet, so organisers can turn submissions on
 * without a ninth dashboard tab on every event.
 */
export function JudgingSettingsCard({ scope, settings, now }: { scope: JudgingScope; settings: JudgingDashboardSettings; now: string }) {
  return <SettingsCard scope={scope} settings={settings} now={now} inSettingsTab />;
}

/** Toast after saving. From the Settings tab, turning submissions on moves this card to the new Judging tab, so say where it went. */
export function judgingSettingsSavedMessage(enabled: boolean, inSettingsTab: boolean) {
  return inSettingsTab && enabled ? "Project submissions are on. Their settings, the rubric and judging are now on the Judging tab." : "Judging settings saved.";
}

function SettingsCard({ scope, settings, now, inSettingsTab = false }: { scope: JudgingScope; settings: JudgingDashboardSettings; now: string; inSettingsTab?: boolean }) {
  const { run, busy } = useJudgingAction();
  const [enabled, setEnabled] = useState(settings.submissionsEnabled);
  const [opensAt, setOpensAt] = useState(settings.opensAtLocal);
  const [closesAt, setClosesAt] = useState(settings.closesAtLocal);
  const [seeAll, setSeeAll] = useState(settings.judgesSeeAll ? "all" : "assigned");
  const [galleryPublic, setGalleryPublic] = useState(settings.projectGalleryPublic);
  const [errors, setErrors] = useState<Record<string, string[]> | undefined>();
  const zone = formatTimeZoneName(settings.opensAt ?? now, settings.timezone);
  // The switch runs the whole feature (judging, results, gallery), so it stays
  // on once judging has started; the server refuses turning it off too.
  const lockedOn = settings.submissionsEnabled && (settings.judgingStatus !== "NOT_STARTED" || Boolean(settings.resultsPublishedAt));

  function save() {
    const opensIso = opensAt ? zonedInputToIso(opensAt, settings.timezone) : "";
    const closesIso = closesAt ? zonedInputToIso(closesAt, settings.timezone) : "";
    const local: Record<string, string[]> = {};
    if (opensIso === null) local.submissionsOpenAt = ["Enter a valid date and time."];
    if (closesIso === null) local.submissionsCloseAt = ["Enter a valid date and time."];
    if (Object.keys(local).length > 0) {
      setErrors(local);
      return;
    }
    setErrors(undefined);
    run(
      "settings",
      () =>
        saveJudgingSettings({
          ...scope,
          settings: {
            submissionsEnabled: enabled,
            submissionsOpenAt: opensIso ?? "",
            submissionsCloseAt: closesIso ?? "",
            judgesSeeAll: seeAll === "all",
            projectGalleryPublic: galleryPublic,
          },
        }),
      judgingSettingsSavedMessage(enabled, inSettingsTab),
      (result) => setErrors(result.ok ? undefined : result.fieldErrors),
    );
  }

  return (
    <Card as="section">
      <CardHeader
        title="Project submissions"
        description="Confirmed teams and solo registrants submit a project during the window. Times are in the event's timezone."
      />
      <form
        className="flex max-w-[640px] flex-col gap-5"
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <SwitchRow
          label="Projects and judging"
          description={
            lockedOn
              ? "Judging has started, so this stays on. To stop taking new projects, move the closing time."
              : "Turns on the submission form on team pages and tickets, judging, results, and the project gallery. Turning it off hides all of them; to stop taking new projects, set the closing time instead."
          }
          checked={enabled}
          disabled={lockedOn}
          onCheckedChange={setEnabled}
        />
        <div className="grid gap-3.5 sm:grid-cols-2">
          <Field label={`Opens (${zone})`} optional={!enabled} error={fieldError(errors, "submissionsOpenAt")}>
            <Input type="datetime-local" value={opensAt} onChange={(event) => setOpensAt(event.target.value)} />
          </Field>
          <Field label={`Closes (${zone})`} optional={!enabled} error={fieldError(errors, "submissionsCloseAt")}>
            <Input type="datetime-local" value={closesAt} onChange={(event) => setClosesAt(event.target.value)} />
          </Field>
        </div>
        {settings.opensAt && settings.closesAt ? (
          <p className="text-caption text-ink-muted">
            Saved window: {formatDayTime(settings.opensAt, settings.timezone)} to {formatDayTime(settings.closesAt, settings.timezone)} {zone}.
          </p>
        ) : null}
        <fieldset className="flex flex-col gap-2.5">
          <legend className="mb-2.5 text-label text-ink">Which projects judges see</legend>
          <RadioGroup value={seeAll} onValueChange={setSeeAll}>
            <Radio value="all" label="All judges see all submissions" description="Every judge can score every submitted project." />
            <Radio value="assigned" label="Only assigned submissions" description="Assign projects to judges on the Submissions tab." />
          </RadioGroup>
        </fieldset>
        <SwitchRow
          label="Public project gallery"
          description="After submissions close, list submitted projects on the event's projects page. It follows the event page's visibility."
          checked={galleryPublic}
          onCheckedChange={setGalleryPublic}
        />
        <div>
          <Button type="submit" variant="primary" loading={busy === "settings"} loadingLabel="Saving…">
            Save settings
          </Button>
        </div>
      </form>
    </Card>
  );
}

const STATUS_HELP: Record<JudgingStatus, string> = {
  NOT_STARTED: "Judges can't score yet. You can still change the rubric.",
  OPEN: "Judges can score submitted projects. The rubric is locked.",
  CLOSED: "Scores are frozen. Pick winners and publish the results.",
};

function StatusCard({
  scope,
  settings,
  criteriaCount,
  submittedCount,
}: {
  scope: JudgingScope;
  settings: JudgingDashboardSettings;
  criteriaCount: number;
  submittedCount: number;
}) {
  const { run, busy } = useJudgingAction();
  const [confirming, setConfirming] = useState<JudgingStatus | null>(null);
  const status = settings.judgingStatus;
  const change = (next: JudgingStatus, success: string) =>
    run(next, () => changeJudgingStatus({ ...scope, status: next }), success, () => setConfirming(null));

  const openBlocked = !settings.submissionsEnabled
    ? "Turn on project submissions first."
    : criteriaCount === 0
      ? "Add at least one rubric criterion first."
      : null;

  return (
    <Card as="section">
      <CardHeader
        title="Judging"
        description={STATUS_HELP[status]}
        action={<Chip tone={JUDGING_STATUS_TONES[status]}>{JUDGING_STATUS_LABELS[status]}</Chip>}
      />
      <div className="flex flex-col gap-3">
        {status === "NOT_STARTED" ? (
          <>
            {openBlocked ? <Callout tone="info">{openBlocked}</Callout> : null}
            <div>
              <Button variant="primary" disabled={Boolean(openBlocked)} loading={busy === "OPEN"} onClick={() => setConfirming("OPEN")}>
                Open judging
              </Button>
            </div>
          </>
        ) : null}
        {status === "OPEN" ? (
          <div className="flex flex-wrap gap-2.5">
            <Button variant="primary" loading={busy === "CLOSED"} onClick={() => setConfirming("CLOSED")}>
              Close judging…
            </Button>
            <Button variant="quiet" loading={busy === "NOT_STARTED"} onClick={() => change("NOT_STARTED", "Judging moved back to not started.")}>
              Back to not started
            </Button>
          </div>
        ) : null}
        {status === "CLOSED" ? (
          <>
            {settings.resultsPublishedAt ? <Callout tone="info">Results are published. Unpublish them before reopening judging.</Callout> : null}
            <div>
              <Button variant="secondary" disabled={Boolean(settings.resultsPublishedAt)} loading={busy === "OPEN"} onClick={() => change("OPEN", "Judging reopened.")}>
                Reopen judging
              </Button>
            </div>
          </>
        ) : null}
      </div>
      <ConfirmationDialog
        open={confirming === "OPEN"}
        title="Open judging?"
        message={`Judges can start scoring the ${submittedCount} submitted project${submittedCount === 1 ? "" : "s"}. The rubric is locked while judging is open or closed.`}
        confirmLabel="Open judging"
        destructive={false}
        loading={busy === "OPEN"}
        onConfirm={() => change("OPEN", "Judging is open.")}
        onCancel={() => setConfirming(null)}
      />
      <ConfirmationDialog
        open={confirming === "CLOSED"}
        title="Close judging?"
        message="Scores are frozen once judging closes. Reviews that judges haven't submitted won't count toward results. You can reopen judging until results are published."
        confirmLabel="Close judging"
        destructive={false}
        loading={busy === "CLOSED"}
        onConfirm={() => change("CLOSED", "Judging is closed.")}
        onCancel={() => setConfirming(null)}
      />
    </Card>
  );
}
