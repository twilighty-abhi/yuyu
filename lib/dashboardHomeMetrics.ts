/**
 * Pure helpers for the dashboard home (app/dashboard/page.tsx). Kept free of
 * Prisma so they can be unit-tested; lib/dashboardHome.ts feeds them.
 */
import { formatRelativeDay } from "@/lib/format/datetime";

const DAY_MS = 86_400_000;

/**
 * Counts per rolling 24-hour window, oldest first, ending at `now`. Rolling
 * windows avoid guessing the viewer's timezone on the server.
 */
export function dailyCounts(dates: Date[], now: Date, days = 7): number[] {
  const counts = Array.from({ length: days }, () => 0);
  const end = now.getTime();
  for (const date of dates) {
    const age = end - date.getTime();
    if (age < 0 || age >= days * DAY_MS) continue;
    counts[days - 1 - Math.floor(age / DAY_MS)] += 1;
  }
  return counts;
}

/** Counts per 24-hour window looking ahead from `now`, soonest first (for upcoming dates). */
export function forwardDailyCounts(dates: Date[], now: Date, days = 7): number[] {
  const counts = Array.from({ length: days }, () => 0);
  for (const date of dates) {
    const ahead = date.getTime() - now.getTime();
    if (ahead < 0 || ahead >= days * DAY_MS) continue;
    counts[Math.floor(ahead / DAY_MS)] += 1;
  }
  return counts;
}

/** Counts per fixed interval starting at `start`, `buckets` long; later dates are ignored. */
export function intervalCounts(dates: Date[], start: Date, intervalMs: number, buckets: number): number[] {
  const counts = Array.from({ length: buckets }, () => 0);
  for (const date of dates) {
    const index = Math.floor((date.getTime() - start.getTime()) / intervalMs);
    if (index >= 0 && index < buckets) counts[index] += 1;
  }
  return counts;
}

/**
 * Scales counts to 0..`levels` dots per column for the little dot charts. Any
 * non-zero count shows at least one dot so quiet days stay visible.
 */
export function toDotLevels(counts: number[], levels = 4): number[] {
  const max = Math.max(0, ...counts);
  if (max === 0) return counts.map(() => 0);
  return counts.map((count) => (count === 0 ? 0 : Math.max(1, Math.round((count / max) * levels))));
}

/**
 * "+20% on last week", "Same as last week", "New this week", or null when both
 * periods are empty. `period` names the compared periods for other spans.
 */
export function weekOverWeek(current: number, previous: number, period: { previous: string; current: string } = { previous: "last week", current: "this week" }): string | null {
  if (current === 0 && previous === 0) return null;
  if (previous === 0) return `New ${period.current}`;
  if (current === previous) return `Same as ${period.previous}`;
  const change = Math.round(((current - previous) / previous) * 100);
  return `${change > 0 ? "+" : ""}${change}% on ${period.previous}`;
}

export type FillStatus = { label: string; tone: "success" | "warning" | "neutral" };

/**
 * The chip on an event row: approvals first, then full/waitlist, then how many are going.
 * `units` is for TEAM events, whose capacity counts registration units (teams
 * plus solo registrants) rather than people: `used` units against capacity,
 * labelled with `noun` ("teams" or "places").
 */
export function eventFillStatus(
  counts: { confirmed: number; waitlisted: number; pending: number },
  capacity: number | null,
  units?: { used: number; noun: string },
): FillStatus {
  if (counts.pending > 0) return { label: `${counts.pending} to approve`, tone: "warning" };
  const used = units?.used ?? counts.confirmed;
  if (capacity != null && used >= capacity) {
    return { label: counts.waitlisted > 0 ? `Full · ${counts.waitlisted} waiting` : "Full", tone: "warning" };
  }
  if (capacity != null) return { label: units ? `${used} / ${capacity} ${units.noun}` : `${used} / ${capacity} going`, tone: used > 0 ? "success" : "neutral" };
  return { label: `${counts.confirmed} going`, tone: counts.confirmed > 0 ? "success" : "neutral" };
}

export type TimedSession = { id: string; title: string; startDateTime: Date; endDateTime: Date; delayMinutes: number };

