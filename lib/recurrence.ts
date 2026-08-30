import { rrulestr } from "rrule";

const DEFAULT_MAX_INSTANCES = 48;
const ABSOLUTE_MAX_INSTANCES = 500;

/** Expand RRULE (ICS-style string with DTSTART + RRULE) into upcoming instance windows. */
export function materializeInstances(
  recurrenceIcs: string,
  instanceDurationMs: number,
  opts?: { maxInstances?: number; from?: Date; until?: Date },
): { startDateTime: Date; endDateTime: Date }[] {
  const maxInstances = Math.min(ABSOLUTE_MAX_INSTANCES, Math.max(0, Math.floor(opts?.maxInstances ?? DEFAULT_MAX_INSTANCES)));
  const from = opts?.from ?? new Date();
  const until = opts?.until ?? new Date(from.getTime() + 366 * 24 * 60 * 60 * 1000);

  let rule;
  try {
    rule = rrulestr(recurrenceIcs, { dtstart: undefined });
  } catch {
    return [];
  }

  const out: { startDateTime: Date; endDateTime: Date }[] = [];
  let cursor = from;
  let inclusive = true;
  while (out.length < maxInstances) {
    const start = rule.after(cursor, inclusive);
    if (!start || start > until) break;
    out.push({
      startDateTime: start,
      endDateTime: new Date(start.getTime() + instanceDurationMs),
    });
    cursor = start;
    inclusive = false;
  }
  return out;
}

export function buildRecurrenceIcs(dtStart: Date, rruleLine: string): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const y = dtStart.getUTCFullYear();
  const m = pad(dtStart.getUTCMonth() + 1);
  const d = pad(dtStart.getUTCDate());
  const hh = pad(dtStart.getUTCHours());
  const mm = pad(dtStart.getUTCMinutes());
  const ss = pad(dtStart.getUTCSeconds());
  const dt = `${y}${m}${d}T${hh}${mm}${ss}Z`;
  const line = rruleLine.trim().startsWith("RRULE:")
    ? rruleLine.trim()
    : `RRULE:${rruleLine.trim()}`;
  return `DTSTART:${dt}\n${line}`;
}
