import type { AutoAssignMode } from "@/lib/judgingProgress";

/*
 * Copy for Judging → Progress and automatic assignment that depends on
 * state, kept apart from the components so each case is unit-tested
 * (tests/unit/judging-ops-copy.test.ts).
 */

function plural(count: number, one: string, many: string = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** The Progress card's description line. */
export function progressTargetLine(target: number, isDefault: boolean): string {
  return isDefault
    ? `Aiming for ${plural(target, "judge")} per project (the default; set your own target below).`
    : `Aiming for ${plural(target, "judge")} per project.`;
}

/** "+12.5 points" / "−8 points" for an outlier's difference from the other judges. */
export function signedPoints(difference: number): string {
  const abs = Math.abs(difference);
  const text = Number.isInteger(abs) ? String(abs) : abs.toFixed(1);
  const sign = difference > 0 ? "+" : difference < 0 ? "−" : "";
  return `${sign}${text} ${abs === 1 ? "point" : "points"}`;
}

/** The headline of an automatic assignment preview. */
export function autoAssignPreviewHeadline(preview: { projects: number; perProject: number; shortfallTotal: number; added: number; removed: number; adopted?: number }): string {
  if (preview.projects === 0) return "There are no submitted projects to assign yet.";
  const reach =
    preview.shortfallTotal === 0
      ? `Every one of the ${plural(preview.projects, "submitted project")} gets ${plural(preview.perProject, "judge")}.`
      : `${plural(preview.shortfallTotal, "project")} of ${preview.projects} can't reach ${plural(preview.perProject, "judge")}: there aren't enough judges without a conflict of interest.`;
  const changes = [preview.added > 0 ? `${plural(preview.added, "new assignment")}` : "no new assignments", preview.removed > 0 ? `${plural(preview.removed, "assignment")} removed` : null]
    .filter(Boolean)
    .join(", ");
  const adopted = preview.adopted
    ? ` ${preview.adopted === 1 ? "1 project a judge has" : `${preview.adopted} projects judges have`} already started ${preview.adopted === 1 ? "becomes their assignment" : "become their assignments"}, so nobody loses work in progress.`
    : "";
  return `${reach} ${changes.charAt(0).toUpperCase()}${changes.slice(1)}.${adopted}`;
}

/** What each mode does, for the dialog's radio descriptions. */
export const AUTO_ASSIGN_MODE_COPY: Record<AutoAssignMode, { label: string; description: string }> = {
  keep: {
    label: "Keep current assignments",
    description: "Only adds judges where a project is short of the target.",
  },
  replace: {
    label: "Start over",
    description: "Removes current assignments and shares projects out again. Assignments a judge has already started scoring are kept.",
  },
};

/** The warning shown before applying while judges still see every project. */
export const SEE_ALL_SWITCH_WARNING = "Judges will then see only the projects assigned to them, not every project.";