/** The session running now and the next one, using each session's live delay. */
export function nowAndNext<T extends TimedSession>(sessions: T[], now: Date): { now: (T & { start: Date; end: Date }) | null; next: (T & { start: Date; end: Date }) | null } {
  const shifted = sessions
    .map((session) => ({ ...session, start: new Date(session.startDateTime.getTime() + session.delayMinutes * 60_000), end: new Date(session.endDateTime.getTime() + session.delayMinutes * 60_000) }))
    .sort((a, b) => a.start.getTime() - b.start.getTime());
  const current = shifted.find((session) => session.start <= now && session.end > now) ?? null;
  const next = shifted.find((session) => session.start > now) ?? null;
  return { now: current, next };
}

/** "today", "tomorrow", "in 9 days" or "on Wed 14 Oct", for use mid-sentence. */
export function relativeDayPhrase(value: Date, timeZone: string, now: Date): string {
  const phrase = formatRelativeDay(value, timeZone, now);
  if (phrase === "Today" || phrase === "Tomorrow" || phrase.startsWith("In ")) return phrase.charAt(0).toLowerCase() + phrase.slice(1);
  return `on ${phrase}`;
}

/** One friendly sentence under the greeting, built only from real numbers. */
export function homeSummary(input: {
  live: { title: string } | null;
  next: { title: string; startDateTime: Date; timezone: string } | null;
  signupsLastDay: number;
  now: Date;
}): string {
  const signups = input.signupsLastDay === 1 ? "1 person signed up" : `${input.signupsLastDay} people signed up`;
  if (input.live) {
    return input.signupsLastDay > 0 ? `${input.live.title} is happening now, and ${signups} in the last day.` : `${input.live.title} is happening now.`;
  }
  if (input.next) {
    const when = relativeDayPhrase(input.next.startDateTime, input.next.timezone, input.now);
    return input.signupsLastDay > 0 ? `${input.next.title} is ${when}, and ${signups} in the last day.` : `${input.next.title} is ${when}.`;
  }
  return "Nothing on the calendar yet. Your next event starts here.";
}

/* ---------- Organisation workspace ---------- */

/** Counts per rolling window of `windowMs`, `buckets` windows ending at `now`, oldest first. */
export function windowCounts(dates: Date[], now: Date, buckets: number, windowMs: number): number[] {
  const counts = Array.from({ length: buckets }, () => 0);
  for (const date of dates) {
    const age = now.getTime() - date.getTime();
    if (age < 0 || age >= buckets * windowMs) continue;
    counts[buckets - 1 - Math.floor(age / windowMs)] += 1;
  }
  return counts;
}

/**
 * Turnout across past events: checked in ÷ going, as a whole percentage, plus
 * one 0..4 level per event (oldest first) for the dot chart. Null when nobody
 * was going.
 */
export function turnout(events: Array<{ confirmed: number; checkedIn: number }>): { percent: number | null; levels: number[] } {
  const going = events.reduce((sum, event) => sum + event.confirmed, 0);
  const came = events.reduce((sum, event) => sum + Math.min(event.checkedIn, event.confirmed), 0);
  return {
    percent: going > 0 ? Math.round((came / going) * 100) : null,
    levels: events.map((event) => (event.confirmed > 0 ? Math.round((Math.min(event.checkedIn, event.confirmed) / event.confirmed) * 4) : 0)),
  };
}

/** "2026-10" from a `?month=` value, falling back to the given date's month. */
export function parseMonth(value: string | undefined, fallback: { year: number; month: number }): { year: number; month: number } {
  const match = /^(\d{4})-(\d{2})$/.exec(value ?? "");
  if (!match) return fallback;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (year < 2000 || year > 2100 || month < 1 || month > 12) return fallback;
  return { year, month };
}

/** Shifts a year/month by `delta` months. */
export function shiftMonth({ year, month }: { year: number; month: number }, delta: number) {
  const index = year * 12 + (month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

export function monthKey({ year, month }: { year: number; month: number }) {
  return `${year}-${String(month).padStart(2, "0")}`;
}

/** Monday-first month grid: leading blanks (null) then day numbers. */
export function monthGrid({ year, month }: { year: number; month: number }): Array<number | null> {
  const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay(); // 0 = Sunday
  const leading = (first + 6) % 7;
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return [...Array.from({ length: leading }, () => null), ...Array.from({ length: days }, (_, index) => index + 1)];
}
